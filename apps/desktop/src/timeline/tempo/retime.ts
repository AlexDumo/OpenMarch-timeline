/**
 * Pure retiming of a show's counts (docs/tempo/README.md). Every function here takes the show's
 * count durations and returns new durations; none adds, removes or reorders counts, so the result
 * written to the same beat ids is a duration-only edit, which the timeline ripple treats as a
 * no-op (`timelineRipple.ts`, `sameGrid`) and can never refuse.
 *
 * Conventions, shared with `timeMap.ts`:
 * - `durations[i]` is the length in seconds of count `i` (the beat at ordinal `i`). Count 0 is the
 *   fixed zero-length beat every show starts with; nothing here changes it.
 * - Count 1 always starts at show time 0. Moving it is reported as `originShift` (seconds, in the
 *   old show time) for the caller to apply to the audio offset; the durations stay relative to it.
 * - Ranges are half-open: `[from, to)` covers counts `from` to `to - 1`.
 * - "Synced" counts are ones the user has put on the music. Edits re-space up to the nearest
 *   synced count instead of moving it. Count 1 always counts as synced on its left.
 * - Durations stay floats and are never rounded, so typed decimal tempos stay exact.
 */

/** Shortest a computed count may get: 400 BPM (11-ui.md "Minimum tempo"). */
export const MIN_COUNT_SECONDS = 60 / 400;
/**
 * Longest a computed count may get. Generous on purpose: drags and taps can make long holds (a
 * fermata in the kit is 6.5 s); the 40 BPM floor applies only to typed tempos.
 */
export const MAX_COUNT_SECONDS = 30;

export type CountDurations = readonly number[];
/** Synced count indexes, as a set or a list. */
export type SyncedCounts = ReadonlySet<number> | readonly number[];

/**
 * What happens to the counts after an edited count.
 * - `respaceToNextSynced`: counts up to the next synced count re-space (keeping their relative
 *   lengths) so it stays put; with no later synced count, everything after shifts.
 * - `shift`: everything after shifts with its tempo unchanged, even past synced counts (an
 *   explicit override, such as a modifier-drag).
 */
export type AfterRule = "shift" | "respaceToNextSynced";

/** Why an edit was limited: a count would have got shorter than the minimum or longer than the maximum. */
export type ClampReason = "minCount" | "maxCount";

/** A half-open range of counts. */
export interface CountRange {
    readonly from: number;
    readonly to: number;
}

/** What an edit changes, for "what will move" chips. */
export interface RetimeEffect {
    /** Ranges whose counts got new lengths. */
    readonly respaced: readonly CountRange[];
    /**
     * Counts from `from` to the end of the show moved by `bySeconds` with their lengths unchanged.
     * Null when nothing shifted.
     */
    readonly shifted: {
        readonly from: number;
        readonly bySeconds: number;
    } | null;
    /** The synced count from which everything stays where it was, or null. */
    readonly heldFrom: number | null;
}

export interface RetimeResult {
    /** The new durations, same length as the input. */
    readonly durations: number[];
    /**
     * How far count 1 moved, in seconds of the old show time; 0 unless count 1 moved. The caller
     * subtracts it from the audio offset (`newOffset = oldOffset - originShift`) so the music
     * stays where it was relative to every count that didn't move.
     */
    readonly originShift: number;
    readonly effect: RetimeEffect;
    /** True when the requested edit had to be limited. */
    readonly clamped: boolean;
    readonly clampReason?: ClampReason;
    /** Which side of the edited count set the limit. */
    readonly clampSide?: "before" | "after";
}

const assertIndex = (
    durations: CountDurations,
    index: number,
    what: string,
) => {
    if (!Number.isInteger(index) || index < 1 || index >= durations.length)
        throw new RangeError(
            `${what} must be a count from 1 to ${durations.length - 1}, got ${index}`,
        );
};

const assertRange = (durations: CountDurations, from: number, to: number) => {
    if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        to > durations.length ||
        from > to
    )
        throw new RangeError(
            `range [${from}, ${to}) is not inside counts 0 to ${durations.length}`,
        );
};

