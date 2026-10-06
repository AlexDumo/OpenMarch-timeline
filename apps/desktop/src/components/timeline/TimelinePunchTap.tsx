/**
 * Punch-in tap in the Align view (E9, Tempo lab `punchInTap`): tap T along with the music to put
 * the next flag (or count) on it, from any page. Paused, T plays a count-in before the target;
 * playing, T taps. Backspace drops the last tap, a bounce is ignored, a tap out of step with its
 * neighbors is kept but drawn amber, and clicking a flag taps again from there. Each page is
 * tapped by its start or count by count, as suits it (DT-2), unless the user picks one for the
 * take. Taps are a take of drafts drawn over the waveform: pausing keeps them and playing again
 * carries on (DT-1). Done or Enter applies them, and so does leaving Align or opening Tap the beat,
 * as one undo entry that only changes count lengths; a take that would change a typed tempo asks
 * first (DT-3). Only Discard take throws a take away. The pure rules are in `timelinePunchTap.ts`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CaretDownIcon, CheckIcon, HandTapIcon } from "@phosphor-icons/react";
import {
    countTimes,
    overriddenSections,
    type CountTap,
    type TypedSection,
} from "@/timeline/tempo";
import {
    addPunchTap,
    countInFrom,
    dropLastPunchTap,
    EMPTY_PUNCH_TAP,
    NO_TARGET_LEFT,
    numberedTags,
    pageOfTarget,
    pageTapUnit,
    punchTapResult,
    punchTargets,
    retargetPunchTap,
    suspectTaps,
    syncedAfterTaps,
    takeUnit,
    tappedPages,
    targetAtOrAfter,
    targetName,
    upcomingTarget,
    type PunchTapState,
    type PunchTapUnit,
    type PunchTapUnitChoice,
    type PunchTapUnitReason,
    type SuspectTap,
} from "./timelinePunchTap";
import { alignFlags, formatShowTime, type AlignPage } from "./timelineAlign";
import {
    alignT,
    TimelineAlignConfirm,
    type AlignPreview,
} from "./TimelineAlignView";
import { isTyping, overlayOpen } from "./timelineHotkeys";
import { timelineMenuContentGuards } from "./TimelineRangeMenu";
import type { TimelineXAxis } from "./timelineAxis";
import type { TimelineAlign } from "./TimelineViewModel";

/** For this long after playback starts, the playhead moving back is it settling, not a loop */
const SETTLE_MS = 400;
/** Draft tags closer than this (px) don't all get their number (DT-5) */
const TAG_GAP_PX = 18;

type AlignWithOffset = TimelineAlign & { readonly offset: number };

/** What `usePunchTap` gives the timeline to draw and the header to show */
export interface PunchTapController {
    readonly isPlaying: boolean;
    /** The drafts, in tap order */
    readonly taps: readonly CountTap[];
    /** The count the next tap (or T while paused) sets, or null when there's none */
    readonly target: number | null;
    readonly targetLabel: string | null;
    /** How the next target's page is tapped, and why ("Every count: slow page") */
    readonly targetUnit: PunchTapUnit;
    readonly unitReason: PunchTapUnitReason;
    /** The user's choice for this take */
    readonly unitChoice: PunchTapUnitChoice;
    readonly setUnitChoice: (choice: PunchTapUnitChoice) => void;
    /** What the drafts would write, or null without drafts */
    readonly preview: AlignPreview | null;
    readonly suspect: ReadonlyMap<number, SuspectTap>;
    /** Done would change these typed tempos: waiting for Override or Keep typed */
    readonly confirming: readonly TypedSection[] | null;
    readonly pages: readonly AlignPage[];
    readonly tap: (eventTimeStamp: number) => void;
    readonly retarget: (index: number) => void;
    /** Done: applies the take (asking first over a typed tempo) */
    readonly applyDrafts: () => void;
    /** Override: applies the take over the typed tempos */
    readonly confirm: () => void;
    /** Keep typed: the take stays, as drafts */
    readonly keepTyped: () => void;
    /** Discard take: the only way drafts are thrown away */
    readonly discard: () => void;
}

