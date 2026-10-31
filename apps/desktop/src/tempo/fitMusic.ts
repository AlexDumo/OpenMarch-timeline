/**
 * PROTOTYPE (tempo mode): what "Fit to the music" does, as a plan the band then writes.
 *
 * - **Lead-in** (owner, 2026-10-21): fitting from the start of the show puts the first hit in the
 *   music on count 1 by moving the music earlier, so silence before the music never becomes a
 *   measure of its own.
 * - **Nudge** when the counts already sit roughly on the music (the tempos were typed in, or an
 *   earlier fit): every count moves to the nearest hit, keeping the shape of the counts (their
 *   tempos, an uneven grouping like 2+2+3, a rit.).
 * - **Follow** otherwise (counts at a guessed tempo): the counts are followed through the music
 *   one at a time from the music's own pulse, then nudged. Counts that found no hit are reported.
 *
 * Pins are never moved: the range is fitted between them, and the last stretch only when it ends
 * on a pin is its end held.
 */
import {
    estimateBeatPeriod,
    fitCountsToOnsets,
    snapToOnset,
    type OnsetEnvelope,
} from "./onsets";
import { firstCountLength, onsetPeaks, trackCounts } from "./onsetsTrack";
import {
    lockAfter,
    moveBeatTo,
    movePinsWithMusic,
    retime,
    startsOf,
    type TempoEditResult,
} from "./tempoMath";

export interface FitPlan {
    result: TempoEditResult;
    /** Counts placed where the music had no hit (spec beats) */
    unsure: Set<number>;
    /** Seconds to move the music earlier first (the lead-in), or 0 */
    moveMusic: number;
    /** How each stretch was fitted */
    modes: ("nudge" | "follow")[];
    /**
     * Where following the music stopped because it lost the music (three counts in a row with no
     * hit: a hold, a meter change, a cut), or null. The counts from there on are left as they were.
     */
    stoppedAt: number | null;
    /**
     * Why nothing was fitted: the first count isn't on the music (and isn't pinned), so following
     * from it would line counts up with the wrong beats. Null when it fitted.
     */
    refused: "start-off-music" | null;
    /**
     * Where the strongest hits fall in the measures that were fitted, when it isn't count 1: the
     * counts may sit on the music a beat or two off the bars. Null when the downbeats look right.
     */
    downbeat: { count: number; measures: number } | null;
    /** The last count start that was fitted to the music (past `to` when the fit went on to the music's end) */
    fittedTo: number;
}

/** The first clear hit in the music: the strongest of the opening onsets, not a breath of noise */
export function firstHit(env: OnsetEnvelope): number | null {
    const peaks = onsetPeaks(env);
    if (peaks.length === 0) return null;
    const strong = Math.max(...peaks.slice(0, 40).map((p) => p.s));
    const first = peaks.find((p) => p.s >= 0.45 * strong);
    return first ? first.t : null;
}

/**
 * Where following lost the music: the first of three counts in a row that found no real hit. A
 * real hit is one at least 30% as strong as the counts' recent hits, so the faint ticks under a
 * held note don't count as the music going on. -1 when it never lost it.
 */
export function lostAt(env: OnsetEnvelope, times: readonly number[]): number {
    const peaks = onsetPeaks(env);
    const strengths: number[] = [];
    const strong: boolean[] = [];
    const recent: number[] = [];
    for (let k = 1; k < times.length; k++) {
        const t = times[k]!;
        const tol = Math.max(0.03, 0.12 * (t - times[k - 1]!));
        let best = 0;
        for (let i = firstPeakFrom(peaks, t - tol); i < peaks.length; i++) {
            if (peaks[i]!.t > t + tol) break;
            best = Math.max(best, peaks[i]!.s);
        }
        strengths.push(best);
        const ref = recent.length
            ? [...recent].sort((x, y) => x - y)[recent.length >> 1]!
            : best;
        const isStrong = best > 0 && best >= 0.3 * ref;
        strong.push(isStrong);
        if (isStrong) {
            recent.push(best);
            if (recent.length > 8) recent.shift();
        }
    }
    return strong.findIndex((hit, j) => !hit && strong[j + 1] === false);
}

const firstPeakFrom = (peaks: readonly { t: number }[], t: number) => {
    let lo = 0;
    let hi = peaks.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (peaks[mid]!.t < t) lo = mid + 1;
        else hi = mid;
    }
    return lo;
};

/**
 * How long each count of `a`..`b` is against the others in its measure, from the eighths in it:
 * the shortest count of a measure is 1 (2+2+3 is 1, 1, 1.5; 3+2 is 1.5, 1; 12/8 is all 1). Only
 * the shape inside a measure is known: across a meter change the tempo is free to change (♩. = ♩).
 */
