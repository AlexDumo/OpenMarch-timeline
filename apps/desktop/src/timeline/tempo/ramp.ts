/**
 * Count lengths for a steady tempo or a linear tempo ramp (rit. / accel.) over a range. Pure.
 */
import type { CountDurations } from "./retime";

/**
 * The length in seconds of counts whose tempo changes linearly, count by count: the first count
 * is played at `startBpm` and the last at `endBpm` (a steady tempo when they are equal). This is
 * how a score's "rit. to ♩=100" reads, and how the tempo kit renders ramps.
 *
 * @param weights each count's length in beats of the tempo's unit: 1 for a ♩ count at ♩=120, 1.5
 *   for the long count of 7/8 2+2+3 at ♩=176, 1 for a ♩. count of 6/8 at ♩.=88
 * @param startBpm beats of the unit per minute on the first count
 * @param endBpm beats of the unit per minute on the last count; defaults to `startBpm`
 */
export function rampDurations(
    weights: readonly number[],
    startBpm: number,
    endBpm: number = startBpm,
): number[] {
    for (const bpm of [startBpm, endBpm])
        if (!(bpm > 0) || !Number.isFinite(bpm))
            throw new RangeError(`tempo must be positive, got ${bpm}`);
    const last = weights.length - 1;
    return weights.map((w, i) => {
        if (!(w > 0) || !Number.isFinite(w))
            throw new RangeError(`count weight must be positive, got ${w}`);
        const bpm =
            last > 0 ? startBpm + ((endBpm - startBpm) * i) / last : startBpm;
        return (w * 60) / bpm;
    });
}

/**
 * Typed tempo with an optional ramp: `[from, to)` gets `rampDurations(weights, startBpm, endBpm)`,
 * and later counts shift. `weights` defaults to one beat per count.
 */
export function setRangeRamp(
    durations: CountDurations,
    from: number,
    to: number,
    startBpm: number,
    endBpm: number = startBpm,
    weights: readonly number[] = Array<number>(Math.max(0, to - from)).fill(1),
): number[] {
    if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        to > durations.length ||
        from > to
    )
        throw new RangeError(
            `bad range [${from}, ${to}) for ${durations.length} counts`,
        );
    if (weights.length !== to - from)
        throw new RangeError(
            `${weights.length} weights for a range of ${to - from} counts`,
        );
    const out = durations.slice();
    rampDurations(weights, startBpm, endBpm).forEach(
        (d, i) => (out[from + i] = d),
    );
    return out;
}

/**
 * Each count's tempo in beats of its unit per minute (`weights` as in `rampDurations`), the
 * inverse of `rampDurations`. Zero-length counts give `Infinity`.
 */
export function countBpms(
    durations: readonly number[],
    weights: readonly number[],
): number[] {
    return durations.map((d, i) => (weights[i] * 60) / d);
}