const toSet = (synced: SyncedCounts | undefined): ReadonlySet<number> =>
    synced instanceof Set ? synced : new Set(synced ?? []);

/**
 * Start time of every count, plus the end of the show: `times[i]` is when count `i` starts and
 * `times[durations.length]` is when the last count ends. Length `durations.length + 1`.
 */
export function countTimes(durations: CountDurations): number[] {
    const times = new Array<number>(durations.length + 1);
    let t = 0;
    times[0] = 0;
    for (let i = 0; i < durations.length; i++) {
        t += durations[i];
        times[i + 1] = t;
    }
    return times;
}

/** The inverse of `countTimes`: `times.length - 1` durations. Times must start at 0. */
export function durationsFromTimes(times: readonly number[]): number[] {
    const durations = new Array<number>(Math.max(times.length - 1, 0));
    for (let i = 0; i < durations.length; i++)
        durations[i] = times[i + 1] - times[i];
    return durations;
}

/** Total length of the counts in `[from, to)`. */
export function spanOf(
    durations: CountDurations,
    from: number,
    to: number,
): number {
    let s = 0;
    for (let i = from; i < to; i++) s += durations[i];
    return s;
}

/**
 * Sets the counts in `[from, to)` to last `newSpan` seconds in total, keeping their relative
 * lengths (a hold stays a hold). Counts of zero total length are spaced evenly instead. Does not
 * clamp. Returns a new array.
 */
export function respaceProportional(
    durations: CountDurations,
    from: number,
    to: number,
    newSpan: number,
): number[] {
    assertRange(durations, from, to);
    const out = durations.slice();
    if (from === to) return out;
    const old = spanOf(durations, from, to);
    if (!(old > 0)) return respaceEven(durations, from, to, newSpan);
    const factor = newSpan / old;
    for (let i = from; i < to; i++) out[i] = durations[i] * factor;
    return out;
}

/** Sets the counts in `[from, to)` to equal lengths totalling `newSpan` seconds. Does not clamp. */
export function respaceEven(
    durations: CountDurations,
    from: number,
    to: number,
    newSpan: number,
): number[] {
    assertRange(durations, from, to);
    const out = durations.slice();
    const each = newSpan / (to - from);
    for (let i = from; i < to; i++) out[i] = each;
    return out;
}

/**
 * Multiplies the counts in `[from, to)` by `factor` (2 = half the tempo). Later counts shift.
 * Does not clamp.
 */
export function scaleRange(
    durations: CountDurations,
    from: number,
    to: number,
    factor: number,
): number[] {
    assertRange(durations, from, to);
    if (!(factor > 0) || !Number.isFinite(factor))
        throw new RangeError(`scale factor must be positive, got ${factor}`);
    const out = durations.slice();
    for (let i = from; i < to; i++) out[i] = durations[i] * factor;
    return out;
}

/**
 * Sets the tempo of `[from, to)` to `bpm`, as typed. By default every count becomes exactly
 * `60 / bpm` seconds; with `keepRelative` the counts keep their relative lengths and the range's
 * average becomes `bpm`. Later counts shift (use `keepSyncedAfter` to hold a synced count).
 * Does not clamp: the typed-tempo floor is the caller's.
 */
export function setRangeBpm(
    durations: CountDurations,
    from: number,
    to: number,
    bpm: number,
    { keepRelative = false }: { keepRelative?: boolean } = {},
): number[] {
    assertRange(durations, from, to);
    if (!(bpm > 0) || !Number.isFinite(bpm))
        throw new RangeError(`tempo must be positive, got ${bpm}`);
    const each = 60 / bpm;
    if (!keepRelative) {
        const out = durations.slice();
        for (let i = from; i < to; i++) out[i] = each;
        return out;
    }
    return respaceProportional(durations, from, to, each * (to - from));
}

/**
 * The totals `[min, max]` the counts in `[from, to)` may be re-spaced to without any count leaving
 * `[MIN_COUNT_SECONDS, MAX_COUNT_SECONDS]`. A count already outside those limits may stay as it
 * is but not get worse, so the current span is always allowed (except for zero-length counts,
 * which re-space evenly). An empty range allows only 0.
 */