/**
 * The punch-in tap session for the Align view, or null when the Tempo lab flag is off (no
 * `align.punchTap`) or Align isn't showing. Owns T, Backspace and Enter while Align shows and the
 * flag is on. The take lives on while Align is closed, so leaving and coming back finds it.
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
    const [unitChoice, setUnitChoiceState] =
        useState<PunchTapUnitChoice>("auto");
    const [confirming, setConfirming] = useState<
        readonly TypedSection[] | null
    >(null);
    const offset = align?.offset ?? 0;
    const durations = align?.durations;
    const units = align?.tempoMap?.units;
    // Each page's own unit, from its current lengths (DT-2)
    const autoUnits = useMemo(() => {
        const out = new Map<number, ReturnType<typeof pageTapUnit>>();
        if (!durations) return out;
        const weights = units?.map((u) => u?.weight);
        for (const page of pages)
            out.set(page.start, pageTapUnit(durations, page, weights));
        return out;
    }, [durations, pages, units]);
    const unitOf = useCallback(
        (page: AlignPage): PunchTapUnit =>
            unitChoice === "auto"
                ? (autoUnits.get(page.start)?.unit ?? "page")
                : unitChoice,
        [autoUnits, unitChoice],
    );
    const targets = useMemo(
        () => (durations ? punchTargets(pages, durations.length, unitOf) : []),
        [durations, pages, unitOf],
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
    const targetPage = target === null ? null : pageOfTarget(pages, target);
    const targetUnit: PunchTapUnit = targetPage ? unitOf(targetPage) : "page";
    const unitReason: PunchTapUnitReason =
        unitChoice !== "auto"
            ? "chosen"
            : targetPage
              ? (autoUnits.get(targetPage.start)?.reason ?? "steady")
              : "steady";

    const result = useMemo(
        () =>
            align && state.taps.length > 0
                ? punchTapResult({
                      durations: align.durations,
                      taps: state.taps,
                      synced: align.synced,
                      unit: takeUnit(pages, state.taps, unitOf),
                  })
                : null,
        [align, pages, state.taps, unitOf],
    );
    const suspect = useMemo(
        () => suspectTaps({ taps: state.taps }),
        [state.taps],
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
    const current = {
        align,
        config,
        state,
        targets,
        target,
        targetUnit,
        isPlaying,
        unitOf,
        pages,
        enabled,
        confirming,
    };
    const latest = useRef(current);
    latest.current = current;
    const startedByTap = useRef(false);

    const endTake = useCallback(() => {
        setState(EMPTY_PUNCH_TAP);
        setConfirming(null);
        setUnitChoiceState("auto");
    }, []);

    /**
     * Writes the take. `how`: Done or Enter (`done`) asks first over a typed tempo; leaving Align
     * or switching tools (`leave`) can't ask, so such a take stays as drafts, and says so.
     */
    const applyDrafts = useCallback(
        (how: "done" | "leave" = "done", confirmed = false) => {
            const {
                align: a,
                config: c,
                state: s,
                pages: p,
                unitOf: unitFor,
            } = latest.current;
            if (!a || !c || s.taps.length === 0) return;
            const written = punchTapResult({
                durations: a.durations,
                taps: s.taps,
                synced: a.synced,
                unit: takeUnit(p, s.taps, unitFor),
            });
            if (!written) return;
            // A typed tempo changes only when the user says so (FX-5)
            const overrides = overriddenSections(
                a.tempoMap?.sections ?? [],
                a.durations,
                written.durations,
            );
            if (overrides.length > 0 && !confirmed) {
                if (how === "done") setConfirming(overrides);
                else {
                    setConfirming(null);
                    c.onNotice?.(
                        t("tempo.punchTap.keptForTyped", {
                            count: s.taps.length,
                            tempo: overrides[0]!.tempo,
                            measures: overrides[0]!.measures,
                        }),
                    );
                }
                return;
            }
            endTake();
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
        },
        [endTake, t],
    );

    const tap = useCallback((eventTimeStamp: number) => {
        const {
            align: a,
            config: c,
            state: s,
            targets: ts,
            target: tg,
            targetUnit: u,
            isPlaying: playing,
            enabled: on,
            confirming: asking,
        } = latest.current;
        if (!on || !a || !c || asking) return;
        if (!playing) {
            // Paused: play a count-in before the target; the taps come while it plays
            if (tg === null) return;
            setState((now) => retargetPunchTap(now, tg));
            startedByTap.current = true;
            if (!c.play(countInFrom(ts, tg, u))) startedByTap.current = false;
            return;
        }
        const time = c.liveTime(eventTimeStamp);
        const hit = s.next ?? upcomingTarget(ts, a.durations, time);
        if (hit === null) return;
        setState((now) =>
            addPunchTap(now, {
                target: now.next ?? hit,
                time,
                stamp: eventTimeStamp,
                targets: ts,
            }),
        );
    }, []);

    const retarget = useCallback((index: number) => {
        setState((now) => retargetPunchTap(now, index));
    }, []);

    const setUnitChoice = useCallback((choice: PunchTapUnitChoice) => {
        setUnitChoiceState(choice);
        // The chosen target may not be one any more: the next tap finds its own
        setState((now) =>
            now.next === null || now.next === NO_TARGET_LEFT
                ? now
                : { ...now, next: null },
        );
    }, []);

    // Playback started by Space (not T) taps the next target the music reaches; a loop or a jump
    // back does the same from where it lands. Pausing keeps the take (DT-1).
    const wasPlaying = useRef(isPlaying);
    const lastBeat = useRef(positionBeat);
    const startedAt = useRef(0);
    useEffect(() => {
        const started = isPlaying && !wasPlaying.current;
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
                setState((now) => ({ ...now, next: null }));
            startedByTap.current = false;
        } else if (jumpedBack) setState((now) => ({ ...now, next: null }));
    }, [isPlaying, positionBeat]);

    // Leaving Align, or opening another tool that taps (Tap the beat), applies the take (DT-1)
    const wasEnabled = useRef(enabled);
    const otherTool = config?.otherToolOpen ?? false;
    const wasOtherTool = useRef(otherTool);
    useEffect(() => {
        const left = wasEnabled.current && !enabled;
        const switched = otherTool && !wasOtherTool.current;
        wasEnabled.current = enabled;
        wasOtherTool.current = otherTool;
        if (left || switched) applyDrafts("leave");
    }, [applyDrafts, enabled, otherTool]);

    // T, Backspace and Enter, before the app's shortcuts see them
    useEffect(() => {
        if (!enabled) return;
        const onKey = (event: KeyboardEvent) => {
            const { config: c, state: s, confirming: asking } = latest.current;
            if (
                !c ||
                asking ||
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
                setState(dropLastPunchTap);
            } else if (key === "Enter" && hasTaps) {
                event.preventDefault();
                event.stopPropagation();
                applyDrafts("done");
            }
        };
        window.addEventListener("keydown", onKey, { capture: true });
        return () =>
            window.removeEventListener("keydown", onKey, { capture: true });
    }, [applyDrafts, enabled, tap]);

    if (!enabled) return null;
    return {
        isPlaying,
        taps: state.taps,
        target,
        targetLabel:
            target === null
                ? null
                : targetName(pages, target, t("tempo.punchTap.countOne")),
        targetUnit,
        unitReason,
        unitChoice,
        setUnitChoice,
        preview,
        suspect,
        confirming,
        pages,
        tap,
        retarget,
        applyDrafts: () => applyDrafts("done"),
        confirm: () => applyDrafts("done", true),
        keepTyped: () => setConfirming(null),
        discard: endTake,
    };
}

