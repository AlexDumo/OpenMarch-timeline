/**
 * PROTOTYPE (tempo mode): setting a meter with a grouping from a measure on. The stretch is the
 * run of measures from there to the next change (as long as the one there); its counts stay, they
 * are regrouped into measures of the grouping's counts, and each count gets the length its group
 * has at the quarter-note tempo that was in effect, so the music doesn't drift. Counts after the
 * stretch, up to the next pin, re-space to keep that pin (`retime`). One undo step.
 */
import { db } from "@/global/database/db";
import { transactionWithHistory } from "@/db-functions/history";
import { ensureCountsInTransaction } from "@/db-functions/endlessCounts";
import { updateBeatsInTransaction } from "@/db-functions/beat";
import {
    beatIdsInTransaction,
    regroupMeasuresInTransaction,
    writeMarksInTransaction,
} from "./tempoWrites";
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

/** Write a meter plan: measures, their meter, the count lengths and the pins, as one edit */
export async function writeMeter({
    plan,
    before,
    meter,
}: {
    plan: MeterPlan;
    before: readonly number[];
    meter: { meter: string; grouping: string };
}): Promise<void> {
    await transactionWithHistory(db, "tempoMeter", async (tx) => {
        await ensureCountsInTransaction({ tx, through: plan.to + 1 });
        await regroupMeasuresInTransaction(tx, {
            from: plan.from,
            to: plan.to,
            starts: plan.starts,
            meter,
        });
        const ids = await beatIdsInTransaction(tx);
        const after = plan.result.durations;
        const changed: { id: number; duration: number }[] = [];
        for (let b = 1; b < after.length && b < ids.length; b++)
            if (Math.abs((before[b] ?? NaN) - after[b]!) > 1e-9)
                changed.push({ id: ids[b]!, duration: after[b]! });
        if (changed.length)
            await updateBeatsInTransaction({ tx, modifiedBeats: changed });
        await writeMarksInTransaction(tx, ids, { pins: plan.result.locks });
    });
}