export function spanLimits(
    durations: CountDurations,
    from: number,
    to: number,
): [number, number] {
    const m = to - from;
    if (m <= 0) return [0, 0];
    const old = spanOf(durations, from, to);
    if (!(old > 0)) return [m * MIN_COUNT_SECONDS, m * MAX_COUNT_SECONDS];
    let lo = 0;
    let hi = Infinity;
    for (let i = from; i < to; i++) {
        const d = durations[i];
        if (!(d > 0)) continue;
        lo = Math.max(lo, MIN_COUNT_SECONDS / d);
        hi = Math.min(hi, MAX_COUNT_SECONDS / d);
    }
    return [old * Math.min(lo, 1), old * Math.max(hi, 1)];
}

/** The last synced count before `index`, or 1 (count 1 is always synced). */
export function previousSynced(synced: SyncedCounts, index: number): number {
    let best = 1;
    for (const s of toSet(synced)) if (s < index && s > best) best = s;
    return best;
}

/** The first synced count after `index` (up to `durations.length`, the end of the show), or null. */
export function nextSynced(
    synced: SyncedCounts,
    index: number,
    countCount: number,
): number | null {
    let best: number | null = null;
    for (const s of toSet(synced))
        if (s > index && s <= countCount && (best === null || s < best))
            best = s;
    return best;
}

/** One side's limit on a time, and what reason applies when the time is clamped up or down to it. */
interface Bound {
    lo: number;
    hi: number;
    /** Reason when clamped up to `lo` */
    loReason: ClampReason;
    /** Reason when clamped down to `hi` */
    hiReason: ClampReason;
    side: "before" | "after";
}

interface Clamp {
    time: number;
    clamped: boolean;
    clampReason?: ClampReason;
    clampSide?: "before" | "after";
}

/** Clamps `wanted` into every bound. If they don't overlap, keeps `fallback` (the current time). */
function clampToBounds(
    wanted: number,
    bounds: Bound[],
    fallback: number,
): Clamp {
    let lo = -Infinity;
    let hi = Infinity;
    let loBy: Bound | undefined;
    let hiBy: Bound | undefined;
    for (const b of bounds) {
        if (b.lo > lo) [lo, loBy] = [b.lo, b];
        if (b.hi < hi) [hi, hiBy] = [b.hi, b];
    }
    if (lo > hi) {
        const by = Math.abs(wanted - lo) < Math.abs(wanted - hi) ? hiBy : loBy;
        return {
            time: fallback,
            clamped: wanted !== fallback,
            clampReason: by === hiBy ? hiBy?.hiReason : loBy?.loReason,
            clampSide: by?.side,
        };
    }
    if (wanted < lo)
        return {
            time: lo,
            clamped: true,
            clampReason: loBy!.loReason,
            clampSide: loBy!.side,
        };
    if (wanted > hi)
        return {
            time: hi,
            clamped: true,
            clampReason: hiBy!.hiReason,
            clampSide: hiBy!.side,
        };
    return { time: wanted, clamped: false };
}

/** Bound on the time of count `to` when `[from, to)` re-spaces and count `from` starts at `start`. */
function boundBefore(
    durations: CountDurations,
    from: number,
    to: number,
    start: number,
): Bound {
    const [min, max] = spanLimits(durations, from, to);
    return {
        lo: start + min,
        hi: start + max,
        loReason: "minCount",
        hiReason: "maxCount",
        side: "before",
    };
}

/** Bound on the time of count `from` when `[from, to)` re-spaces and count `to` stays at `end`. */
function boundAfter(
    durations: CountDurations,
    from: number,
    to: number,
    end: number,
): Bound {
    const [min, max] = spanLimits(durations, from, to);
    return {
        lo: end - max,
        hi: end - min,
        loReason: "maxCount",
        hiReason: "minCount",
        side: "after",
    };
}

export interface MoveCountArgs {
    durations: CountDurations;
    /** The count to move, 1 to `durations.length - 1`. */
    index: number;
    /** Where count `index` should start, in the current show time (seconds). */
    toTime: number;
    synced?: SyncedCounts;
    /** Defaults to `respaceToNextSynced`. */
    after?: AfterRule;
}

