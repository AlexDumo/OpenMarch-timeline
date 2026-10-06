/**
 * Punch-in tap in the Align view (E9, Tempo lab `punchInTap`, `tapApply`, `tapUnit`): tap T along
 * with the music to put the next flag (or count) on it, from any page. Paused, T plays a count-in
 * before the target; playing, T taps. Backspace drops the last tap, a bounce is ignored, a tap
 * that implies a big tempo jump is kept but drawn amber, and clicking a flag taps again from
 * there. Taps are drafts drawn over the waveform, applied when playback stops (`tapApply: "stop"`)
 * or with Enter (`"drafts"`; Esc twice discards), as one undo entry that only changes count
 * lengths. The pure rules are in `timelinePunchTap.ts`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { HandTapIcon } from "@phosphor-icons/react";
import { countTimes, type CountTap } from "@/timeline/tempo";
import {
    addPunchTap,
    countInFrom,
    dropLastPunchTap,
    EMPTY_PUNCH_TAP,
    NO_TARGET_LEFT,
    punchTapResult,
    punchTargets,
    retargetPunchTap,
    suspectTaps,
    syncedAfterTaps,
    tappedPages,
    targetAtOrAfter,
    targetName,
    upcomingTarget,
    type PunchTapState,
    type SuspectTap,
} from "./timelinePunchTap";
import { alignFlags, formatShowTime, type AlignPage } from "./timelineAlign";
import { alignT, type AlignPreview } from "./TimelineAlignView";
import { isTyping, overlayOpen } from "./timelineHotkeys";
import type { TimelineXAxis } from "./timelineAxis";
import type { TimelineAlign } from "./TimelineViewModel";

/** How long the first Esc waits for the second before it stops meaning "discard" */
const ESC_AGAIN_MS = 3000;
/** For this long after playback starts, the playhead moving back is it settling, not a loop */
const SETTLE_MS = 400;

type AlignWithOffset = TimelineAlign & { readonly offset: number };

/** What `usePunchTap` gives the timeline to draw and the header to show */
export interface PunchTapController {
    readonly apply: "stop" | "drafts";
    readonly unit: "page" | "count";
    readonly isPlaying: boolean;
    /** The drafts, in tap order */
    readonly taps: readonly CountTap[];
    /** The count the next tap (or T while paused) sets, or null when there's none */
    readonly target: number | null;
    readonly targetLabel: string | null;
    /** What the drafts would write, or null without drafts */
    readonly preview: AlignPreview | null;
    readonly suspect: ReadonlyMap<number, SuspectTap>;
    /** Esc was pressed once: the chip asks for a second */
    readonly escArmed: boolean;
    readonly pages: readonly AlignPage[];
    readonly tap: (eventTimeStamp: number) => void;
    readonly retarget: (index: number) => void;
    readonly applyDrafts: () => void;
    readonly discard: () => void;
}

/**
 * The punch-in tap session for the Align view, or null when the Tempo lab flag is off (no
 * `align.punchTap`). Owns T, Backspace, Enter and Esc while Align shows and the flag is on.
 *
 * @param positionBeat the playhead (view beat); while playing it moves count by count
 * @param selection the selected range (view beats): while the playhead is in it, a paused tap
 *   starts from its start
 */
