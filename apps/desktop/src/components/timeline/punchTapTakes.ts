/**
 * Punch-in tap (E9, Tempo lab `punchInTap`; docs/tempo/decisions.md PT-*, DT-*): tap along in the
 * Align view to put flags (or every count) on the music, from any page, fixing mistakes without
 * starting over. Pure state and rules; `TimelinePunchTap.tsx` draws them and owns the keys.
 *
 * Counts are spec count indexes, as in `@/timeline/tempo`. A tap pins the start of a count (a
 * flag is where its page ends, so its index is the next page's start) at a time on the show's
 * clock. Taps are drafts (a take) until applied with `applyTaps`, which only changes count
 * lengths, so it is never refused by drill.
 */
import {
    applyTaps,
    countTimes,
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
/** What the user chose for a take: each page's own unit (`pageTapUnit`), or one for every page */
export type PunchTapUnitChoice = "auto" | PunchTapUnit;
/** Why a page is tapped the way it is: slow or uneven pages count by count; `chosen` by the user */
export type PunchTapUnitReason = "slow" | "uneven" | "steady" | "chosen";

/** A second tap this soon after the one before is a bounce, not a tap (11-ui.md C Mistakes) */
export const DOUBLE_TAP_MS = 120;
/**
 * A tap whose span per count is this many times longer than the spans on both sides of it looks
 * like a missed tap (one count or page skipped makes it about 2×); this many times shorter, like
 * an extra one. Drawn amber, never dropped (DT-4; tuned on the kit's rubato truth).
 */
export const MISSED_TAP_RATIO = 1.7;
/**
 * A span longer than this many times its neighbors is a hold (a fermata or a caesura), not a
 * missed tap, and isn't drawn amber.
 */
export const HELD_SPAN_RATIO = 2.6;
/** Slower than this many counts a minute, a page is tapped count by count (DT-2) */
export const SLOW_PAGE_PER_MINUTE = 76;
/**
 * A page whose longest count is this many times its shortest (in the counts' own note, so 7/8's
 * long count isn't uneven) has a hold, a rit. or an accel., and is tapped count by count (DT-2)
 */
export const UNEVEN_PAGE_RATIO = 1.25;
/** Count mode's count-in: playback starts this many counts before the target */
export const COUNT_IN_COUNTS = 8;

/**
 * How a page is tapped when the user hasn't chosen (DT-2): every count when it's slow (under
 * `SLOW_PAGE_PER_MINUTE`) or uneven (a held count, a rit. or an accel. in its current lengths),
 * else its start. `weights` are each count's length in its note (`CountUnit.weight`), by index.
 */
export function pageTapUnit(
    durations: CountDurations,
    page: { readonly start: number; readonly end: number },
    weights?: readonly (number | undefined)[],
): { unit: PunchTapUnit; reason: Exclude<PunchTapUnitReason, "chosen"> } {
    const lengths: number[] = [];
    for (let i = Math.max(1, page.start); i < page.end; i++) {
        const d = durations[i] ?? 0;
        if (d > 0) lengths.push(d / (weights?.[i] ?? 1));
    }
    if (lengths.length === 0) return { unit: "page", reason: "steady" };
    const total = lengths.reduce((sum, d) => sum + d, 0);
    if ((lengths.length * 60) / total < SLOW_PAGE_PER_MINUTE)
        return { unit: "count", reason: "slow" };
    if (Math.max(...lengths) > Math.min(...lengths) * UNEVEN_PAGE_RATIO)
        return { unit: "count", reason: "uneven" };
    return { unit: "page", reason: "steady" };
}

/** The page a target is in: count 1 is the first page's, a flag is the page it ends */
export const pageOfTarget = <P extends { start: number; end: number }>(
    pages: readonly P[],
    index: number,
): P | null =>
    pages.find((p) => p.start < index && index <= p.end) ??
    (pages[0] && index <= pages[0].start ? pages[0] : null);

/**
 * The counts a tap can set, ascending: count 1 and every page's flag, and on pages tapped by
 * count (`unit` for every page, or each page's own), every count of the page. The end of the show
 * can't be tapped: nothing comes after it to play into, and `applyTaps` doesn't take it.
 */
export function punchTargets(
    pages: readonly AlignPage[],
    countCount: number,
    unit: PunchTapUnit | ((page: AlignPage) => PunchTapUnit),
): number[] {
    if (pages.length === 0) return [];
    const unitOf = typeof unit === "function" ? unit : () => unit;
    const all = new Set(alignFlags(pages).map((flag) => flag.index));
    for (const page of pages)
        if (unitOf(page) === "count")
            for (let index = page.start; index <= page.end; index++)
                all.add(index);
    return [...all]
        .filter((index) => index >= 1 && index < countCount)
        .sort((a, b) => a - b);
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

/**
 * How `applyTaps` spaces a take's untapped counts: evenly when every tap is on a page tapped by
 * count (a missed count lands halfway), else in proportion to their lengths, which keeps holds.
 */
export function takeUnit(
    pages: readonly AlignPage[],
    taps: readonly CountTap[],
    unitOf: (page: AlignPage) => PunchTapUnit,
): PunchTapUnit {
    if (taps.length === 0) return "page";
    return taps.every((tap) => {
        const page = pageOfTarget(pages, tap.index);
        return page !== null && unitOf(page) === "count";
    })
        ? "count"
        : "page";
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

/** A tap drawn amber: the span it ends is out of step with the spans on both sides of it */
export interface SuspectTap {
    readonly index: number;
    /** A missed tap (the span is about twice as long) or an extra one (about half) */
    readonly kind: "missed" | "extra";
    /** The tapped span's tempo, and its neighbors', in counts a minute (rounded) */
    readonly bpm: number;
    readonly beforeBpm: number;
}

/** The middle value (the mean of the middle two) */
const median = (values: readonly number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
        ? sorted[mid]!
        : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Taps out of step with their neighbors (DT-4). Each tap's span (from the tap before it, per
 * count) is compared with the spans beside it: the one just before and the one just after, or at
 * the edge of a take the two on its one side, and with the median of up to three spans each side.
 * It's suspect when it's at least `MISSED_TAP_RATIO` times longer than all of them (a missed
 * tap), or that much shorter (an extra tap), so a rit., an accel. or a sudden new tempo isn't. A
 * span more than `HELD_SPAN_RATIO` times longer than one of them is a hold, not a miss. A stray tap in the middle of a count makes two short spans
 * in a row; the first is suspect when both are short against the spans around the pair. Suspect
 * taps stay (rubato is real); they're only drawn amber.
 */
export function suspectTaps({
    taps,
    ratio = MISSED_TAP_RATIO,
    held = HELD_SPAN_RATIO,
}: {
    taps: readonly CountTap[];
    ratio?: number;
    held?: number;
}): Map<number, SuspectTap> {
    const sorted = [...taps].sort((a, b) => a.index - b.index);
    // spans[k]: seconds per count from tap k-1 to tap k (null for the first, or a bad one)
    const spans = sorted.map((tap, k) => {
        const before = sorted[k - 1];
        if (!before || tap.index <= before.index) return null;
        const span = (tap.time - before.time) / (tap.index - before.index);
        return span > 0 ? span : null;
    });
    const at = (k: number) => spans[k] ?? null;
    const present = (list: (number | null)[]) =>
        list.every((s) => s !== null) ? (list as number[]) : null;
    const suspect = new Map<number, SuspectTap>();
    const mark = (
        k: number,
        kind: SuspectTap["kind"],
        span: number,
        near: number,
    ) =>
        suspect.set(sorted[k]!.index, {
            index: sorted[k]!.index,
            kind,
            bpm: Math.round(60 / span),
            beforeBpm: Math.round(60 / near),
        });
    sorted.forEach((_, k) => {
        const span = at(k);
        if (span === null) return;
        const sides =
            present([at(k - 1), at(k + 1)]) ??
            present([at(k - 1), at(k - 2)]) ??
            present([at(k + 1), at(k + 2)]);
        if (sides) {
            // Against the wider trend too, so a normal tap between a hold and a miss isn't odd
            const around = median(
                [-3, -2, -1, 1, 2, 3].flatMap((d) => at(k + d) ?? []),
            );
            const ratios = [...sides, around].map((s) => span / s);
            if (ratios.every((r) => r >= ratio)) {
                // Far longer than either side: a fermata or a caesura
                if (ratios.some((r) => r > held)) return;
                mark(k, "missed", span, Math.max(...sides));
                return;
            }
            if (ratios.every((r) => r <= 1 / ratio)) {
                mark(k, "extra", span, Math.min(...sides));
                return;
            }
        }
        // A stray tap splits a count: this span and the next are both short, and together
        // about as long as the spans around them
        const next = at(k + 1);
        const outer = present([at(k - 1), at(k + 2)]);
        if (
            next !== null &&
            outer &&
            outer.every(
                (o) =>
                    span / o <= 1 / ratio &&
                    next / o <= 1 / ratio &&
                    (span + next) / o < ratio &&
                    (span + next) / o > 1 / ratio,
            )
        )
            mark(k, "extra", span, Math.min(...outer));
    });
    return suspect;
}

/**
 * Which draft tags get their number at this zoom (DT-5): from the most telling (suspect taps,
 * then taps on page flags) to the rest in order, a tag keeps its number while no numbered tag is
 * within `minGap` pixels. The rest are drawn as small marks.
 */
export function numberedTags(
    tags: readonly {
        readonly index: number;
        readonly x: number;
        readonly priority: number;
    }[],
    minGap: number,
): Set<number> {
    const order = [...tags].sort(
        (a, b) => b.priority - a.priority || a.x - b.x,
    );
    const kept: number[] = [];
    const numbered = new Set<number>();
    for (const tag of order) {
        if (kept.some((x) => Math.abs(x - tag.x) < minGap)) continue;
        kept.push(tag.x);
        numbered.add(tag.index);
    }
    return numbered;
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