export interface MoveCountResult extends RetimeResult {
    /** Where the count landed, in the old show time, after clamping. */
    readonly time: number;
}

/**
 * Moves the start of count `index` to `toTime` ("scale left, move right").
 *
 * - Counts back to the previous synced count (or count 1) re-space proportionally.
 * - After it, with `respaceToNextSynced` and a later synced count, counts up to that count
 *   re-space proportionally and everything from it on stays put. Otherwise everything after
 *   shifts with its tempo unchanged.
 * - Moving count 1 moves the show's start against the music: the result's `originShift`.
 *
 * The time is clamped so no re-spaced count gets shorter than `MIN_COUNT_SECONDS` or longer than
 * `MAX_COUNT_SECONDS`.
 */
export function moveCount({
    durations,
    index,
    toTime,
    synced = [],
    after = "respaceToNextSynced",
}: MoveCountArgs): MoveCountResult {
    assertIndex(durations, index, "index");
    if (!Number.isFinite(toTime)) throw new RangeError(`toTime must be finite`);
    const times = countTimes(durations);
    const prev = index === 1 ? null : previousSynced(synced, index);
    const next =
        after === "respaceToNextSynced"
            ? nextSynced(synced, index, durations.length)
            : null;

    const bounds: Bound[] = [];
    if (prev !== null)
        bounds.push(boundBefore(durations, prev, index, times[prev]));
    if (next !== null)
        bounds.push(boundAfter(durations, index, next, times[next]));
    const c = clampToBounds(toTime, bounds, times[index]);
    const t = c.time;

    let out = durations.slice();
    const respaced: CountRange[] = [];
    if (prev !== null) {
        out = respaceProportional(out, prev, index, t - times[prev]);
        respaced.push({ from: prev, to: index });
    }
    if (next !== null) {
        out = respaceProportional(out, index, next, times[next] - t);
        respaced.push({ from: index, to: next });
    }
    const moved = t - times[index];
    return {
        durations: out,
        time: t,
        originShift: index === 1 ? moved : 0,
        effect: {
            respaced,
            shifted:
                next === null && moved !== 0
                    ? { from: index, bySeconds: moved }
                    : null,
            heldFrom: next,
        },
        clamped: c.clamped,
        clampReason: c.clampReason,
        clampSide: c.clampSide,
    };
}

export interface HoldCountArgs {
    durations: CountDurations;
    /** The count to lengthen or shorten, 1 to `durations.length - 1`. */
    index: number;
    /** The count's new length in seconds. */
    newDuration: number;
    synced?: SyncedCounts;
    /** Defaults to `respaceToNextSynced`. */
    after?: AfterRule;
}

/**
 * Changes one count's length (a hold, as for a fermata). With `respaceToNextSynced` and a later
 * synced count, the counts between them re-space proportionally to absorb the change, so that
 * count stays put; when no count lies between them there is no room, and the hold is limited to
 * what is possible (often nothing). Otherwise later counts shift.
 */
export function holdCount({
    durations,
    index,
    newDuration,
    synced = [],
    after = "respaceToNextSynced",
}: HoldCountArgs): RetimeResult {
    assertIndex(durations, index, "index");
    if (!Number.isFinite(newDuration))
        throw new RangeError(`newDuration must be finite`);
    const times = countTimes(durations);
    const old = durations[index];
    const next =
        after === "respaceToNextSynced"
            ? nextSynced(synced, index, durations.length)
            : null;

    // Work in the end time of the held count, so the shared clamp applies
    const bounds: Bound[] = [
        {
            lo: times[index] + Math.min(MIN_COUNT_SECONDS, old),
            hi: times[index] + Math.max(MAX_COUNT_SECONDS, old),
            loReason: "minCount",
            hiReason: "maxCount",
            side: "before",
        },
    ];
    if (next !== null)
        bounds.push(boundAfter(durations, index + 1, next, times[next]));
    const c = clampToBounds(
        times[index] + newDuration,
        bounds,
        times[index + 1],
    );
    const d = c.time - times[index];

    const out = durations.slice();
    out[index] = d;
    const respaced: CountRange[] = [{ from: index, to: index + 1 }];
    let result = out;
    if (next !== null && next > index + 1) {
        result = respaceProportional(
            out,
            index + 1,
            next,
            times[next] - c.time,
        );
        respaced.push({ from: index + 1, to: next });
    }
    const moved = d - old;
    return {
        durations: result,
        originShift: 0,
        effect: {
            respaced,
            shifted:
                next === null && moved !== 0
                    ? { from: index + 1, bySeconds: moved }
                    : null,
            heldFrom: next,
        },
        clamped: c.clamped,
        clampReason: c.clampReason,
        clampSide: c.clampSide,
    };
}