export function countWeights(
    units: readonly number[],
    measureStarts: readonly number[],
    a: number,
    b: number,
): { weights: number[]; shifts: number[] } {
    const starts = [...measureStarts].sort((x, y) => x - y);
    const shortestIn = (from: number, to: number) => {
        let shortest = Infinity;
        for (let j = from; j < to; j++)
            if ((units[j] ?? 0) > 0) shortest = Math.min(shortest, units[j]!);
        return Number.isFinite(shortest) ? shortest : null;
    };
    const weights: number[] = [];
    const shifts: number[] = [];
    let m = 0;
    for (let k = a; k < b; k++) {
        while (m + 1 < starts.length && starts[m + 1]! <= k) m++;
        const inside = starts[m] !== undefined && starts[m]! <= k;
        const from = inside ? starts[m]! : k;
        const to =
            starts[m + 1] !== undefined && starts[m + 1]! > k
                ? starts[m + 1]!
                : k + 1;
        const shortest = shortestIn(from, to);
        const u = units[k] ?? 0;
        weights.push(u > 0 && shortest ? u / shortest : 1);
        // the first count of a measure counted in other notes than the one before: the eighth
        // may carry on instead of the count
        const before =
            inside && k === from && m > 0
                ? shortestIn(starts[m - 1]!, from)
                : null;
        shifts.push(
            shortest && before && shortest !== before ? shortest / before : 1,
        );
    }
    return { weights, shifts };
}

/** The last clear hit in the music (a quiet tail of reverb isn't one) */
export function lastHit(env: OnsetEnvelope): number | null {
    const peaks = onsetPeaks(env);
    if (peaks.length === 0) return null;
    const strong = Math.max(...peaks.map((p) => p.s));
    for (let i = peaks.length - 1; i >= 0; i--)
        if (peaks[i]!.s >= 0.15 * strong) return peaks[i]!.t;
    return null;
}

/** The share of counts in `starts[from..to]` that sit on a hit (within 10% of a count, or 30 ms) */
export function alignedShare(
    env: OnsetEnvelope,
    starts: readonly number[],
    from: number,
    to: number,
): number {
    let on = 0;
    let n = 0;
    for (let b = from; b < to; b++) {
        const len = starts[b + 1]! - starts[b]!;
        const t = starts[b]!;
        const tol = Math.max(0.03, 0.1 * len);
        if (
            Math.abs(snapToOnset(env, t, tol) - t) < tol &&
            snapToOnset(env, t, tol) !== t
        )
            on++;
        n++;
    }
    return n === 0 ? 0 : on / n;
}

/** The envelope as heard after the music moves `seconds` earlier */
const shifted = (env: OnsetEnvelope, seconds: number): OnsetEnvelope =>
    seconds === 0 ? env : { ...env, startSeconds: env.startSeconds - seconds };

/**
 * Plan a fit of spec beats `from`..`to` (count starts `from` to `to`).
 *
 * @param durations count lengths by spec beat (beat 0 is 0)
 * @param locks pinned spec beats
 */