// eslint-disable-next-line max-lines-per-function
export function usePunchTap({
    align,
    pages,
    active,
    isPlaying,
    positionBeat,
    selection,
}: {
    align: AlignWithOffset | undefined;
    pages: readonly AlignPage[];
    active: boolean;
    isPlaying: boolean;
    positionBeat: number;
    selection: { readonly start: number; readonly end: number } | null;
}): PunchTapController | null {
    const t = alignT;
    const config = align?.punchTap;
    const enabled = active && config !== undefined && align !== undefined;
    const [state, setState] = useState<PunchTapState>(EMPTY_PUNCH_TAP);
    const [escArmed, setEscArmed] = useState(false);
    const offset = align?.offset ?? 0;
    const durations = align?.durations;
    const unit = config?.unit ?? "page";
    const apply = config?.apply ?? "stop";
    const targets = useMemo(
        () => (durations ? punchTargets(pages, durations.length, unit) : []),
        [durations, pages, unit],
    );

    // The target: the chosen one, or while playing the next one the music hasn't passed, or while
    // paused the first at or after the selection's start (or the playhead)
    const playheadIndex = Math.floor(positionBeat) + offset;
    const target = useMemo(() => {
        if (state.next !== null)
            return state.next === NO_TARGET_LEFT ? null : state.next;
        if (!durations) return null;
        if (isPlaying) {
            const live = countTimes(durations)[playheadIndex] ?? 0;
            return upcomingTarget(targets, durations, live);
        }
        // A selected page is where to punch in, until the playhead has gone past it (a take
        // that played on): then it carries on from the playhead
        const inSelection =
            selection !== null &&
            playheadIndex >= selection.start + offset &&
            playheadIndex <= selection.end + offset;
        return targetAtOrAfter(
            targets,
            inSelection ? selection.start + offset : playheadIndex,
        );
    }, [
        durations,
        isPlaying,
        offset,
        playheadIndex,
        selection,
        state.next,
        targets,
    ]);

    const result = useMemo(
        () =>
            align && state.taps.length > 0
                ? punchTapResult({
                      durations: align.durations,
                      taps: state.taps,
                      synced: align.synced,
                      unit,
                  })
                : null,
        [align, state.taps, unit],
    );
    const suspect = useMemo(
        () =>
            result
                ? suspectTaps({
                      durations: result.durations,
                      targets,
                      taps: state.taps,
                  })
                : new Map<number, SuspectTap>(),
        [result, state.taps, targets],
    );
    const preview = useMemo((): AlignPreview | null => {
        if (!align || !result) return null;
        const last = state.taps[state.taps.length - 1]!;
        return {
            kind: "move",
            index: last.index,
            durations: result.durations,
            origin: result.originShift,
            effect: result.effect,
            chip: { text: "", amber: false },
            ghostTime: countTimes(align.durations)[last.index] ?? 0,
            synced: syncedAfterTaps(align.synced, result.taps),
            anchor: null,
        };
    }, [align, result, state.taps]);

    // Everything the handlers read, current at the time of the event
    const latest = useRef({
        align,
        config,
        state,
        targets,
        target,
        isPlaying,
        unit,
        pages,
        enabled,
    });
    latest.current = {
        align,
        config,
        state,
        targets,
        target,
        isPlaying,
        unit,
        pages,
        enabled,
    };
    const startedByTap = useRef(false);

    const discard = useCallback(() => {
        setState(EMPTY_PUNCH_TAP);
        setEscArmed(false);
    }, []);

    const applyDrafts = useCallback(() => {
        const {
            align: a,
            config: c,
            state: s,
            unit: u,
            pages: p,
        } = latest.current;
        if (!a || !c || s.taps.length === 0) return;
        const written = punchTapResult({
            durations: a.durations,
            taps: s.taps,
            synced: a.synced,
            unit: u,
        });
        setState(EMPTY_PUNCH_TAP);
        setEscArmed(false);
        if (!written) return;
        const range = tappedPages(p, written.taps);
        const message = range
            ? range.first === range.last
                ? t("tempo.punchTap.appliedPage", { page: range.first })
                : t("tempo.punchTap.appliedPages", {
                      from: range.first,
                      to: range.last,
                  })
            : t("tempo.punchTap.applied");
        const done = a.onRetime({
            durations: written.durations,
            originShift: written.originShift,
            synced: syncedAfterTaps(a.synced, written.taps),
        });
        const notify = () => c.onApplied?.(message);
        if (done && typeof done.then === "function") void done.then(notify);
        else notify();
    }, [t]);

    const tap = useCallback((eventTimeStamp: number) => {
        const {
            align: a,
            config: c,
            state: s,
            targets: ts,
            target: tg,
            isPlaying: playing,
            unit: u,
            enabled: on,
        } = latest.current;
        if (!on || !a || !c) return;
        setEscArmed(false);
        if (!playing) {
            // Paused: play a count-in before the target; the taps come while it plays
            if (tg === null) return;
            setState((current) => retargetPunchTap(current, tg));
            startedByTap.current = true;
            if (!c.play(countInFrom(ts, tg, u))) startedByTap.current = false;
            return;
        }
        const time = c.liveTime(eventTimeStamp);
        const hit = s.next ?? upcomingTarget(ts, a.durations, time);
        if (hit === null) return;
        setState((current) =>
            addPunchTap(current, {
                target: current.next ?? hit,
                time,
                stamp: eventTimeStamp,
                targets: ts,
            }),
        );
    }, []);

    const retarget = useCallback((index: number) => {
        setEscArmed(false);
        setState((current) => retargetPunchTap(current, index));
    }, []);

    // Playback started by Space (not T) taps the next target the music reaches; a loop or a jump
    // back does the same from where it lands
    const wasPlaying = useRef(isPlaying);
    const lastBeat = useRef(positionBeat);
    const startedAt = useRef(0);
    useEffect(() => {
        const started = isPlaying && !wasPlaying.current;
        const stopped = !isPlaying && wasPlaying.current;
        // The playhead settling on the count-in's start isn't a jump
        const jumpedBack =
            isPlaying &&
            positionBeat < lastBeat.current - 0.5 &&
            performance.now() - startedAt.current > SETTLE_MS;
        wasPlaying.current = isPlaying;
        lastBeat.current = positionBeat;
        if (started) {
            startedAt.current = performance.now();
            if (!startedByTap.current)
                setState((current) => ({ ...current, next: null }));
            startedByTap.current = false;
        } else if (jumpedBack)
            setState((current) => ({ ...current, next: null }));
        if (stopped && apply === "stop" && latest.current.enabled)
            applyDrafts();
    }, [apply, applyDrafts, isPlaying, positionBeat]);

    // The first Esc only asks; it forgets after a few seconds
    useEffect(() => {
        if (!escArmed) return;
        const timer = setTimeout(() => setEscArmed(false), ESC_AGAIN_MS);
        return () => clearTimeout(timer);
    }, [escArmed]);

    // T, Backspace, Enter and Esc, before the app's shortcuts see them
    useEffect(() => {
        if (!enabled) return;
        const onKey = (event: KeyboardEvent) => {
            const { config: c, state: s } = latest.current;
            if (
                !c ||
                event.ctrlKey ||
                event.metaKey ||
                event.altKey ||
                isTyping(event.target) ||
                overlayOpen() ||
                c.blocked?.()
            )
                return;
            const hasTaps = s.taps.length > 0;
            const key = event.key;
            if ((key === "t" || key === "T") && !event.shiftKey) {
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) tap(event.timeStamp);
            } else if (key === "Backspace" && hasTaps) {
                event.preventDefault();
                event.stopPropagation();
                setEscArmed(false);
                setState(dropLastPunchTap);
            } else if (key === "Enter" && hasTaps && c.apply === "drafts") {
                event.preventDefault();
                event.stopPropagation();
                applyDrafts();
            } else if (key === "Escape" && hasTaps && c.apply === "drafts") {
                event.preventDefault();
                event.stopPropagation();
                setEscArmed((armed) => {
                    if (armed) setState(EMPTY_PUNCH_TAP);
                    return !armed;
                });
            }
        };
        window.addEventListener("keydown", onKey, { capture: true });
        return () =>
            window.removeEventListener("keydown", onKey, { capture: true });
    }, [applyDrafts, enabled, tap]);

    if (!enabled) return null;
    return {
        apply,
        unit,
        isPlaying,
        taps: state.taps,
        target,
        targetLabel:
            target === null
                ? null
                : targetName(pages, target, t("tempo.punchTap.countOne")),
        preview,
        suspect,
        escArmed,
        pages,
        tap,
        retarget,
        applyDrafts,
        discard,
    };
}