/** A tap: count `index` should start at `time` (seconds, in the current show time). */
export interface CountTap {
    readonly index: number;
    readonly time: number;
}

export interface ApplyTapsArgs {
    durations: CountDurations;
    taps: readonly CountTap[];
    synced?: SyncedCounts;
    /** Defaults to `respaceToNextSynced`. */
    after?: AfterRule;
    /**
     * What the user tapped. `page` (default): taps are page starts, and the counts between two
     * taps re-space proportionally, keeping holds and score tempo changes. `count`: every count
     * was tapped, so a gap between taps is a missed tap and its counts re-space evenly.
     */
    unit?: "page" | "count";
}

export interface ApplyTapsResult extends RetimeResult {
    /** Where each tapped count landed after clamping, in tap order (sorted by index). */
    readonly taps: readonly CountTap[];
    /** Indexes of taps that had to be moved to keep counts within the limits. */
    readonly clampedTaps: readonly number[];
}

/**
 * Pins each tapped count's start to its tap time. Counts before the first tap re-space back to the
 * previous synced count (or count 1); counts between consecutive taps re-space; after the last
 * tap the `after` rule applies as in `moveCount`. Taps never add or remove counts. Taps are sorted
 * by index; a later tap on the same count replaces an earlier one. A tap that would make a count
 * too short or too long (including a tap earlier than the one before it) is clamped.
 */
