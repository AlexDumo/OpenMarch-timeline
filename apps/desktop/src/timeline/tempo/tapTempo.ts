/**
 * Tempo and phase from a run of taps ("tap the beat", E6). Pure; times in seconds.
 */

export interface TapTempo {
    /** Beats per minute of the fitted beat. */
    readonly bpm: number;
    /** Seconds per beat (`60 / bpm`). */
    readonly period: number;
    /**
     * When the beat of the first tap falls on the fitted grid. Better than the first tap's own time,
     * which is usually the least accurate.
     */
    readonly firstBeatTime: number;
    /**
     * 0 to 1: how well the taps fit a steady beat, and how many there were. About 1 for eight or
     * more steady taps (seven fitted); low for few taps or uneven ones. A heuristic for "tap a few more".
     */
    readonly confidence: number;
    /** The beat number each tap was assigned (the first tap is beat 0); null for a rejected tap. */
    readonly beats: readonly (number | null)[];
    /** Indexes of taps left out of the fit (double taps and outliers). */
    readonly rejected: readonly number[];
}

/** A tap further than this fraction of a beat from the fitted grid is an outlier. */
export const TAP_OUTLIER_FRACTION = 0.25;

const median = (values: readonly number[]): number => {
    const s = [...values].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Least-squares line `t = a + p * k` through the points. */
function fitLine(points: readonly { k: number; t: number }[]): {
    a: number;
    p: number;
} {
    const n = points.length;
    let sk = 0;
    let st = 0;
    for (const { k, t } of points) {
        sk += k;
        st += t;
    }
    const mk = sk / n;
    const mt = st / n;
    let num = 0;
    let den = 0;
    for (const { k, t } of points) {
        num += (k - mk) * (t - mt);
        den += (k - mk) * (k - mk);
    }
    const p = den > 0 ? num / den : NaN;
    return { a: mt - p * mk, p };
}

/**
 * Fits a steady beat to tap times. Robust to the usual mistakes:
 * - the first tap's jitter (it's left out of the period estimate and the fit when there are at
 *   least four taps; its beat still anchors `firstBeatTime`);
 * - a missed tap (an interval near two beats counts as two);
 * - a double tap (an interval well under half a beat is dropped);
 * - a stray tap more than a quarter beat off the grid (rejected, then the fit is redone).
 *
 * Returns null for fewer than two usable taps. Times must be ascending.
 */
export function tempoFromTaps(times: readonly number[]): TapTempo | null {
    if (times.length < 2) return null;
    const intervals: number[] = [];
    for (let i = 1; i < times.length; i++)
        intervals.push(times[i] - times[i - 1]);
    const forEstimate = times.length >= 4 ? intervals.slice(1) : intervals;
    const positive = forEstimate.filter((d) => d > 0);
    if (positive.length === 0) return null;
    const period0 = median(positive);

    // Assign beat numbers by walking the intervals; a double tap gets no beat
    const beats: (number | null)[] = [0];
    let k = 0;
    let lastTime = times[0];
    for (let i = 1; i < times.length; i++) {
        const steps = Math.round((times[i] - lastTime) / period0);
        if (steps < 1) {
            beats.push(null);
            continue;
        }
        k += steps;
        beats.push(k);
        lastTime = times[i];
    }

    const skipFirst = times.length >= 4;
    const candidates = beats
        .map((b, i) => ({ i, k: b, t: times[i] }))
        .filter(
            (x): x is { i: number; k: number; t: number } =>
                x.k !== null && !(skipFirst && x.i === 0),
        );
    if (candidates.length < 2) return null;

    let fit = fitLine(candidates);
    let used = candidates;
    if (used.length >= 3 && fit.p > 0) {
        const kept = used.filter(
            (x) =>
                Math.abs(x.t - (fit.a + fit.p * x.k)) <=
                TAP_OUTLIER_FRACTION * fit.p,
        );
        if (kept.length >= 2 && kept.length < used.length) {
            used = kept;
            fit = fitLine(used);
        }
    }
    if (!(fit.p > 0)) return null;

    const usedIdx = new Set(used.map((x) => x.i));
    const rejected: number[] = [];
    const outBeats = beats.map((b, i) => {
        if ((skipFirst && i === 0) || usedIdx.has(i)) return b;
        rejected.push(i);
        return null;
    });
    let ss = 0;
    for (const x of used) ss += (x.t - (fit.a + fit.p * x.k)) ** 2;
    const rms = Math.sqrt(ss / used.length);
    const steadiness = Math.max(0, 1 - rms / (0.1 * fit.p));
    const amount = Math.min(1, (used.length - 1) / 6);

    return {
        bpm: 60 / fit.p,
        period: fit.p,
        firstBeatTime: fit.a,
        confidence: steadiness * amount,
        beats: outBeats,
        rejected,
    };
}
