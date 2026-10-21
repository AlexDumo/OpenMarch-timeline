/**
 * PROTOTYPE (tempo mode). Follow the counts through the music one at a time, the way a person
 * tapping along would: from where the last count fell and how long it was, the next count is the
 * hit about one count on. Tempo changes cost a little; a count with no hit near where it should be
 * goes where the tempo says. A beam keeps the best few paths, so one misleading hit doesn't derail
 * it. Unlike `fitCountsToOnsets` it doesn't need a good guess, only the first count's length.
 */
import type { OnsetEnvelope } from "./onsets";

interface Peak {
    t: number;
    s: number;
}

const peakCache = new WeakMap<OnsetEnvelope, Peak[]>();

/** The envelope's local maxima (above a floor), with parabolic sub-frame times */
export function onsetPeaks(env: OnsetEnvelope, floor = 0.12): Peak[] {
    const cached = peakCache.get(env);
    if (cached) return cached;
    const v = env.values;
    const peaks: Peak[] = [];
    for (let i = 1; i < v.length - 1; i++) {
        const y = v[i]!;
        if (y < floor || y < v[i - 1]! || y <= v[i + 1]!) continue;
        // a peak must stand out from its ±60 ms neighborhood
        const r = Math.round(0.06 * env.rate);
        let isMax = true;
        for (
            let j = Math.max(0, i - r);
            j <= Math.min(v.length - 1, i + r);
            j++
        )
            if (v[j]! > y) {
                isMax = false;
                break;
            }
        if (!isMax) continue;
        const a = v[i - 1]!;
        const c = v[i + 1]!;
        const d = a - 2 * y + c;
        const off = d === 0 ? 0 : (0.5 * (a - c)) / d;
        peaks.push({
            t: env.startSeconds + (i + off) / env.rate,
            s: Math.min(2, y),
        });
    }
    peakCache.set(env, peaks);
    return peaks;
}

const firstAtOrAfter = (peaks: Peak[], t: number) => {
    let lo = 0;
    let hi = peaks.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (peaks[mid]!.t < t) lo = mid + 1;
        else hi = mid;
    }
    return lo;
};

/** The strongest peak within 30 ms of `t`, or 0 */
const strengthNear = (peaks: Peak[], t: number) => {
    let s = 0;
    for (let i = firstAtOrAfter(peaks, t - 0.03); i < peaks.length; i++) {
        if (peaks[i]!.t > t + 0.03) break;
        s = Math.max(s, peaks[i]!.s);
    }
    return s;
};

/** A peak under this share of the hits being followed is a faint tick, not a hit */
const WEAK = 0.3;

/** How many counts back the follow's decisions settle */
const SETTLE_COUNTS = 16;

interface Path {
    t: number;
    /** Seconds per unit of count weight (a count of weight 1.5 is 1.5 of these) */
    len: number;
    /** How strong the hits it has followed are (a running average); 0 before the first */
    ref: number;
    score: number;
    times: number[];
    hits: boolean[];
}

export interface TrackResult {
    /** Count boundaries: `times[0]` is the start, `times[k]` where count k ends */
    times: number[];
    /** Whether each count's start (from the second on) landed on a hit in the music */
    onHit: boolean[];
}

/** Every way path `p` can take its next count (each hit about a count on, or a miss), into `next` */
function stepPath(
    p: Path,
    peaks: Peak[],
    localPulse: ((t: number) => number | null) | undefined,
    changeWeight: number,
    missCost: number,
    next: Path[],
    weight = 1,
    shift = 1,
) {
    // this count as long as its weight says (a 3-eighth count of 2+2+3 is 1.5 of the others);
    // where the meter changes, the eighth may stay the same instead of the count (`shift`)
    const expected = p.len * weight;
    const shifted = expected * shift;
    // the pulse here, at the octave nearest the counts'
    const raw = localPulse?.(p.t) ?? null;
    const pulse =
        raw === null
            ? null
            : [raw, raw / 2, raw * 2].reduce((a, b) =>
                  Math.abs(Math.log(b / expected)) <
                  Math.abs(Math.log(a / expected))
                      ? b
                      : a,
              );
    const lo = p.t + 0.66 * Math.min(expected, shifted, pulse ?? expected);
    const hi = p.t + 1.38 * Math.max(expected, shifted, pulse ?? expected);
    const extend = (t: number, gain: number, hit: boolean) => {
        const len = t - p.t;
        const rSame = Math.log(len / expected);
        const rShift = Math.log(len / shifted);
        const viaShift = shift !== 1 && rShift * rShift < rSame * rSame;
        const rPrev = viaShift ? rShift : rSame;
        const base = viaShift ? p.len * shift : p.len;
        const rPulse = pulse === null ? Infinity : Math.log(len / pulse);
        // changing tempo costs less when it goes to the music's own pulse
        const r2 = Math.min(rPrev * rPrev, rPulse * rPulse + 0.02);
        next.push({
            t,
            // follow the tempo, smoothed so one late hit doesn't swing it
            len: hit ? 0.8 * (len / weight) + 0.2 * base : base,
            ref: hit ? (p.ref ? 0.8 * p.ref + 0.2 * gain : gain) : p.ref,
            score: p.score + gain - changeWeight * r2,
            times: [...p.times, t],
            hits: [...p.hits, hit],
        });
    };
    for (
        let i = firstAtOrAfter(peaks, lo);
        i < peaks.length && peaks[i]!.t <= hi;
        i++
    )
        // faint ticks (under a held note, in a caesura) aren't the music going on
        if (peaks[i]!.s >= WEAK * p.ref) extend(peaks[i]!.t, peaks[i]!.s, true);
    extend(p.t + expected, -missCost, false);
    if (shift !== 1) extend(p.t + shifted, -missCost, false);
}