const menuItemClass =
    "rounded-4 data-[highlighted]:bg-fg-2 flex cursor-default items-center gap-6 px-8 py-6 text-[12px] outline-hidden select-none";

/**
 * What a tap sets in this take, and why (DT-2): "Every count: slow page", with a menu to choose
 * page starts or every count for the whole take, or each page's own again.
 */
function PunchTapUnitMenu({ punch }: { punch: PunchTapController }) {
    const t = alignT;
    const label = t("tempo.punchTap.unitLabel", {
        unit: t(`tempo.punchTap.unit.${punch.targetUnit}`),
        reason: t(`tempo.punchTap.reason.${punch.unitReason}`),
    });
    const choices: { value: PunchTapUnitChoice; text: string }[] = [
        { value: "auto", text: t("tempo.punchTap.unitAuto") },
        { value: "page", text: t("tempo.punchTap.unit.page") },
        { value: "count", text: t("tempo.punchTap.unit.count") },
    ];
    return (
        <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
                <button
                    type="button"
                    data-testid="timeline-punch-tap-unit"
                    title={t("tempo.punchTap.unitTooltip")}
                    className="rounded-4 text-text-subtitle hover:bg-fg-2 hover:text-text focus-visible:ring-accent flex h-20 items-center gap-2 px-4 font-mono text-[11px] whitespace-nowrap outline-hidden focus-visible:ring-2"
                >
                    {label}
                    <CaretDownIcon size={10} />
                </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    {...timelineMenuContentGuards}
                    data-testid="timeline-punch-tap-unit-menu"
                    align="end"
                    className="bg-modal text-text rounded-6 border-stroke shadow-modal z-[200] flex min-w-[200px] flex-col gap-2 border p-4 backdrop-blur-md"
                >
                    <DropdownMenu.Label className="text-text-subtitle px-8 py-4 text-[11px]">
                        {t("tempo.punchTap.unitMenuTitle")}
                    </DropdownMenu.Label>
                    {choices.map((choice) => (
                        <DropdownMenu.Item
                            key={choice.value}
                            data-testid={`timeline-punch-tap-unit-${choice.value}`}
                            onSelect={() => punch.setUnitChoice(choice.value)}
                            className={menuItemClass}
                        >
                            <span className="w-12">
                                {punch.unitChoice === choice.value && (
                                    <CheckIcon size={12} />
                                )}
                            </span>
                            {choice.text}
                        </DropdownMenu.Item>
                    ))}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}

/**
 * The header's Tap button and chips: what a tap sets ("Every count: slow page"), "Next tap → Pg
 * 12 ct 16" (or "3 taps · Next → …"), and once there are drafts, Done and Discard take. Done over
 * a typed tempo asks Override or Keep typed, as an Align drag does.
 */
export function TimelinePunchTapControls({
    punch,
}: {
    punch: PunchTapController;
}) {
    const t = alignT;
    const ref = useRef<HTMLDivElement>(null);
    const count = punch.taps.length;
    const next = punch.targetLabel
        ? t("tempo.punchTap.next", { target: punch.targetLabel })
        : t("tempo.punchTap.noTarget");
    const chip =
        count > 0 ? t("tempo.punchTap.tapsAndNext", { count, next }) : next;
    const confirmPreview = (): AlignPreview | null => {
        if (!punch.confirming || !punch.preview) return null;
        const bounds = ref.current?.getBoundingClientRect();
        return {
            ...punch.preview,
            overrides: punch.confirming,
            confirming: true,
            anchor: bounds
                ? {
                      x: bounds.left + bounds.width / 2,
                      top: bounds.top,
                      left: bounds.left,
                      right: bounds.right,
                  }
                : null,
        };
    };
    const asking = confirmPreview();
    return (
        <div
            ref={ref}
            className="flex shrink-0 items-center gap-4"
            data-testid="timeline-punch-tap"
        >
            <button
                type="button"
                data-testid="timeline-punch-tap-button"
                aria-pressed={punch.isPlaying && count > 0}
                title={
                    punch.targetUnit === "count"
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
            <PunchTapUnitMenu punch={punch} />
            <span
                role="status"
                data-testid="timeline-punch-tap-chip"
                className="rounded-6 border-stroke text-text-subtitle border px-6 py-1 font-mono text-[11px] whitespace-nowrap"
            >
                {chip}
            </span>
            {count > 0 && (
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
                        className="rounded-4 text-text hover:bg-fg-2 h-20 px-6 text-[11px] whitespace-nowrap"
                    >
                        {t("tempo.punchTap.discard")}
                    </button>
                </>
            )}
            {asking && (
                <TimelineAlignConfirm
                    preview={asking}
                    onConfirm={punch.confirm}
                    onCancel={punch.keepTyped}
                />
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
    // At a low zoom (every count at Align's opening zoom), only some tags get a number (DT-5)
    const flagIndexes = new Set(alignFlags(punch.pages).map((f) => f.index));
    const numbered = numberedTags(
        punch.taps.map((tap) => ({
            index: tap.index,
            x: tap.time * pixelsPerSecond,
            priority: punch.suspect.has(tap.index)
                ? 2
                : flagIndexes.has(tap.index)
                  ? 1
                  : 0,
        })),
        TAG_GAP_PX,
    );
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
                const showNumber = numbered.has(tap.index);
                const title = suspect
                    ? t(
                          suspect.kind === "extra"
                              ? "tempo.punchTap.suspectExtra"
                              : "tempo.punchTap.suspect",
                          {
                              target: name,
                              bpm: suspect.bpm,
                              was: suspect.beforeBpm,
                          },
                      )
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
                            data-numbered={showNumber || undefined}
                            data-timeline-interactive="true"
                            title={title}
                            aria-label={title}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.stopPropagation();
                                punch.retarget(tap.index);
                            }}
                            className={clsx(
                                "pointer-events-auto absolute -translate-x-1/2 rounded-full font-mono leading-none font-bold",
                                showNumber
                                    ? "top-[2px] flex h-14 min-w-14 items-center justify-center px-2 text-[9px]"
                                    : "top-[6px] size-6",
                                suspect
                                    ? "bg-yellow text-black"
                                    : "bg-accent text-text-invert",
                            )}
                            style={{ left: x }}
                        >
                            {showNumber && (suspect ? `${n}?` : n)}
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