/**
 * The header's Tap button and chip: "Next tap → Pg 12 ct 16", "3 taps · Next → …", and in
 * drafts mode Apply and Discard.
 */
export function TimelinePunchTapControls({
    punch,
}: {
    punch: PunchTapController;
}) {
    const t = alignT;
    const count = punch.taps.length;
    const next = punch.targetLabel
        ? t("tempo.punchTap.next", { target: punch.targetLabel })
        : t("tempo.punchTap.noTarget");
    const chip = punch.escArmed
        ? t("tempo.punchTap.escAgain", { count })
        : count > 0
          ? t("tempo.punchTap.tapsAndNext", { count, next })
          : next;
    return (
        <div
            className="flex shrink-0 items-center gap-4"
            data-testid="timeline-punch-tap"
        >
            <button
                type="button"
                data-testid="timeline-punch-tap-button"
                aria-pressed={punch.isPlaying && count > 0}
                title={
                    punch.unit === "count"
                        ? t("tempo.punchTap.tooltipCount")
                        : t("tempo.punchTap.tooltipPage")
                }
                onClick={(event) => {
                    event.currentTarget.blur();
                    punch.tap(event.timeStamp);
                }}
                className="rounded-4 text-text hover:bg-fg-2 hover:text-accent focus-visible:ring-accent flex h-24 items-center gap-4 px-4 text-[11px] outline-hidden focus-visible:ring-2"
            >
                <HandTapIcon size={16} />
                <span>{t("tempo.punchTap.button")}</span>
                <kbd className="border-stroke rounded-2 border px-2 font-mono text-[9px] leading-tight">
                    T
                </kbd>
            </button>
            <span
                role="status"
                data-testid="timeline-punch-tap-chip"
                className={clsx(
                    "rounded-6 border px-6 py-1 font-mono text-[11px] whitespace-nowrap",
                    punch.escArmed
                        ? "border-yellow text-text"
                        : "border-stroke text-text-subtitle",
                )}
            >
                {chip}
            </span>
            {punch.apply === "drafts" && count > 0 && (
                <>
                    <button
                        type="button"
                        data-testid="timeline-punch-tap-apply"
                        title={t("tempo.punchTap.applyTooltip")}
                        onClick={punch.applyDrafts}
                        className="rounded-4 bg-accent text-text-invert h-20 px-6 text-[11px]"
                    >
                        {t("tempo.punchTap.apply")}
                    </button>
                    <button
                        type="button"
                        data-testid="timeline-punch-tap-discard"
                        title={t("tempo.punchTap.discardTooltip")}
                        onClick={punch.discard}
                        className="rounded-4 text-text hover:bg-fg-2 h-20 px-6 text-[11px]"
                    >
                        {t("tempo.punchTap.discard")}
                    </button>
                </>
            )}
        </div>
    );
}

