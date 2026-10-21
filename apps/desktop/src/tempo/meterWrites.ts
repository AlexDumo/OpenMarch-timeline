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
import type { MeterPlan } from "./meterPlan";

export { planMeter, type MeterPlan } from "./meterPlan";

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