export function planFit({
    env,
    durations,
    locks,
    from,
    to,
    measureStarts = [],
    holds,
    toEnd,
    units,
}: {
    env: OnsetEnvelope;
    durations: readonly number[];
    locks: ReadonlySet<number>;
    from: number;
    to: number;
    /** First spec beat of each measure: an uneven grouping (2+2+3) is kept as it is */
    measureStarts?: readonly number[];
    /** Holds (fermatas) keep their length */
    holds?: ReadonlySet<number>;
    /**
     * Fitting to the end of the music: `to` is only a first guess (made on the counts as they
     * were, which may run slower than the music), so the fit goes on through the music's last
     * hit, and the stored counts after it, up to `carryTo`, keep the last tempo (no pin in the
     * way; the endless counts after the stored ones carry on from the last one anyway).
     */
    toEnd?: { carryTo: number };
    /**
     * Eighths in each count by spec beat (2 for a quarter; 2, 2, 3 in a 7/8 bar counted 2+2+3).
     * With it, uneven measures are followed through the music as they're counted.
     */
    units?: readonly number[];
}): FitPlan {
    let moveMusic = 0;
    // From a count that isn't on the music, a fit would follow the wrong beats: say so instead
    if (from > 1 && !locks.has(from)) {
        const s0 = startsOf(durations);
        const len = s0[from + 1]! - s0[from]!;
        if (
            !hasPeakNear(onsetPeaks(env), s0[from]!, Math.max(0.03, 0.12 * len))
        )
            return {
                result: { durations: [...durations], locks: new Set(locks) },
                unsure: new Set(),
                moveMusic: 0,
                modes: [],
                stoppedAt: null,
                refused: "start-off-music",
                downbeat: null,
                fittedTo: from,
            };
    }
    // From the very start, the first hit goes on count 1
    if (from <= 1) {
        const hit = firstHit(env);
        if (hit !== null && Math.abs(hit) > 0.05) moveMusic = hit;
    }
    const music = shifted(env, moveMusic);
    const end = Math.min(to, durations.length - 1);
    // Fitted in stretches: between pins, and wherever the counting changes between even
    // measures and uneven ones (a grouping like 2+2+3), as each is fitted its own way
    const evenness = measureEvenness(durations, measureStarts, holds);
    const switches = evenness
        .filter((m, i) => i > 0 && m.uneven !== evenness[i - 1]!.uneven)
        .map((m) => m.start);
    const cuts = [
        ...new Set([
            from,
            ...[...locks, ...switches].filter((l) => l > from && l < end),
            end,
        ]),
    ].sort((a, b) => a - b);
    let result: TempoEditResult = {
        durations: [...durations],
        locks: new Set(locks),
    };
    // The music moving earlier takes the pinned counts with it (they're tied to the music)
    if (moveMusic !== 0) {
        const moved = movePinsWithMusic(result.durations, locks, moveMusic);
        if (moved) result = { ...result, durations: moved };
    }
    // From a count near its hit (but not on it), it first goes onto the hit, the counts back to
    // the pin before (or the start) taking the difference evenly, so a drift that built up over
    // them isn't put into one count
    if (from > 1 && !locks.has(from)) {
        const s0 = startsOf(result.durations);
        const tol = Math.max(0.03, 0.12 * (s0[from + 1]! - s0[from]!));
        const hit = snapToOnset(music, s0[from]!, tol);
        const moved =
            hit !== s0[from]
                ? moveBeatTo(result.durations, result.locks, from, hit)
                : null;
        if (moved) result = { ...result, durations: moved.durations };
    }
    const unsure = new Set<number>();
    const modes: FitPlan["modes"] = [];
    let stoppedAt: number | null = null;
    for (let i = 0; i + 1 < cuts.length; i++) {
        const a = cuts[i]!;
        const b = cuts[i + 1]!;
        if (b - a < 1) continue;
        const s = startsOf(result.durations);
        const endPinned = lockAfter(result.locks, a) === b;
        // Between two pins the time is known: every count is nudged onto its hit between them
        const aligned = endPinned || alignedShare(music, s, a, b) >= 0.6;
        let fitted: number[];
        if (aligned) {
            modes.push("nudge");
            fitted = fitCountsToOnsets({
                env: music,
                guess: s.slice(a, b + 1),
                startFixed: true,
                endFixed: endPinned,
            });
        } else {
            modes.push("follow");
            const followed = followStretch({
                music,
                starts: s,
                a,
                b,
                endPinned,
                durations: result.durations,
                measureStarts,
                holds,
                units,
            });
            fitted = followed.fitted;
            if (followed.lost > 0) stoppedAt = a + followed.lost;
        }
        const peaks = onsetPeaks(music);
        for (let k = 1; k < fitted.length - 1; k++) {
            const t = fitted[k]!;
            const tol = Math.max(0.03, 0.12 * (fitted[k + 1]! - t));
            if (!hasPeakNear(peaks, t, tol)) unsure.add(a + k);
        }
        const until = a + fitted.length - 1;
        result = retime(
            result.durations,
            result.locks,
            a,
            until,
            fitted.slice(1).map((t, k) => t - fitted[k]!),
            { fixed: holds },
        );
        if (stoppedAt !== null) break;
    }
    let fittedTo = stoppedAt ?? end;
    if (toEnd && stoppedAt === null && !result.locks.has(end)) {
        const extended = toTheEnd(music, result, end, toEnd.carryTo, holds);
        result = extended.result;
        fittedTo = extended.fittedTo;
        for (const b of extended.unsure) unsure.add(b);
    }
    return {
        result,
        unsure,
        moveMusic,
        modes,
        stoppedAt,
        refused: null,
        downbeat: downbeatCheck(
            music,
            result.durations,
            measureStarts,
            from,
            fittedTo,
        ),
        fittedTo,
    };
}

/**
 * Follow the counts `a`..`b` through the music (counts at a guessed tempo): from the music's own
 * pulse, each count onto the next hit, as long as its grouping says. Stops where it loses the
 * music (`lost`, counts from `a`; -1 when it didn't). Between two pins the end meets the pin.
 */
