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
    countAtTime,
    countTimes,
    nextMultiplier,
    planTapTheBeat,
    showLineUpStrip,
    suggestTapAgain,
    syncedAfterTaps,
    TAP_AGAIN_COUNTS,
    tapGhostCounts,
    tapPlanClickTimes,
    tapPlausibility,
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

/** Whether the panel is open; the strip, the lane button and the Sound entry open it. */
export const useTapTheBeatStore = create<{
    readonly open: boolean;
    /** Open on From here (the lane's "Tap again from here") */
    readonly openHere: boolean;
    readonly setOpen: (open: boolean, here?: boolean) => void;
}>((set) => ({
    open: false,
    openHere: false,
    setOpen: (open, here = false) => set({ open, openHere: open && here }),
}));

/**
 * What the timeline draws for Tap the beat (FB-5): the taps so far and the counts as the plan
 * would put them (`tapGhostCounts`, spec count positions on the current timing) while the panel
 * previews, and the range Apply changed, flashed once (`key` restarts it).
 */
export interface TapTimelinePreview {
    /** Tap times, in the current show time */
    readonly taps: readonly number[];
    readonly ghost: ReturnType<typeof tapGhostCounts> | null;
}
export const useTapPreviewStore = create<{
    readonly preview: TapTimelinePreview | null;
    readonly flash: {
        readonly from: number;
        readonly to: number;
        readonly key: number;
    } | null;
    readonly setPreview: (preview: TapTimelinePreview | null) => void;
    readonly setFlash: (from: number, to: number) => void;
}>((set) => ({
    preview: null,
    flash: null,
    setPreview: (preview) => set({ preview }),
    setFlash: (from, to) => set({ flash: { from, to, key: Date.now() } }),
}));

/** How many counts before the playhead "From here" starts playing, so tapping can settle. */
export const PRE_ROLL_COUNTS = 8;

const openPanel = () => useTapTheBeatStore.getState().setOpen(true);
/** Opens Tap the beat on From here (the playhead), as the lane's "Tap again from here" does */
export const openTapTheBeatHere = () =>
    useTapTheBeatStore.getState().setOpen(true, true);
const openPanelHere = openTapTheBeatHere;

/** Whether the show has music in the timeline (the waveform lane's envelope is loaded). */
const useHasMusic = () => useAudioEnvelopeStore((s) => s.envelope !== null);

/** The music's length in seconds, or null without music. */
const useMusicSeconds = () =>
    useAudioEnvelopeStore((s) =>
        s.envelope ? s.envelope.peaks.length / s.envelope.rate : null,
    );

/** Whether the Align view is showing (its flag on and toggled on) */
const useAlignShowing = () => {
    const enabled = useTempoLabFlag("alignView") === true;
    const on = useTimelineSelectionStore((s) => s.alignView);
    return enabled && on;
};

/**
 * Whether the line-up strip shows (`showLineUpStrip`), from the flag, the music and the file. Not
 * in Align, where it would cover the start of the music (a pickup, Jo); the lane button stands in.
 */