// eslint-disable-next-line max-lines-per-function
export function applyTaps({
    durations,
    taps,
    synced = [],
    after = "respaceToNextSynced",
    unit = "page",
}: ApplyTapsArgs): ApplyTapsResult {
    const byIndex = new Map<number, number>();
    for (const tap of taps) {
        assertIndex(durations, tap.index, "tap index");
        if (!Number.isFinite(tap.time))
            throw new RangeError(`tap time must be finite`);
        byIndex.set(tap.index, tap.time);
    }
    const sorted = [...byIndex.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([index, time]) => ({ index, time }));
    if (sorted.length === 0)
        return {
            durations: durations.slice(),
            originShift: 0,
            effect: { respaced: [], shifted: null, heldFrom: null },
            clamped: false,
            taps: [],
            clampedTaps: [],
        };

    const respace = unit === "count" ? respaceEven : respaceProportional;
    const times = countTimes(durations);
    const last = sorted[sorted.length - 1];
    const next =
        after === "respaceToNextSynced"
            ? nextSynced(synced, last.index, durations.length)
            : null;

    const placed: CountTap[] = [];
    const clampedTaps: number[] = [];
    const respaced: CountRange[] = [];
    let first: Clamp | undefined;
    let lastClamp: Clamp | undefined;
    let useNext = next;
    let out = durations.slice();

    for (let i = 0; i < sorted.length; i++) {
        const tap = sorted[i];
        const bounds: Bound[] = [];
        let from: number | null;
        let start: number;
        if (i === 0) {
            from = tap.index === 1 ? null : previousSynced(synced, tap.index);
            start = from === null ? 0 : times[from];
        } else {
            from = sorted[i - 1].index;
            start = placed[i - 1].time;
        }
        if (from !== null)
            bounds.push(boundBefore(durations, from, tap.index, start));
        const isLast = i === sorted.length - 1;
        let c: Clamp;
        if (isLast && useNext !== null) {
            const withNext = [
                ...bounds,
                boundAfter(durations, tap.index, useNext, times[useNext]),
            ];
            c = clampToBounds(tap.time, withNext, NaN);
            // The synced count can't be kept without breaking the limits: shift instead
            if (Number.isNaN(c.time)) {
                useNext = null;
                const alone = clampToBounds(tap.time, bounds, NaN);
                c = {
                    ...alone,
                    clamped: true,
                    clampReason: alone.clampReason ?? "minCount",
                    clampSide: alone.clampSide ?? "after",
                };
            }
        } else {
            c = clampToBounds(tap.time, bounds, NaN);
        }
        // Only an earlier tap's clamp can make the bounds disjoint; keep the count's own length then
        if (Number.isNaN(c.time))
            c = { ...c, time: start + spanOf(durations, from ?? 0, tap.index) };
        if (c.clamped) clampedTaps.push(tap.index);
        if (i === 0) first = c;
        if (c.clamped) lastClamp = c;
        if (from !== null) {
            out = respace(out, from, tap.index, c.time - start);
            respaced.push({ from, to: tap.index });
        }
        placed.push({ index: tap.index, time: c.time });
    }

    const lastPlaced = placed[placed.length - 1];
    if (useNext !== null && useNext > lastPlaced.index) {
        out = respaceProportional(
            out,
            lastPlaced.index,
            useNext,
            times[useNext] - lastPlaced.time,
        );
        respaced.push({ from: lastPlaced.index, to: useNext });
    }
    const moved = lastPlaced.time - times[lastPlaced.index];
    return {
        durations: out,
        originShift: sorted[0].index === 1 ? first!.time : 0,
        effect: {
            respaced,
            shifted:
                useNext === null && moved !== 0
                    ? { from: lastPlaced.index, bySeconds: moved }
                    : null,
            heldFrom: useNext,
        },
        clamped: clampedTaps.length > 0,
        clampReason: lastClamp?.clampReason,
        clampSide: lastClamp?.clampSide,
        taps: placed,
        clampedTaps,
    };
}

export interface KeepSyncedAfterArgs {
    /** The durations before the edit. */
    before: CountDurations;
    /** The durations after an edit that changed counts before `from` only. */
    edited: CountDurations;
    /** The first count the edit didn't change. */
    from: number;
    synced?: SyncedCounts;
}

/**
 * After an edit that changed only counts before `from` (such as `setRangeBpm` or `scaleRange`),
 * re-spaces `[from, s)` so the next synced count `s` (at or after `from`) starts where it did
 * before. With no such count, or when it can't be kept within the limits, the rest shifts
 * (`clamped` reports the latter). Counts before `from` are never changed.
 */
export function keepSyncedAfter({
    before,
    edited,
    from,
    synced = [],
}: KeepSyncedAfterArgs): RetimeResult {
    if (before.length !== edited.length)
        throw new RangeError("before and edited must have the same length");
    assertRange(before, from, before.length);
    const oldTimes = countTimes(before);
    const newTimes = countTimes(edited);
    const moved = newTimes[from] - oldTimes[from];
    let s: number | null = null;
    for (const x of toSet(synced))
        if (x >= from && x <= before.length && (s === null || x < s)) s = x;
    const shiftResult = (clamped: boolean): RetimeResult => ({
        durations: edited.slice(),
        originShift: 0,
        effect: {
            respaced: [],
            shifted: moved !== 0 ? { from, bySeconds: moved } : null,
            heldFrom: null,
        },
        clamped,
        clampReason: clamped
            ? moved > 0
                ? "minCount"
                : "maxCount"
            : undefined,
        clampSide: clamped ? "after" : undefined,
    });
    if (s === null || moved === 0) return shiftResult(false);
    const newSpan = oldTimes[s] - newTimes[from];
    const [min, max] = spanLimits(edited, from, s);
    if (s === from || newSpan < min || newSpan > max) return shiftResult(true);
    return {
        durations: respaceProportional(edited, from, s, newSpan),
        originShift: 0,
        effect: { respaced: [{ from, to: s }], shifted: null, heldFrom: s },
        clamped: false,
    };
}
