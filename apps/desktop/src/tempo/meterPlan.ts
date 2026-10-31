/**
 * PROTOTYPE (tempo mode): the plan for setting a meter with a grouping (pure; written by
 * `meterWrites.ts`). See there for what it does.
 */
import { regroupMeasures, retime, type TempoEditResult } from "./tempoMath";
import { countSeconds, type Meter } from "./meters";

export interface MeterPlan {
    from: number;
    to: number;
    /** First count of each new measure in the stretch */
    starts: number[];
    /** Counts left over at the end (a short last measure) */
    leftover: number;
    /** The stretch's new count lengths, and the pins after */
    result: TempoEditResult;
    /** The quarter-note tempo kept */
    quarterBpm: number;
}

/**
 * Plan `meter` from the measure starting at spec beat `start`.
 *
 * @param measureStarts first spec beat of every stored measure
 * @param beatCount stored counts
 * @param quarterBpm the quarter-note tempo to keep (the one in effect at `start`)
 */
export function planMeter({
    durations,
    locks,
    measureStarts,
    beatCount,
    start,
    meter,
    quarterBpm,
}: {
    durations: readonly number[];
    locks: ReadonlySet<number>;
    measureStarts: readonly number[];
    beatCount: number;
    start: number;
    meter: Meter;
    quarterBpm: number;
}): MeterPlan {
    const per = meter.grouping.length;
    const r = regroupMeasures(measureStarts, beatCount, start, per);
    const lengths: number[] = [];
    for (let b = r.from; b < r.to; b++) {
        const inMeasure = (b - r.from) % per;
        lengths.push(countSeconds(meter.grouping[inMeasure]!, quarterBpm));
    }
    return {
        from: r.from,
        to: r.to,
        starts: r.starts,
        leftover: r.leftover,
        result: retime(durations, locks, r.from, r.to, lengths),
        quarterBpm,
    };
}