/**
 * Follow `counts` counts from `start`, the first one about `firstLength` long.
 */
export function trackCounts({
    env,
    start,
    firstLength,
    counts,
    beam = 48,
    changeWeight = 10,
    missCost = 0.35,
    localPulse,
    weights,
    shifts,
}: {
    env: OnsetEnvelope;
    start: number;
    firstLength: number;
    counts: number;
    /**
     * How long each count is against the others (from its grouping: 1 for a quarter, 1.5 for a
     * dotted quarter), so uneven measures are followed as they are counted. All 1 when left out.
     */
    weights?: readonly number[];
    /**
     * Where the meter changes, how much longer a count is if the eighth note stays the same
     * (6/8 into 3/4: 2/3), as well as the count staying the same (♩. = ♩). 1 elsewhere.
     */
    shifts?: readonly number[];
    beam?: number;
    changeWeight?: number;
    missCost?: number;
    /** The music's own pulse around a time (seconds per beat), so a sudden tempo change is cheap when the music agrees */
    localPulse?: (t: number) => number | null;
}): TrackResult {
    const peaks = onsetPeaks(env);
    // the hit it starts on sets how strong a hit is
    let paths: Path[] = [
        {
            t: start,
            len: firstLength / (weights?.[0] ?? 1),
            ref: strengthNear(peaks, start),
            score: 0,
            times: [start],
            hits: [],
        },
    ];
    for (let k = 0; k < counts; k++) {
        const next: Path[] = [];
        for (const p of paths)
            stepPath(
                p,
                peaks,
                localPulse,
                changeWeight,
                missCost,
                next,
                weights?.[k] ?? 1,
                shifts?.[k] ?? 1,
            );
        next.sort((a, b) => b.score - a.score);
        // keep the best path per landing spot (within 15 ms)
        const kept: Path[] = [];
        for (const p of next) {
            if (kept.some((q) => Math.abs(q.t - p.t) < 0.015)) continue;
            kept.push(p);
            if (kept.length >= beam) break;
        }
        // Decisions settle after a while (fixed lag): paths that disagree with the best one about
        // a count well behind are dropped, so music much later can't rewrite what fitted here
        const lag = k - SETTLE_COUNTS;
        if (lag > 0) {
            const settled = kept[0]!.times[lag]!;
            paths = kept.filter(
                (p) => Math.abs(p.times[lag]! - settled) < 0.015,
            );
        } else paths = kept;
    }
    const best = paths[0]!;
    return { times: best.times, onHit: best.hits };
}

/**
 * How long the first count is, from the music near `start`: the steady pulse there, at the
 * octave (half or double) whose counts land on the most strong hits, between 50 and 200 BPM
 * (marching tempos, and a ballad at ♩60 after a fermata). Null when the music has no clear pulse
 * there.
 */
const MIN_LEN = 60 / 200;
const MAX_LEN = 60 / 50;
export function firstCountLength(
    env: OnsetEnvelope,
    start: number,
    estimate: (
        env: OnsetEnvelope,
        from: number,
        to: number,
        min: number,
        max: number,
    ) => number | null,
    weights?: readonly number[],
): number | null {
    const p = estimate(env, start, start + 8, MIN_LEN, MAX_LEN);
    if (!p) return null;
    const peaks = onsetPeaks(env).filter(
        (q) => q.t >= start && q.t < start + 8 && q.s > 0.5,
    );
    if (peaks.length === 0) return p;
    const coverage = (len: number) => {
        const r = trackCounts({
            env,
            start,
            firstLength: len,
            counts: Math.floor(8 / len),
            weights,
        });
        let matched = 0;
        for (const q of peaks)
            if (r.times.some((t) => Math.abs(t - q.t) < 0.03)) matched++;
        const misses =
            r.onHit.filter((h) => !h).length / Math.max(1, r.onHit.length);
        // counts that land on nothing count against it; a little against tempos far from 120
        return (
            matched / peaks.length -
            0.5 * misses -
            0.02 * Math.abs(Math.log2(len / 0.5))
        );
    };
    // the pulse found may be a count of another weight than the first (a dotted quarter in 2+2+3)
    const w0 = weights?.[0] ?? 1;
    const ratios = weights?.some((w) => w !== w0)
        ? [1, 0.5, 2, 1.5, 2 / 3, 0.75, 4 / 3]
        : [1, 0.5, 2];
    const candidates = ratios
        .map((r) => p * r)
        .filter((c) => c >= MIN_LEN - 1e-9 && c <= MAX_LEN + 1e-9);
    return candidates.reduce((a, b) => (coverage(b) > coverage(a) ? b : a));
}