export function useLineUpStripVisible(): boolean {
    const enabled = useTempoLabFlag("tapTheBeat");
    const hasAudio = useHasMusic();
    const { data: settings } = useQuery(workspaceSettingsQueryOptions(enabled));
    const open = useTapTheBeatStore((s) => s.open);
    const align = useAlignShowing();
    if (!settings || open || align) return false;
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

/**
 * The way back to Tap the beat once the strip is gone (FB-4): a small button at the right of the
 * waveform lane. In Normal view it shows while the pointer is over the timeline, so it adds no
 * permanent header button; it stays visible in Align, and when the paused playhead is far past the
 * last synced count it reads "Tap again from here" and stays visible.
 */
export function TapTheBeatLaneButton() {
    const enabled = useTempoLabFlag("tapTheBeat");
    const hasAudio = useHasMusic();
    const open = useTapTheBeatStore((s) => s.open);
    const stripVisible = useLineUpStripVisible();
    const align = useAlignShowing();
    const { beats } = useTimingObjects()!;
    const { isPlaying } = useIsPlaying()!;
    const playheadBeat = useTimelineSelectionStore((s) => s.playheadBeat);
    const { data: settings } = useQuery(workspaceSettingsQueryOptions(enabled));
    const { t } = useTolgee();
    const synced = useMemo(
        () =>
            syncedOrdinals(
                beats.map((b) => b.id),
                settings?.tempoSyncedBeatIds ?? [],
            ),
        [beats, settings?.tempoSyncedBeatIds],
    );
    if (!enabled || !hasAudio || open || stripVisible) return null;
    const again = !isPlaying && suggestTapAgain(playheadBeat, synced);
    return (
        <button
            type="button"
            data-testid="tap-the-beat-lane"
            data-suggest={again || undefined}
            title={again ? t("tempo.tapTheBeat.laneTapAgainTitle") : undefined}
            onClick={(e) => {
                e.currentTarget.blur();
                if (again) openPanelHere();
                else openPanel();
            }}
            className={clsx(
                "border-stroke bg-bg-1/90 text-accent rounded-4 hover:bg-accent/10 focus-visible:ring-accent pointer-events-auto flex h-full items-center gap-4 border px-6 text-[11px] font-medium whitespace-nowrap shadow-sm outline-hidden backdrop-blur-sm transition-opacity focus-visible:opacity-100 focus-visible:ring-2",
                !align &&
                    !again &&
                    "opacity-0 group-hover/timeline:opacity-100",
            )}
        >
            <HandTapIcon size={14} />
            {t(
                again
                    ? "tempo.tapTheBeat.laneTapAgain"
                    : "tempo.tapTheBeat.laneButton",
            )}
        </button>
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
    synced: readonly number[],
    originShift: number,
) {
    // Where the taps put counts on the music becomes synced, so later fixes keep it (FB-1)
    const next = syncedAfterTaps(synced, plan, base.durations.length);
    await applyTapTheBeat({
        db,
        newDurationsByBeatId: durationsByBeatId(base.beatIds, plan.durations),
        originShift,
        syncedBeatIds: next.flatMap((i) =>
            base.beatIds[i] !== undefined ? [base.beatIds[i]] : [],
        ),
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
    const { beats, pages, measures } = useTimingObjects()!;
    const { isPlaying, setIsPlaying } = useIsPlaying()!;
    const queryClient = useQueryClient();
    const { data: settings } = useQuery(workspaceSettingsQueryOptions());
    const playheadBeat = useTimelineSelectionStore(displayedBeat);
    const musicSeconds = useMusicSeconds();
    const isMetronomeOn = useMetronomeStore((s) => s.isMetronomeOn);
    const { t } = useTolgee();

    const openHere = useTapTheBeatStore((s) => s.openHere);
    // From here needs a playhead past the start: at home it would retime from count 1 (Jo)
    const atHome = playheadBeat <= 1;
    const [startKind, setStartKind] = useState<"start" | "here">(() =>
        (openHere || playheadBeat > 1) && !atHome ? "here" : "start",
    );
    const [clicks, setClicks] = useState(false);
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

    // The timeline draws the taps and where the plan would put the counts (FB-5)
    useEffect(() => {
        useTapPreviewStore.getState().setPreview(
            applied || taps.length === 0
                ? null
                : {
                      taps,
                      ghost: plan ? tapGhostCounts(durations, plan) : null,
                  },
        );
    }, [applied, durations, plan, taps]);
    useEffect(() => () => useTapPreviewStore.getState().setPreview(null), []);

    // Clicks on the plan's counts, before applying (FB-6): scheduled on their own clock from the
    // live position when playback starts, since the metronome follows the stored counts
    useEffect(() => {
        if (!clicks || !isPlaying || !plan || applied) return;
        return schedulePlanClicks(plan, getLivePlaybackPosition());
    }, [applied, clicks, isPlaying, plan]);
    useEffect(() => {
        if (!isPlaying) setClicks(false);
    }, [isPlaying]);

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

    const chooseStart = useCallback((kind: "start" | "here") => {
        setStartKind(kind);
        setHereFrom(null);
        setTaps([]);
        setApplied(null);
        setMultiplier(1);
        setHint(null);
    }, []);

    // "Tap again from here" from the lane while the panel is open starts a new run there
    useEffect(() => {
        if (!openHere) return;
        useTapTheBeatStore.setState({ openHere: false });
        if (useTimelineSelectionStore.getState().playheadBeat > 1)
            chooseStart("here");
    }, [chooseStart, openHere]);

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
            await writePlan(base, fresh, ordinals, fresh.originShift);
            const end = fresh.heldFrom ?? base.durations.length;
            useTapPreviewStore.getState().setFlash(fresh.fromCount, end);
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
            await writePlan(applied.base, replanned, applied.synced, 0);
            useTapPreviewStore
                .getState()
                .setFlash(
                    replanned.fromCount,
                    replanned.heldFrom ?? applied.base.durations.length,
                );
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
        // Before applying, the clicks are the plan's, not the metronome's (which follows the
        // stored counts)
        if (!applied) {
            setClicks(true);
            if (!isPlaying) play();
            return;
        }
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
    // 276 per minute is likelier eighths than the music's count: ask, don't say "steady" (FB-6)
    const implausible = shownBpm !== null ? tapPlausibility(shownBpm) : null;
    const movesSynced = shownPlan?.unsynced.length ?? 0;
    const hereDisabled = atHome && hereFrom === null && startKind !== "here";
    // Far from where the taps were applied: offer a new run from the playhead (FB-4)
    const farFromTaps =
        applied !== null &&
        Math.abs(playheadBeat - applied.plan.tapped.to) >= TAP_AGAIN_COUNTS &&
        playheadBeat > 1;
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
                            disabled={kind === "here" && hereDisabled}
                            title={
                                kind === "here" && hereDisabled
                                    ? t("tempo.tapTheBeat.fromHereAtHome")
                                    : undefined
                            }
                            onClick={(e) => {
                                e.currentTarget.blur();
                                if (kind !== startKind) chooseStart(kind);
                            }}
                            className={clsx(
                                "rounded-4 px-8 py-1 disabled:opacity-50",
                                startKind === kind
                                    ? "bg-accent/15 text-accent"
                                    : "enabled:hover:text-accent",
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
            {!applied && hereDisabled && taps.length === 0 && (
                <p className="text-text-subtitle text-[11px]">
                    {t("tempo.tapTheBeat.fromHereAtHome")}
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
                {!applied && progress.kind !== "waiting" && implausible && (
                    <span
                        data-testid="tap-implausible"
                        className="text-yellow ml-auto flex items-center gap-4 font-medium"
                    >
                        {t(
                            implausible === "fast"
                                ? "tempo.tapTheBeat.implausibleFast"
                                : "tempo.tapTheBeat.implausibleSlow",
                        )}
                        <Button
                            variant="secondary"
                            size="compact"
                            disabled={busy}
                            onClick={() =>
                                void changeMultiplier(
                                    implausible === "fast" ? "down" : "up",
                                )
                            }
                            title={t(
                                implausible === "fast"
                                    ? "tempo.tapTheBeat.half"
                                    : "tempo.tapTheBeat.double",
                            )}
                        >
                            {t(
                                implausible === "fast"
                                    ? "tempo.tapTheBeat.halveIt"
                                    : "tempo.tapTheBeat.doubleIt",
                            )}
                        </Button>
                    </span>
                )}
                {!applied && progress.kind !== "waiting" && !implausible && (
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
                <p
                    data-testid="tap-sentence"
                    className={clsx(
                        // Moving synced counts is not small print (Jo)
                        movesSynced > 0 && "text-yellow font-medium",
                    )}
                >
                    {tapPlanSentence({
                        t,
                        plan: shownPlan,
                        pages,
                        measures,
                        applied: applied !== null,
                        audioOffsetSeconds:
                            applied?.offset ??
                            settings?.audioOffsetSeconds ??
                            0,
                    })}
                    {applied && ` ${t("tempo.tapTheBeat.undoHint")}`}
                </p>
            )}
            {shownPlan && !applied && (
                <p className="text-text-subtitle text-[11px]">
                    {t("tempo.tapTheBeat.previewOnTimeline")}
                </p>
            )}
            {applied && (
                <p className="text-text-subtitle">
                    {t("tempo.tapTheBeat.syncedKept")}
                </p>
            )}
            {pastCounts && <p className="text-text-subtitle">{pastCounts}</p>}
            {farFromTaps && (
                <p className="text-text-subtitle">
                    {t("tempo.tapTheBeat.suggestHere")}
                </p>
            )}

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
                            data-testid="tap-again"
                            onClick={() =>
                                farFromTaps ? chooseStart("here") : startOver()
                            }
                        >
                            {t(
                                farFromTaps
                                    ? "tempo.tapTheBeat.tapAgainHere"
                                    : applied
                                      ? "tempo.tapTheBeat.tapAgain"
                                      : "tempo.tapTheBeat.startOver",
                            )}
                        </Button>
                    )}
                    {/* Hear it before applying it, and again after (FB-6) */}
                    {(applied || plan) && (
                        <Button
                            variant="secondary"
                            size="compact"
                            data-testid="tap-play-clicks"
                            onClick={(e) => {
                                e.currentTarget.blur();
                                playWithClicks();
                            }}
                            className="flex items-center gap-6"
                        >
                            <MetronomeIcon size={16} />
                            {t("tempo.tapTheBeat.playWithClicks")}
                        </Button>
                    )}
                    {applied ? (
                        <Button size="compact" onClick={() => setOpen(false)}>
                            {t("tempo.tapTheBeat.done")}
                        </Button>
                    ) : (
                        <Button
                            size="compact"
                            data-testid="tap-apply"
                            disabled={!plan || busy}
                            onClick={() => void apply()}
                        >
                            {movesSynced > 0
                                ? t("tempo.tapTheBeat.applyMovesSynced", {
                                      count: movesSynced,
                                  })
                                : t("tempo.tapTheBeat.apply")}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

/**
 * Plays a short click on each of the plan's counts from show time `from` (the live position now),
 * up to two minutes ahead. Returns a stop function.
 */
function schedulePlanClicks(plan: TapTheBeatPlan, from: number): () => void {
    const Context =
        typeof window !== "undefined" ? window.AudioContext : undefined;
    if (!Context) return () => {};
    let context: AudioContext;
    try {
        context = new Context();
    } catch {
        return () => {};
    }
    const start = context.currentTime + 0.02;
    for (const time of tapPlanClickTimes(plan, from)) {
        const at = time - from;
        if (at > 120) break;
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.frequency.value = 1500;
        gain.gain.setValueAtTime(0.0001, start + at);
        gain.gain.exponentialRampToValueAtTime(0.4, start + at + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.05);
        osc.connect(gain).connect(context.destination);
        osc.start(start + at);
        osc.stop(start + at + 0.06);
    }
    return () => void context.close().catch(() => {});
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

/**
 * Tap the beat on the timeline (FB-5): while the panel previews, the taps as ticks at the top of
 * the waveform lane and dashed lines where the plan would put each changed count, on the current
 * axis (Normal or Align); after Apply, the changed range flashes once. Positions are spec count
 * indexes; `toX` maps them (fractional) to the lane's pixels.
 */
export function TapTimelineOverlay({
    toX,
    top,
    height,
}: {
    /** A spec count position (fractional) to x */
    toX: (count: number) => number;
    top: number;
    height: number;
}) {
    const { beats } = useTimingObjects()!;
    const times = useMemo(
        () => countTimes(beats.map((b) => b.duration)),
        [beats],
    );
    const timeToX = (seconds: number) => toX(countAtTime(times, seconds));
    const preview = useTapPreviewStore((s) => s.preview);
    const flash = useTapPreviewStore((s) => s.flash);
    const flashRef = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const element = flashRef.current;
        if (!element || !flash) return;
        const animation = element.animate?.(
            [{ opacity: 0.45 }, { opacity: 0 }],
            { duration: 1600, easing: "ease-out", fill: "forwards" },
        );
        return () => animation?.cancel();
    }, [flash]);
    return (
        <>
            {preview && (
                <div
                    aria-hidden="true"
                    data-testid="tap-timeline-preview"
                    className="pointer-events-none absolute inset-x-0 z-[26]"
                    style={{ top, height }}
                >
                    {preview.ghost?.counts.map((c) => (
                        <span
                            key={c.index}
                            className="border-accent absolute top-0 h-full border-l border-dashed opacity-80"
                            style={{ left: toX(c.at) }}
                        />
                    ))}
                    {preview.taps.map((time, i) => (
                        <span
                            key={i}
                            data-testid="tap-timeline-tap"
                            className="bg-accent absolute top-0 h-6 w-[3px] -translate-x-1/2 rounded-full"
                            style={{ left: timeToX(time) }}
                        />
                    ))}
                </div>
            )}
            {flash && (
                <span
                    key={flash.key}
                    ref={flashRef}
                    aria-hidden="true"
                    data-testid="tap-timeline-flash"
                    className="bg-accent pointer-events-none absolute z-[26] opacity-0"
                    style={{
                        left: toX(flash.from),
                        width: Math.max(0, toX(flash.to) - toX(flash.from)),
                        top,
                        height,
                    }}
                />
            )}
        </>
    );
}