/**
 * Over the Align view: the next target's ring and **T** badge, each draft as a dashed line with a
 * numbered tag (amber with "?" when suspect; click to tap again from there), and the flags after
 * them where the drafts would move them, dotted.
 *
 * @param axis the Align view's axis on the show as stored (the music and the playhead's clock)
 * @param previewAxis the same axis on the drafted timing
 */
export function TimelinePunchTapLayer({
    punch,
    axis,
    previewAxis,
    offset,
    pixelsPerSecond,
    height,
}: {
    punch: PunchTapController;
    axis: TimelineXAxis;
    previewAxis: TimelineXAxis | null;
    offset: number;
    pixelsPerSecond: number;
    height: number;
}) {
    const t = alignT;
    const order = new Map(punch.taps.map((tap, i) => [tap.index, i + 1]));
    const tapped = new Set(order.keys());
    const moved =
        previewAxis && punch.preview
            ? alignFlags(punch.pages).filter((flag) => {
                  if (tapped.has(flag.index)) return false;
                  const view = flag.index - offset;
                  return Math.abs(previewAxis.x(view) - axis.x(view)) > 1;
              })
            : [];
    const countOne = t("tempo.punchTap.countOne");
    return (
        <div
            data-testid="timeline-punch-tap-layer"
            className="pointer-events-none absolute inset-0 z-[56]"
        >
            {moved.map((flag) => (
                <span
                    key={`moved-${flag.index}`}
                    aria-hidden="true"
                    data-testid="timeline-punch-tap-moved"
                    className="border-accent absolute top-[28px] border-l border-dotted opacity-70"
                    style={{
                        left: previewAxis!.x(flag.index - offset),
                        height: Math.max(0, height - 28),
                    }}
                />
            ))}
            {punch.taps.map((tap) => {
                const n = order.get(tap.index)!;
                const suspect = punch.suspect.get(tap.index);
                const name = targetName(punch.pages, tap.index, countOne);
                const title = suspect
                    ? t("tempo.punchTap.suspect", {
                          target: name,
                          bpm: suspect.bpm,
                          was: suspect.beforeBpm,
                      })
                    : t("tempo.punchTap.draftTag", {
                          n,
                          target: name,
                          time: formatShowTime(tap.time, true),
                      });
                const x = tap.time * pixelsPerSecond;
                return (
                    <span key={`tap-${tap.index}`}>
                        <span
                            aria-hidden="true"
                            data-testid="timeline-punch-tap-draft"
                            data-suspect={suspect ? true : undefined}
                            className={clsx(
                                "absolute top-0 border-l-2 border-dashed",
                                suspect ? "border-yellow" : "border-accent",
                            )}
                            style={{ left: x - 1, height }}
                        />
                        <button
                            type="button"
                            data-testid="timeline-punch-tap-tag"
                            data-timeline-interactive="true"
                            title={title}
                            aria-label={title}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.stopPropagation();
                                punch.retarget(tap.index);
                            }}
                            className={clsx(
                                "pointer-events-auto absolute top-[2px] flex h-14 min-w-14 -translate-x-1/2 items-center justify-center rounded-full px-2 font-mono text-[9px] leading-none font-bold",
                                suspect
                                    ? "bg-yellow text-black"
                                    : "bg-accent text-text-invert",
                            )}
                            style={{ left: x }}
                        >
                            {suspect ? `${n}?` : n}
                        </button>
                    </span>
                );
            })}
            {punch.target !== null && (
                <span
                    aria-hidden="true"
                    data-testid="timeline-punch-tap-target"
                    className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
                    style={{ left: axis.x(punch.target - offset) }}
                >
                    <span className="border-accent bg-bg-1 text-accent rounded-2 -mt-1 border px-2 font-mono text-[9px] leading-tight font-bold">
                        T
                    </span>
                    <span className="ring-accent rounded-2 mt-1 block h-12 w-[11px] ring-2" />
                </span>
            )}
        </div>
    );
}