function followStretch({
    music,
    starts: s,
    a,
    b,
    endPinned,
    durations,
    measureStarts,
    holds,
    units,
}: {
    music: OnsetEnvelope;
    starts: readonly number[];
    a: number;
    b: number;
    endPinned: boolean;
    durations: readonly number[];
    measureStarts: readonly number[];
    holds?: ReadonlySet<number>;
    units?: readonly number[];
}): { fitted: number[]; lost: number } {
    if (!units && hasUnevenMeasures(durations, measureStarts, a, b, holds))
        // Uneven counts (a grouping like 2+2+3, set at the tempo in effect) without their
        // groupings: keep their shape and move each count onto its nearest hit
        return {
            fitted: fitCountsToOnsets({
                env: music,
                guess: s.slice(a, b + 1),
                startFixed: true,
                endFixed: endPinned,
            }),
            lost: -1,
        };
    // Each count as long as its grouping says (2+2+3: the last is 1.5 of the others), so meters
    // set before fitting are followed as they're counted
    const shape = units ? countWeights(units, measureStarts, a, b) : undefined;
    // The music's own pulse (50–200 BPM, the octave whose counts land on most hits)
    const first =
        firstCountLength(music, s[a]!, estimateBeatPeriod, shape?.weights) ??
        (s[b]! - s[a]!) / (b - a);
    const tr = trackCounts({
        env: music,
        start: s[a]!,
        firstLength: first,
        counts: b - a,
        weights: shape?.weights,
        shifts: shape?.shifts,
    });
    // Stop where it loses the music, rather than guess on past it
    const lost = lostAt(music, tr.times);
    if (lost > 0) tr.times.length = lost + 1;
    // The follow lands each count on a hit already; between two pins the last stretch is evened
    // out to meet the pin
    const fitted =
        lost <= 0 && endPinned
            ? fitCountsToOnsets({
                  env: music,
                  guess: [...tr.times.slice(0, -1), s[b]!],
                  startFixed: true,
                  endFixed: true,
              })
            : tr.times;
    return { fitted, lost };
}

/**
 * After a fit that reached `end`, carry on to the music's last hit (following it as before), then
 * give the counts after the music, up to `carryTo` or the next pin, the last tempo, so the tempo
 * doesn't jump back to the old guess where the music stops.
 */
function toTheEnd(
    music: OnsetEnvelope,
    start: TempoEditResult,
    end: number,
    carryTo: number,
    holds?: ReadonlySet<number>,
): { result: TempoEditResult; fittedTo: number; unsure: Set<number> } {
    let result = start;
    const unsure = new Set<number>();
    const pin = lockAfter(result.locks, end);
    // following the music can go on into the endless counts; only up to a pin
    const limit = Math.min(pin ?? Infinity, result.durations.length - 1);
    if (limit <= end) return { result, fittedTo: end, unsure };
    const s = startsOf(result.durations);
    // the tempo the fit ended on: the middle of the last few counts that aren't holds
    const recent: number[] = [];
    for (let b = end - 1; b >= 1 && recent.length < 4; b--)
        if (!holds?.has(b)) recent.push(s[b + 1]! - s[b]!);
    if (recent.length === 0) return { result, fittedTo: end, unsure };
    const len = [...recent].sort((x, y) => x - y)[recent.length >> 1]!;
    let fittedTo = end;
    const last = lastHit(music);
    if (last !== null && s[end]! < last - 0.5 * len) {
        const counts = Math.min(
            limit - end,
            Math.ceil((last - s[end]!) / len) + 1,
        );
        const tr = trackCounts({
            env: music,
            start: s[end]!,
            firstLength: len,
            counts,
        });
        const lost = lostAt(music, tr.times);
        if (lost >= 0) tr.times.length = lost + 1;
        // only counts that start by the last hit are the music's
        while (
            tr.times.length > 1 &&
            tr.times[tr.times.length - 1]! > last + 0.5 * len
        )
            tr.times.length--;
        if (tr.times.length > 1) {
            const peaks = onsetPeaks(music);
            for (let k = 1; k < tr.times.length - 1; k++) {
                const t = tr.times[k]!;
                const tol = Math.max(0.03, 0.12 * (tr.times[k + 1]! - t));
                if (!hasPeakNear(peaks, t, tol)) unsure.add(end + k);
            }
            fittedTo = end + tr.times.length - 1;
            result = retime(
                result.durations,
                result.locks,
                end,
                fittedTo,
                tr.times.slice(1).map((t, k) => t - tr.times[k]!),
                { fixed: holds },
            );
        }
    }
    // after the music, up to the end of the counts: the last tempo carries on (not up to a pin,
    // whose place is set)
    const carry = Math.min(carryTo, result.durations.length - 1);
    if (pin === null && fittedTo < carry) {
        const lengths = Array<number>(carry - fittedTo).fill(len);
        result = retime(
            result.durations,
            result.locks,
            fittedTo,
            carry,
            lengths,
            {
                fixed: holds,
            },
        );
    }
    return { result, fittedTo, unsure };
}

