import { asc, eq, inArray } from "drizzle-orm";
import { schema } from "@/global/database/db";
import { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import {
    planMeasureLineEdit,
    type MeasureLineEdit,
    type MeasureLinePlan,
} from "@/timeline/measureLines";

/**
 * Measure lines and rehearsal marks from the timeline's measure row (tempo experiment E8). Each
 * edit is one transaction, so one undo entry, and writes only `measures` rows: beats and pages are
 * never touched, so counts, timing and drill don't change and the timeline ripple has nothing to
 * do (the same grid, `timelineRipple.ts` `sameGrid`). Nothing here is refused for drill reasons;
 * an edit the measure row never offers (measure 1's line, an unknown measure) throws.
 *
 * Tempo groups are derived from measures on read (`TempoGroupsFromMeasures`): a new line or mark
 * changes how the Music modal groups the measures, never a beat's duration.
 */

/** What an edit did: the plan it applied, with the ids of any measures it created */
export interface MeasureLineEditResult extends MeasureLinePlan {
    readonly createdIds: readonly number[];
}

/**
 * The measure lines in show order, with each line's beat as an ordinal (the beat's index by
 * position), and the show's beat bounds.
 */
async function readMeasureLines(tx: DbConnection | DbTransaction) {
    const beats = await tx
        .select({
            id: schema.beats.id,
            duration: schema.beats.duration,
        })
        .from(schema.beats)
        .orderBy(asc(schema.beats.position))
        .all();
    const ordinalOf = new Map(beats.map((beat, i) => [beat.id, i]));
    const rows = await tx.select().from(schema.measures).all();
    const lines = rows.flatMap((row) => {
        const beat = ordinalOf.get(row.start_beat);
        return beat === undefined
            ? []
            : [{ id: row.id, beat, mark: row.rehearsal_mark }];
    });
    return {
        lines,
        beatIds: beats.map((beat) => beat.id),
        bounds: {
            beatCount: beats.length,
            // The zero-length beat 0 has no time, so no measure starts on it
            firstBeat: beats.length > 1 && beats[0]!.duration === 0 ? 1 : 0,
        },
    };
}

/** Applies one measure-row edit inside `tx`. */
export async function editMeasureLinesInTransaction({
    tx,
    edit,
}: {
    tx: DbTransaction;
    edit: MeasureLineEdit;
}): Promise<MeasureLineEditResult> {
    const { lines, beatIds, bounds } = await readMeasureLines(tx);
    const plan = planMeasureLineEdit(lines, bounds, edit);
    const beatId = (ordinal: number) => {
        const id = beatIds[ordinal];
        if (id === undefined) throw new Error(`no beat at ${ordinal}`);
        return id;
    };
    if (plan.deletes.length > 0)
        await tx
            .delete(schema.measures)
            .where(inArray(schema.measures.id, [...plan.deletes]));
    for (const update of plan.updates)
        await tx
            .update(schema.measures)
            .set({
                ...(update.beat === undefined
                    ? {}
                    : { start_beat: beatId(update.beat) }),
                ...(update.mark === undefined
                    ? {}
                    : { rehearsal_mark: update.mark }),
            })
            .where(eq(schema.measures.id, update.id));
    const createdIds: number[] = [];
    if (plan.creates.length > 0) {
        const created = await tx
            .insert(schema.measures)
            .values(
                plan.creates.map((create) => ({
                    start_beat: beatId(create.beat),
                    rehearsal_mark: create.mark,
                })),
            )
            .returning({ id: schema.measures.id });
        createdIds.push(...created.map((row) => row.id));
    }
    return { ...plan, createdIds };
}

/**
 * One measure-row edit as one undoable change. An edit that changes nothing writes nothing, and
 * adds no undo entry.
 */
export async function editMeasureLines({
    db,
    edit,
}: {
    db: DbConnection;
    edit: MeasureLineEdit;
}): Promise<MeasureLineEditResult> {
    // An edit that changes nothing (renaming C to C) isn't an undo entry
    const { lines, bounds } = await readMeasureLines(db);
    const plan = planMeasureLineEdit(lines, bounds, edit);
    if (plan.creates.length + plan.updates.length + plan.deletes.length === 0)
        return { ...plan, createdIds: [] };
    return await transactionWithHistory(db, "editMeasureLines", async (tx) =>
        editMeasureLinesInTransaction({ tx, edit }),
    );
}
