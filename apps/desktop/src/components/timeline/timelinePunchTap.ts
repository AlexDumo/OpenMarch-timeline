/**
 * Punch-in tap (E9, Tempo lab `punchInTap`; docs/tempo/decisions.md PT-*): tap along in the Align
 * view to put flags (or every count) on the music, from any page, fixing mistakes without starting
 * over. Pure state and rules; `TimelinePunchTap.tsx` draws them and owns the keys.
 *
 * Counts are spec count indexes, as in `@/timeline/tempo`. A tap pins the start of a count (a
 * flag is where its page ends, so its index is the next page's start) at a time on the show's
 * clock. Taps are drafts until applied with `applyTaps`, which only changes count lengths, so it
 * is never refused by drill.
 */
import {
    applyTaps,
    countTimes,
    spanOf,
    type ApplyTapsResult,
    type CountDurations,
    type CountTap,
} from "@/timeline/tempo";
import {
    alignFlags,
    countName,
    pageWithFlagAt,
    type AlignPage,
} from "./timelineAlign";

/** What a tap sets: the next page flag, or the next count */
export type PunchTapUnit = "page" | "count";

/** A second tap this soon after the one before is a bounce, not a tap (11-ui.md C Mistakes) */
export const DOUBLE_TAP_MS = 120;
/**
 * A tap whose span is this much faster or slower per count than the span before it is drawn amber
 * ("Missed a tap?"). Provisional (12-ux.md 3 says ~35%); Jo's report asks for it to be measured.
 */
export const SUSPECT_TEMPO_CHANGE = 0.35;
/** Count mode's count-in: playback starts this many counts before the target */
export const COUNT_IN_COUNTS = 8;

/**
 * The counts a tap can set, ascending: count 1 and every page's flag (`page`), or every count from
 * the first page's start (`count`). The end of the show can't be tapped: nothing comes after it to
 * play into, and `applyTaps` doesn't take it.
 */
export function punchTargets(
    pages: readonly AlignPage[],
    countCount: number,
    unit: PunchTapUnit,
): number[] {
    if (pages.length === 0) return [];
    if (unit === "page")
        return alignFlags(pages)
            .map((flag) => flag.index)
            .filter((index) => index >= 1 && index < countCount);
    const first = Math.max(1, pages[0]!.start);
    const last = Math.min(countCount - 1, pages[pages.length - 1]!.end);
    const targets: number[] = [];
    for (let index = first; index <= last; index++) targets.push(index);
    return targets;
}

/** The first target after `index`, or null */
export const targetAfter = (
    targets: readonly number[],
    index: number,
): number | null => targets.find((t) => t > index) ?? null;

/** The first target at or after `index`, or null */
export const targetAtOrAfter = (
    targets: readonly number[],
    index: number,
): number | null => targets.find((t) => t >= index) ?? null;

/** The target before `index`, or null */
export const targetBefore = (
    targets: readonly number[],
    index: number,
): number | null => {
    let best: number | null = null;
    for (const t of targets) if (t < index) best = t;
    return best;
};

/**
 * Where a count-in before `target` starts: the previous flag (one page before) in page mode,
 * `COUNT_IN_COUNTS` counts before in count mode. Beat 0 (the start of the show) at the most.
 */
export function countInFrom(
    targets: readonly number[],
    target: number,
    unit: PunchTapUnit,
): number {
    if (unit === "count") return Math.max(0, target - COUNT_IN_COUNTS);
    return targetBefore(targets, target) ?? 0;
}

/**
 * While playing with no target chosen yet: the first target the music hasn't passed. A target
 * just passed still counts for half of the count before it, so a tap a little late lands on it.
 */
export function upcomingTarget(
    targets: readonly number[],
    durations: CountDurations,
    liveTime: number,
): number | null {
    const times = countTimes(durations);
    for (const t of targets) {
        const grace = (durations[t - 1] ?? 0) / 2;
        if ((times[t] ?? Infinity) >= liveTime - grace) return t;
    }
    return null;
}

/** `PunchTapState.next` after the last target was tapped: nothing is left to tap */
export const NO_TARGET_LEFT = Number.POSITIVE_INFINITY;

/** One tap's undo record: the draft it put down and the draft it replaced on that count */
interface PunchTapStep {
    readonly tap: CountTap;
    readonly replaced: CountTap | null;
}

/** A take in progress (or drafts waiting for Apply) */
export interface PunchTapState {
    /** The drafts, one per count, in the order they were tapped */
    readonly taps: readonly CountTap[];
    /** Every tap in order, for Backspace */
    readonly steps: readonly PunchTapStep[];
    /**
     * The target the next tap sets, once a tap, Backspace or a click chose it (`NO_TARGET_LEFT`
     * after the last one); else null
     */
    readonly next: number | null;
    /** The last accepted tap's event time, in ms, to ignore bounces */
    readonly lastStamp: number | null;
}

export const EMPTY_PUNCH_TAP: PunchTapState = {
    taps: [],
    steps: [],
    next: null,
    lastStamp: null,
};

/**
 * A tap on `target` at `time` (seconds on the show's clock) from an input event at `stamp` ms.
 * Returns the same state when the tap is a bounce (within `DOUBLE_TAP_MS` of the last one). A tap
 * replaces only the draft on its own count; the next target is the one after it.
 */
