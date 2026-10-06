/**
 * "Tap the beat" (Tempo lab, E6): Dana has an MP3 and no idea of its BPM. She plays the music and
 * taps T on each beat; a few taps set the tempo and, from the start, where count 1 is. Behind the
 * `tapTheBeat` Tempo lab flag.
 *
 * - `LineUpStrip`: the waveform lane's "Counts aren't lined up with the music yet" strip, for a
 *   show with music that nobody has lined up (`showLineUpStrip`); dismissed per file.
 * - `TapTheBeatMenuEntry`: "Tap the beat…" in the transport's Sound popover.
 * - `TapTheBeatPanel`: the compact panel over the field, while it is open.
 *
 * Applying writes durations only (`applyTapTheBeat`): one undo entry, never refused by drill.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@openmarch/ui";
import {
    HandTapIcon,
    MetronomeIcon,
    PlayIcon,
    PauseIcon,
    XIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { useTolgee } from "@tolgee/react";
import { db } from "@/global/database/db";
import { useTimingObjects } from "@/hooks";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { workspaceSettingsQueryOptions } from "@/hooks/queries/useWorkspaceSettings";
import { useTempoLabFlag } from "@/stores/UiSettingsStore";
import { useMetronomeStore } from "@/stores/MetronomeStore";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { useAudioEnvelopeStore } from "@/timeline/timelineWaveform";
import { startTimelinePlayOn } from "@/timeline/timelineTransport";
import { showEndTime } from "@/timeline/timeMap";
import {
    addTap,
    canApplyTaps,
    nextMultiplier,
    planTapTheBeat,
    showLineUpStrip,
    tapProgress,
    tempoFromTaps,
    type TapMultiplier,
    type TapStart,
    type TapTempo,
    type TapTheBeatPlan,
} from "@/timeline/tempo";
import { applyTapTheBeat, dismissLineUpStrip } from "@/db-functions/tapTheBeat";
import {
    durationsByBeatId,
    readCountDurationsInTransaction,
    readTempoSyncedBeatIds,
    type ShowCountDurations,
} from "@/db-functions/tempo";
import { getLivePlaybackPosition } from "./audio/AudioPlayer";
import { isTyping } from "./timelineHotkeys";
import {
    musicPastCountsSentence,
    perMinute,
    tapPlanSentence,
} from "./tapTheBeatText";

/**
 * How long ago an input event happened, in seconds, from its `timeStamp` (on the
 * `performance.now()` clock). 0 for a timestamp that is missing or not on that clock; capped at a
 * second, past which the event is too stale to correct.
 */
export function handlerDelaySeconds(
    eventTimeStamp: number,
    now = performance.now(),
): number {
    const late = (now - eventTimeStamp) / 1000;
    return late > 0 && late < 1 ? late : 0;
}

/** Whether the panel is open; the strip and the Sound entry open it. */
export const useTapTheBeatStore = create<{
    readonly open: boolean;
    readonly setOpen: (open: boolean) => void;
}>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}));

/** How many counts before the playhead "From here" starts playing, so tapping can settle. */
export const PRE_ROLL_COUNTS = 8;

const openPanel = () => useTapTheBeatStore.getState().setOpen(true);

/** Whether the show has music in the timeline (the waveform lane's envelope is loaded). */
const useHasMusic = () => useAudioEnvelopeStore((s) => s.envelope !== null);

/** The music's length in seconds, or null without music. */
const useMusicSeconds = () =>
    useAudioEnvelopeStore((s) =>
        s.envelope ? s.envelope.peaks.length / s.envelope.rate : null,
    );

/** Whether the line-up strip shows (`showLineUpStrip`), from the flag, the music and the file. */
export function useLineUpStripVisible(): boolean {
    const enabled = useTempoLabFlag("tapTheBeat");
    const hasAudio = useHasMusic();
    const { data: settings } = useQuery(workspaceSettingsQueryOptions(enabled));
    const open = useTapTheBeatStore((s) => s.open);
    if (!settings || open) return false;
    return showLineUpStrip({
        enabled,
        hasAudio,
        syncedCount: settings.tempoSyncedBeatIds?.length ?? 0,
        dismissed: settings.tempoLineUpDismissed ?? false,
        audioOffsetSeconds: settings.audioOffsetSeconds,
    });
}