/** Whether an onset peak lies within `tol` of `t` (peaks ascending) */
function hasPeakNear(peaks: readonly { t: number }[], t: number, tol: number) {
    let lo = 0;
    let hi = peaks.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (peaks[mid]!.t < t - tol) lo = mid + 1;
        else hi = mid;
    }
    return lo < peaks.length && peaks[lo]!.t <= t + tol;
}

/**
 * Which count of the measure the music's strongest hits fall on, over the measures fitted. Among
 * the measures of the most common length (4 counts, say), each count's hit strength is summed;
 * when another count is clearly stronger than count 1 (by a quarter), it is reported.
 */
export function downbeatCheck(
    env: OnsetEnvelope,
    durations: readonly number[],
    measureStarts: readonly number[],
    from: number,
    to: number,
): { count: number; measures: number } | null {
    const starts = startsOf(durations);
    const peaks = onsetPeaks(env);
    const sorted = [...measureStarts].sort((x, y) => x - y);
    const byLength = new Map<number, { sums: number[]; measures: number }>();
    for (let i = 0; i + 1 < sorted.length; i++) {
        const a = sorted[i]!;
        const b = sorted[i + 1]!;
        if (a < from || b > to || b - a < 2) continue;
        const entry = byLength.get(b - a) ?? {
            sums: Array<number>(b - a).fill(0),
            measures: 0,
        };
        for (let k = a; k < b; k++) {
            const t = starts[k]!;
            const tol = Math.max(0.03, 0.12 * (starts[k + 1]! - t));
            let best = 0;
            for (const p of peaks) {
                if (p.t > t + tol) break;
                if (p.t >= t - tol) best = Math.max(best, p.s);
            }
            entry.sums[k - a]! += best;
        }
        entry.measures++;
        byLength.set(b - a, entry);
    }
    let common: { sums: number[]; measures: number } | null = null;
    for (const e of byLength.values())
        if (!common || e.measures > common.measures) common = e;
    if (!common || common.measures < 2) return null;
    const strongest = common.sums.indexOf(Math.max(...common.sums));
    return strongest !== 0 && common.sums[strongest]! > 1.25 * common.sums[0]!
        ? { count: strongest + 1, measures: common.measures }
        : null;
}

/** Each measure's first spec beat, and whether its counts are uneven (a grouping) */
function measureEvenness(
    durations: readonly number[],
    measureStarts: readonly number[],
    holds?: ReadonlySet<number>,
) {
    const sorted = [...measureStarts].sort((x, y) => x - y);
    return sorted.map((a, i) => {
        const b = sorted[i + 1] ?? a;
        return { start: a, uneven: unevenCounts(durations, a, b, holds) };
    });
}

/**
 * Whether the counts `a`..`b` (one measure) have different lengths on purpose: the long count at
 * least 1.4 times the others. A hold (fermata) is long because it's held, not grouped, so it's left
 * out.
 */
function unevenCounts(
    durations: readonly number[],
    a: number,
    b: number,
    holds?: ReadonlySet<number>,
) {
    let lo = Infinity;
    let hi = 0;
    let n = 0;
    for (let k = a; k < b; k++) {
        if (holds?.has(k)) continue;
        lo = Math.min(lo, durations[k]!);
        hi = Math.max(hi, durations[k]!);
        n++;
    }
    return n >= 2 && hi / lo >= 1.4;
}

/**
 * Whether some measures in `from`..`to` have counts of different lengths on purpose (a grouping
 * like 2+2+3: the long count is at least 1.4 times the others)
 */
function hasUnevenMeasures(
    durations: readonly number[],
    measureStarts: readonly number[],
    from: number,
    to: number,
    holds?: ReadonlySet<number>,
) {
    const sorted = [...measureStarts].sort((x, y) => x - y);
    for (let i = 0; i + 1 < sorted.length; i++) {
        const a = sorted[i]!;
        const b = sorted[i + 1]!;
        if (b <= from || a >= to || b - a < 2) continue;
        if (unevenCounts(durations, a, b, holds)) return true;
    }
    return false;
}