export function addPunchTap(
    state: PunchTapState,
    {
        target,
        time,
        stamp,
        targets,
    }: {
        target: number;
        time: number;
        stamp: number;
        targets: readonly number[];
    },
): PunchTapState {
    if (
        !Number.isFinite(target) ||
        (state.lastStamp !== null &&
            stamp >= state.lastStamp &&
            stamp - state.lastStamp < DOUBLE_TAP_MS)
    )
        return state;
    const tap = { index: target, time };
    const replaced = state.taps.find((t) => t.index === target) ?? null;
    return {
        taps: [...state.taps.filter((t) => t.index !== target), tap],
        steps: [...state.steps, { tap, replaced }],
        next: targetAfter(targets, target) ?? NO_TARGET_LEFT,
        lastStamp: stamp,
    };
}

/**
 * Backspace: drops the last tap (bringing back the draft it replaced, if any) and steps the next
 * target back to its count. Nothing to drop returns the same state.
 */
export function dropLastPunchTap(state: PunchTapState): PunchTapState {
    const last = state.steps[state.steps.length - 1];
    if (!last) return state;
    const taps = state.taps.filter((t) => t.index !== last.tap.index);
    return {
        taps: last.replaced ? [...taps, last.replaced] : taps,
        steps: state.steps.slice(0, -1),
        next: last.tap.index,
        lastStamp: null,
    };
}

/** Clicking a flag (or a draft's tag): the next tap sets it */
export const retargetPunchTap = (
    state: PunchTapState,
    target: number,
): PunchTapState => ({ ...state, next: target, lastStamp: null });

/**
 * What the drafts would write: `applyTaps` on the show as it is now, page taps re-spacing
 * proportionally and count taps evenly; after the last tap, up to the next synced count. Null
 * without drafts.
 */
export function punchTapResult({
    durations,
    taps,
    synced,
    unit,
}: {
    durations: CountDurations;
    taps: readonly CountTap[];
    synced: readonly number[];
    unit: PunchTapUnit;
}): ApplyTapsResult | null {
    const valid = taps.filter(
        (t) => t.index >= 1 && t.index < durations.length,
    );
    if (valid.length === 0) return null;
    return applyTaps({ durations, taps: valid, synced, unit });
}

/** The synced counts after applying: the tapped counts join them (count 1 always is) */
export function syncedAfterTaps(
    synced: readonly number[],
    taps: readonly CountTap[],
): number[] {
    const all = new Set(synced);
    for (const tap of taps) if (tap.index > 1) all.add(tap.index);
    return [...all].sort((a, b) => a - b);
}

/** A tap drawn amber: the span it ends is a big tempo jump from the span before */
export interface SuspectTap {
    readonly index: number;
    /** The tapped span's tempo, and the one before it, in BPM (rounded) */
    readonly bpm: number;
    readonly beforeBpm: number;
}

const meanBpm = (durations: CountDurations, from: number, to: number) => {
    const span = spanOf(durations, from, to);
    return span > 0 ? ((to - from) * 60) / span : null;
};

/**
 * Taps whose span (from the target before them) is more than `threshold` faster or slower per
 * count than the span before that, in the drafted timing. They stay (rubato is real); they're
 * only drawn amber. A tap with fewer than two targets before it isn't judged.
 */
export function suspectTaps({
    durations,
    targets,
    taps,
    threshold = SUSPECT_TEMPO_CHANGE,
}: {
    /** The drafted timing (`punchTapResult(...).durations`) */
    durations: CountDurations;
    targets: readonly number[];
    taps: readonly CountTap[];
    threshold?: number;
}): Map<number, SuspectTap> {
    const suspect = new Map<number, SuspectTap>();
    for (const tap of taps) {
        const previous = targetBefore(targets, tap.index);
        if (previous === null) continue;
        const before = targetBefore(targets, previous);
        if (before === null) continue;
        const bpm = meanBpm(durations, previous, tap.index);
        const beforeBpm = meanBpm(durations, before, previous);
        if (bpm === null || beforeBpm === null) continue;
        if (Math.abs(bpm / beforeBpm - 1) > threshold)
            suspect.set(tap.index, {
                index: tap.index,
                bpm: Math.round(bpm),
                beforeBpm: Math.round(beforeBpm),
            });
    }
    return suspect;
}

/**
 * A target as the chip names it: "count 1", or the moment as the transport reads it (UI-13), so
 * a page's flag is its last count: "Pg 12 ct 16". `countOne` is the translated "count 1".
 */
export const targetName = (
    pages: readonly AlignPage[],
    index: number,
    countOne: string,
): string => (index <= 1 ? countOne : countName(pages, index));

/**
 * The pages the taps lined up, for the toast: the first and last page whose flag (page mode) or
 * counts (count mode) were tapped. Null without taps or pages.
 */
export function tappedPages(
    pages: readonly AlignPage[],
    taps: readonly CountTap[],
): { first: string; last: string } | null {
    if (taps.length === 0 || pages.length === 0) return null;
    const indexes = taps.map((t) => t.index);
    const pageOf = (index: number) =>
        pageWithFlagAt(pages, index) ??
        pages.find((p) => p.start < index && index <= p.end) ??
        pages[0]!;
    return {
        first: pageOf(Math.min(...indexes)).label,
        last: pageOf(Math.max(...indexes)).label,
    };
}
