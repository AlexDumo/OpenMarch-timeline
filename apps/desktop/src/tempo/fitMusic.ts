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
import { lockAfter, retime, startsOf, type TempoEditResult } from "./tempoMath";

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
}

/** The first clear hit in the music: the strongest of the opening onsets, not a breath of noise */
export function firstHit(env: OnsetEnvelope): number | null {
    const peaks = onsetPeaks(env);
    if (peaks.length === 0) return null;
    const strong = Math.max(...peaks.slice(0, 40).map((p) => p.s));
    const first = peaks.find((p) => p.s >= 0.45 * strong);
    return first ? first.t : null;
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
    const evenness = measureEvenness(durations, measureStarts);
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
            if (!hasUnevenMeasures(result.durations, measureStarts, a, b)) {
                // The music's own pulse (72–190 BPM, the octave whose counts land on most hits)
                const first =
                    firstCountLength(music, s[a]!, estimateBeatPeriod) ??
                    (s[b]! - s[a]!) / (b - a);
                const tr = trackCounts({
                    env: music,
                    start: s[a]!,
                    firstLength: first,
                    counts: b - a,
                });
                // Stop where it loses the music, rather than guess on past it
                const lost = tr.onHit.findIndex(
                    (hit, j) =>
                        !hit &&
                        tr.onHit[j + 1] === false &&
                        tr.onHit[j + 2] === false,
                );
                if (lost > 0) {
                    stoppedAt = a + lost;
                    tr.times.length = lost + 1;
                }
                // The follow lands each count on a hit already; between two pins the last stretch
                // is evened out to meet the pin
                fitted =
                    lost <= 0 && endPinned
                        ? fitCountsToOnsets({
                              env: music,
                              guess: [...tr.times.slice(0, -1), s[b]!],
                              startFixed: true,
                              endFixed: true,
                          })
                        : tr.times;
            } else {
                // Uneven counts (a grouping like 2+2+3, set at the tempo in effect): keep their
                // shape and move each count onto its nearest hit
                const guess = s.slice(a, b + 1);
                fitted = fitCountsToOnsets({
                    env: music,
                    guess,
                    startFixed: true,
                    endFixed: endPinned,
                });
            }
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
            stoppedAt ?? end,
        ),
    };
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
) {
    const sorted = [...measureStarts].sort((x, y) => x - y);
    return sorted.map((a, i) => {
        const b = sorted[i + 1] ?? a;
        let lo = Infinity;
        let hi = 0;
        for (let k = a; k < b; k++) {
            lo = Math.min(lo, durations[k]!);
            hi = Math.max(hi, durations[k]!);
        }
        return { start: a, uneven: b - a >= 2 && hi / lo >= 1.4 };
    });
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
) {
    const sorted = [...measureStarts].sort((x, y) => x - y);
    for (let i = 0; i + 1 < sorted.length; i++) {
        const a = sorted[i]!;
        const b = sorted[i + 1]!;
        if (b <= from || a >= to || b - a < 2) continue;
        let lo = Infinity;
        let hi = 0;
        for (let k = a; k < b; k++) {
            lo = Math.min(lo, durations[k]!);
            hi = Math.max(hi, durations[k]!);
        }
        if (hi / lo >= 1.4) return true;
    }
    return false;
}