/**
 * The waveform lane's strip: "Counts aren't lined up with the music yet. [Tap the beat]
 * [Dismiss]". Non-blocking; Dismiss hides it for this file.
 */
export function LineUpStrip() {
    const visible = useLineUpStripVisible();
    const queryClient = useQueryClient();
    const { t } = useTolgee();
    if (!visible) return null;
    return (
        <div
            data-testid="tempo-line-up-strip"
            role="status"
            className="border-stroke bg-bg-1/90 text-text rounded-4 text-sub pointer-events-auto flex h-full items-center gap-8 border px-8 whitespace-nowrap shadow-sm backdrop-blur-sm"
        >
            <span>{t("tempo.tapTheBeat.strip.text")}</span>
            <button
                type="button"
                className="text-accent hover:bg-accent/10 rounded-4 px-6 py-1 font-medium"
                onClick={(e) => {
                    e.currentTarget.blur();
                    openPanel();
                }}
            >
                {t("tempo.tapTheBeat.strip.tap")}
            </button>
            <button
                type="button"
                className="text-text-subtitle hover:text-text hover:bg-fg-2 rounded-4 px-6 py-1"
                onClick={() =>
                    void dismissLineUpStrip({ db }).then(() =>
                        queryClient.invalidateQueries({
                            queryKey: workspaceSettingsQueryOptions().queryKey,
                        }),
                    )
                }
            >
                {t("tempo.tapTheBeat.strip.dismiss")}
            </button>
        </div>
    );
}

/** "Tap the beat…" in the Sound popover: with the flag on and music loaded. */
export function TapTheBeatMenuEntry() {
    const enabled = useTempoLabFlag("tapTheBeat");
    const hasAudio = useHasMusic();
    const { t } = useTolgee();
    if (!enabled || !hasAudio) return null;
    return (
        <Popover.Close asChild>
            <button
                type="button"
                data-testid="tap-the-beat-entry"
                onClick={openPanel}
                className="border-stroke focus-visible:ring-accent hover:text-accent flex items-center gap-6 border-t pt-8 outline-hidden focus-visible:ring-2"
            >
                <HandTapIcon size={18} />
                <span className="text-body">
                    {t("tempo.tapTheBeat.menuEntry")}
                </span>
            </button>
        </Popover.Close>
    );
}

interface Applied {
    /** The show before applying, to re-plan ×2 and ÷2 from */
    base: ShowCountDurations;
    fit: TapTempo;
    start: TapStart;
    synced: number[];
    multiplier: TapMultiplier;
    plan: TapTheBeatPlan;
    /** The audio offset before applying */
    offset: number;
}

const syncedOrdinals = (
    beatIds: readonly number[],
    syncedIds: readonly number[],
): number[] => {
    const set = new Set(syncedIds);
    return beatIds.flatMap((id, i) => (set.has(id) ? [i] : []));
};

/**
 * Writes a plan as one undo entry. `originShift` is the plan's for a first apply, and 0 when
 * re-applying ×2 or ÷2 over an apply that already moved the music.
 */
async function writePlan(
    base: ShowCountDurations,
    plan: TapTheBeatPlan,
    syncedIds: readonly number[],
    originShift: number,
) {
    const unsynced = new Set(plan.unsynced.map((i) => base.beatIds[i]));
    await applyTapTheBeat({
        db,
        newDurationsByBeatId: durationsByBeatId(base.beatIds, plan.durations),
        originShift,
        ...(unsynced.size > 0
            ? { syncedBeatIds: syncedIds.filter((id) => !unsynced.has(id)) }
            : {}),
    });
}

/**
 * The tap panel. Pick From the start (0:00; the first tap is count 1) or From here (the
 * playhead's count stays; counts after it follow the taps), play, and tap T or the pad on each
 * beat. Backspace drops the last tap. Apply writes it; ×2 and ÷2 fix a tempo tapped on the wrong
 * pulse, before or after applying.
 */
// eslint-disable-next-line max-lines-per-function
export function TapTheBeatPanel() {
    const open = useTapTheBeatStore((s) => s.open);
    const enabled = useTempoLabFlag("tapTheBeat");
    if (!open || !enabled) return null;
    return <TapTheBeatPanelBody />;
}

// eslint-disable-next-line max-lines-per-function
function TapTheBeatPanelBody() {
    const setOpen = useTapTheBeatStore((s) => s.setOpen);
    const { beats, pages } = useTimingObjects()!;
    const { isPlaying, setIsPlaying } = useIsPlaying()!;
    const queryClient = useQueryClient();
    const { data: settings } = useQuery(workspaceSettingsQueryOptions());
    const playheadBeat = useTimelineSelectionStore(displayedBeat);
    const musicSeconds = useMusicSeconds();
    const isMetronomeOn = useMetronomeStore((s) => s.isMetronomeOn);
    const { t } = useTolgee();

    const [startKind, setStartKind] = useState<"start" | "here">(() =>
        playheadBeat > 1 ? "here" : "start",
    );
    const [taps, setTaps] = useState<number[]>([]);
    const [multiplier, setMultiplier] = useState<TapMultiplier>(1);
    const [applied, setApplied] = useState<Applied | null>(null);
    const [busy, setBusy] = useState(false);
    /** A `tempo.tapTheBeat` key */
    const [hint, setHint] = useState<"playFirst" | "nothingToPlay" | null>(
        null,
    );
    // "From here" is the playhead's count when Play or the first tap of a run happened: pausing a
    // play-on run moves the playhead (UI-12), so it can't be read live
    const [hereFrom, setHereFrom] = useState<number | null>(null);
    const hereCount = Math.max(1, hereFrom ?? playheadBeat);

    const start: TapStart = useMemo(
        () =>
            startKind === "start"
                ? { kind: "start" }
                : { kind: "here", count: hereCount },
        [startKind, hereCount],
    );
    const fit = useMemo(() => tempoFromTaps(taps), [taps]);
    const progress = tapProgress(taps.length, fit);
    const durations = useMemo(() => beats.map((b) => b.duration), [beats]);
    const synced = useMemo(
        () =>
            syncedOrdinals(
                beats.map((b) => b.id),
                settings?.tempoSyncedBeatIds ?? [],
            ),
        [beats, settings?.tempoSyncedBeatIds],
    );
    const plan = useMemo(
        () =>
            !applied && fit && canApplyTaps(taps.length, fit)
                ? planTapTheBeat({
                      durations,
                      start,
                      fit,
                      multiplier,
                      synced,
                  })
                : null,
        [applied, durations, fit, multiplier, start, synced, taps.length],
    );

    /**
     * A tap from an input event: when it happened in the music, not when the handler ran. A busy
     * main thread (playback renders every frame) can run a handler a few hundred milliseconds
     * late, so the event's own timestamp moves the tap back by that much.
     */
    const tap = useCallback(
        (eventTimeStamp: number) => {
            if (applied) return;
            if (!isPlaying) {
                setHint("playFirst");
                return;
            }
            setHint(null);
            const late = handlerDelaySeconds(eventTimeStamp);
            const time = getLivePlaybackPosition() - late;
            setTaps((previous) => {
                const next = addTap(previous, time);
                if (next.length === 1 && hereFrom === null)
                    setHereFrom(
                        useTimelineSelectionStore.getState().playheadBeat,
                    );
                return next;
            });
        },
        [applied, hereFrom, isPlaying],
    );

    // T taps and Backspace drops the last tap, before the app's shortcuts see them
    const tapRef = useRef(tap);
    tapRef.current = tap;
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (
                isTyping(event.target) ||
                event.ctrlKey ||
                event.metaKey ||
                event.altKey
            )
                return;
            if (event.key === "t" || event.key === "T") {
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) tapRef.current(event.timeStamp);
            } else if (event.key === "Backspace") {
                event.preventDefault();
                event.stopPropagation();
                setTaps((t) => t.slice(0, -1));
            }
        };
        window.addEventListener("keydown", onKey, { capture: true });
        return () =>
            window.removeEventListener("keydown", onKey, { capture: true });
    }, []);

    const chooseStart = (kind: "start" | "here") => {
        if (kind === startKind) return;
        setStartKind(kind);
        setHereFrom(null);
        setTaps([]);
        setApplied(null);
        setMultiplier(1);
    };

    /**
     * Plays from 0:00 (From the start), or from the playhead with a pre-roll of up to
     * `PRE_ROLL_COUNTS` (From here), to the end of the counts. Taps in the pre-roll only set the
     * tempo; the counts before the playhead don't change.
     */
    const play = () => {
        if (isPlaying) {
            setIsPlaying(false);
            return;
        }
        const store = useTimelineSelectionStore.getState();
        store.setPlayFromStart(false);
        if (startKind === "start") store.selectHome();
        else {
            const from = hereFrom ?? store.playheadBeat;
            setHereFrom(from);
            if (from > 1) store.cue(Math.max(1, from - PRE_ROLL_COUNTS));
        }
        setHint(null);
        if (!startTimelinePlayOn(beats.length, setIsPlaying))
            setHint("nothingToPlay");
    };

    const refresh = () => queryClient.invalidateQueries();

    const apply = async () => {
        if (!fit || busy) return;
        setBusy(true);
        try {
            if (isPlaying) setIsPlaying(false);
            const base = await readCountDurationsInTransaction(db);
            const syncedIds = await readTempoSyncedBeatIds(db);
            const ordinals = syncedOrdinals(base.beatIds, syncedIds);
            const fresh = planTapTheBeat({
                durations: base.durations,
                start,
                fit,
                multiplier,
                synced: ordinals,
            });
            if (!fresh) return;
            await writePlan(base, fresh, syncedIds, fresh.originShift);
            setApplied({
                base,
                fit,
                start,
                synced: ordinals,
                multiplier,
                plan: fresh,
                offset: settings?.audioOffsetSeconds ?? 0,
            });
            await refresh();
        } catch (e) {
            toast.error(`${t("tempo.tapTheBeat.applyError")}: ${String(e)}`);
        } finally {
            setBusy(false);
        }
    };

    /** ×2 or ÷2: before applying it changes the preview; after, it re-applies as a new undo entry. */
    const changeMultiplier = async (direction: "up" | "down") => {
        if (!applied) {
            setMultiplier((m) => nextMultiplier(m, direction));
            return;
        }
        const next = nextMultiplier(applied.multiplier, direction);
        if (next === applied.multiplier || busy) return;
        setBusy(true);
        try {
            const replanned = planTapTheBeat({
                durations: applied.base.durations,
                start: applied.start,
                fit: applied.fit,
                multiplier: next,
                synced: applied.synced,
            });
            if (!replanned) return;
            const syncedIds = await readTempoSyncedBeatIds(db);
            await writePlan(applied.base, replanned, syncedIds, 0);
            setApplied({ ...applied, multiplier: next, plan: replanned });
            setMultiplier(next);
            await refresh();
        } catch (e) {
            toast.error(
                `${t("tempo.tapTheBeat.multiplierError")}: ${String(e)}`,
            );
        } finally {
            setBusy(false);
        }
    };

    /** Plays from where tapping started with the metronome on, to hear the counts on the music. */
    const playWithClicks = () => {
        if (!isMetronomeOn) useMetronomeStore.getState().setMetronomeOn(true);
        if (isPlaying) return;
        const store = useTimelineSelectionStore.getState();
        store.setPlayFromStart(false);
        if (startKind === "start") store.selectHome();
        else if (hereFrom !== null && hereFrom > 1)
            store.cue(Math.max(1, hereFrom - PRE_ROLL_COUNTS));
        startTimelinePlayOn(beats.length, setIsPlaying);
    };

    const startOver = () => {
        setTaps([]);
        setApplied(null);
        setMultiplier(1);
        setHint(null);
        setHereFrom(null);
    };

    const shownPlan = applied?.plan ?? plan;
    const shownBpm = shownPlan?.bpm ?? (fit ? fit.bpm * multiplier : null);
    const currentMultiplier = applied?.multiplier ?? multiplier;
    // The envelope is on the show's clock, offset included, so after applying it is compared
    // with the new counts as they are
    const pastCounts =
        applied && shownPlan
            ? musicPastCountsSentence(
                  t,
                  musicSeconds,
                  showEndTime(beats),
                  60 / shownPlan.bpm,
              )
            : null;

    return (
        <div
            data-testid="tap-the-beat-panel"
            role="dialog"
            aria-modal="false"
            aria-label={t("tempo.tapTheBeat.title")}
            className="border-stroke bg-modal text-text rounded-8 shadow-modal text-sub pointer-events-auto absolute bottom-12 left-1/2 z-20 flex w-[min(30rem,calc(100%-32px))] -translate-x-1/2 flex-col gap-10 border px-16 py-12 backdrop-blur-sm"
        >
            <div className="flex items-center gap-8">
                <span className="text-body font-medium">
                    {t("tempo.tapTheBeat.title")}
                </span>
                <div
                    role="radiogroup"
                    aria-label={t("tempo.tapTheBeat.whereStarts")}
                    className="border-stroke rounded-6 ml-auto flex border p-1"
                >
                    {(
                        [
                            ["start", t("tempo.tapTheBeat.fromStart")],
                            ["here", t("tempo.tapTheBeat.fromHere")],
                        ] as const
                    ).map(([kind, label]) => (
                        <button
                            key={kind}
                            type="button"
                            role="radio"
                            aria-checked={startKind === kind}
                            onClick={(e) => {
                                e.currentTarget.blur();
                                chooseStart(kind);
                            }}
                            className={clsx(
                                "rounded-4 px-8 py-1",
                                startKind === kind
                                    ? "bg-accent/15 text-accent"
                                    : "hover:text-accent",
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <button
                    type="button"
                    aria-label={t("tempo.tapTheBeat.close")}
                    onClick={() => setOpen(false)}
                    className="hover:text-accent rounded-4 flex size-24 items-center justify-center"
                >
                    <XIcon size={16} />
                </button>
            </div>

            {!applied && (
                <p className="text-text-subtitle">
                    {startKind === "start"
                        ? t("tempo.tapTheBeat.instructionsStart")
                        : t("tempo.tapTheBeat.instructionsHere")}
                </p>
            )}

            {!applied && (
                <div className="flex items-stretch gap-8">
                    <Button
                        variant="secondary"
                        size="compact"
                        onClick={(e) => {
                            e.currentTarget.blur();
                            play();
                        }}
                        aria-label={t(
                            isPlaying
                                ? "tempo.tapTheBeat.pause"
                                : "tempo.tapTheBeat.play",
                        )}
                        className="flex items-center gap-6"
                    >
                        {isPlaying ? (
                            <PauseIcon size={16} />
                        ) : (
                            <PlayIcon size={16} />
                        )}
                        {t(
                            isPlaying
                                ? "tempo.tapTheBeat.pause"
                                : startKind === "start"
                                  ? "tempo.tapTheBeat.playFromStart"
                                  : "tempo.tapTheBeat.playFromHere",
                        )}
                    </Button>
                    <button
                        type="button"
                        data-testid="tap-pad"
                        // Pointer down, not click: a click lands later than the beat
                        onPointerDown={(e) => {
                            e.preventDefault();
                            tap(e.timeStamp);
                        }}
                        className={clsx(
                            "border-stroke rounded-6 hover:border-accent flex min-h-36 flex-1 items-center gap-6 overflow-hidden border border-dashed px-8 select-none",
                        )}
                        aria-label={t("tempo.tapTheBeat.pad")}
                    >
                        <TapDots
                            taps={taps}
                            fit={fit}
                            emptyLabel={t("tempo.tapTheBeat.padEmpty")}
                        />
                    </button>
                </div>
            )}

            <div className="flex items-baseline gap-8" aria-live="polite">
                {shownBpm !== null ? (
                    <>
                        <span
                            className="text-h4 font-medium"
                            data-testid="tap-bpm"
                        >
                            {t("tempo.tapTheBeat.perMinute", {
                                bpm: perMinute(shownBpm),
                            })}
                        </span>
                        <span className="text-text-subtitle text-[11px]">
                            {t("tempo.tapTheBeat.bpm")}
                        </span>
                    </>
                ) : (
                    <span className="text-text-subtitle">
                        {t(`tempo.tapTheBeat.${hint ?? "waiting"}`)}
                    </span>
                )}
                {!applied && progress.kind !== "waiting" && (
                    <span
                        className={clsx(
                            "ml-auto",
                            progress.kind === "steady"
                                ? "text-green"
                                : "text-text-subtitle",
                        )}
                    >
                        {t(
                            progress.kind === "steady"
                                ? "tempo.tapTheBeat.steady"
                                : "tempo.tapTheBeat.keepGoing",
                        )}
                    </span>
                )}
                {shownBpm !== null && (
                    <div className="ml-auto flex gap-4">
                        <Button
                            variant="ghost"
                            size="compact"
                            disabled={currentMultiplier === 0.5 || busy}
                            onClick={() => void changeMultiplier("down")}
                            title={t("tempo.tapTheBeat.half")}
                        >
                            ÷2
                        </Button>
                        <Button
                            variant="ghost"
                            size="compact"
                            disabled={currentMultiplier === 2 || busy}
                            onClick={() => void changeMultiplier("up")}
                            title={t("tempo.tapTheBeat.double")}
                        >
                            ×2
                        </Button>
                    </div>
                )}
            </div>
            {hint && shownBpm !== null && (
                <p className="text-text-subtitle">
                    {t(`tempo.tapTheBeat.${hint}`)}
                </p>
            )}

            {shownPlan && (
                <p data-testid="tap-sentence">
                    {tapPlanSentence({
                        t,
                        plan: shownPlan,
                        pages,
                        applied: applied !== null,
                        audioOffsetSeconds:
                            applied?.offset ??
                            settings?.audioOffsetSeconds ??
                            0,
                    })}
                    {applied && ` ${t("tempo.tapTheBeat.undoHint")}`}
                </p>
            )}
            {pastCounts && <p className="text-text-subtitle">{pastCounts}</p>}

            <div className="flex items-center gap-8">
                {taps.length > 0 && !applied && (
                    <span className="text-text-subtitle text-[11px]">
                        {t("tempo.tapTheBeat.tapCount", {
                            count: taps.length,
                        })}
                    </span>
                )}
                <div className="ml-auto flex gap-8">
                    {(taps.length > 0 || applied) && (
                        <Button
                            variant="ghost"
                            size="compact"
                            onClick={startOver}
                        >
                            {t(
                                applied
                                    ? "tempo.tapTheBeat.tapAgain"
                                    : "tempo.tapTheBeat.startOver",
                            )}
                        </Button>
                    )}
                    {applied ? (
                        <>
                            <Button
                                variant="secondary"
                                size="compact"
                                onClick={(e) => {
                                    e.currentTarget.blur();
                                    playWithClicks();
                                }}
                                className="flex items-center gap-6"
                            >
                                <MetronomeIcon size={16} />
                                {t("tempo.tapTheBeat.playWithClicks")}
                            </Button>
                            <Button
                                size="compact"
                                onClick={() => setOpen(false)}
                            >
                                {t("tempo.tapTheBeat.done")}
                            </Button>
                        </>
                    ) : (
                        <Button
                            size="compact"
                            data-testid="tap-apply"
                            disabled={!plan || busy}
                            onClick={() => void apply()}
                        >
                            {t("tempo.tapTheBeat.apply")}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

/** One dot per tap, newest on the right; taps left out of the fit are hollow. */
function TapDots({
    taps,
    fit,
    emptyLabel,
}: {
    taps: readonly number[];
    fit: TapTempo | null;
    emptyLabel: string;
}) {
    if (taps.length === 0)
        return (
            <span className="text-text-subtitle flex items-center gap-6">
                <HandTapIcon size={16} /> {emptyLabel}
            </span>
        );
    const rejected = new Set(fit?.rejected ?? []);
    const shown = taps.slice(-16);
    const offset = taps.length - shown.length;
    return (
        <span className="flex items-center gap-6" data-testid="tap-dots">
            {shown.map((_, i) => {
                const index = offset + i;
                return (
                    <span
                        key={index}
                        className={clsx(
                            "size-8 rounded-full",
                            rejected.has(index)
                                ? "border-text-subtitle border"
                                : "bg-accent",
                        )}
                    />
                );
            })}
        </span>
    );
}
