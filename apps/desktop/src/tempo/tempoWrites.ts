/**
 * PROTOTYPE (tempo mode, branch tempo/track-proto). The writes tempo mode makes, each one undo
 * step: new count lengths, counts added or removed (with the drill choice), measures regrouped
 * for a time signature, rehearsal marks. Locks and measure-number overrides live in the
 * workspace settings, which have no undo (a prototype shortcut).
 */
import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/global/database/db";
import { transactionWithHistory } from "@/db-functions/history";
import type { DbTransaction } from "@/db-functions/types";
import {
    createBeatsInTransaction,
    deleteBeatsCarryingCuesInTransaction,
    updateBeatsInTransaction,
} from "@/db-functions/beat";
import { withTimelinePageRipple } from "@/db-functions/timelineRipple";
import { ensureCountsInTransaction } from "@/db-functions/endlessCounts";
import { resizeTimelineInTransaction } from "@/db-functions/timelineResize";
import {
    createMeasuresInTransaction,
    deleteMeasuresInTransaction,
    updateMeasuresInTransaction,
} from "@/db-functions/measures";
import {
    getWorkspaceSettingsParsed,
    updateWorkspaceSettingsParsed,
} from "@/db-functions/workspaceSettings";
import type { WorkspaceSettings } from "@/settings/workspaceSettings";

/** Beat ids by ordinal (position order), beat 0 first */
async function beatIdsInTransaction(tx: DbTransaction): Promise<number[]> {
    const rows = await tx
        .select({ id: schema.beats.id })
        .from(schema.beats)
        .orderBy(asc(schema.beats.position));
    return rows.map((r) => r.id);
}

/**
 * Give the counts new lengths. `durations` is indexed by spec beat and may run past the stored
 * counts (the endless ones get stored). Only changed counts are written.
 */
export async function writeDurations({
    before,
    after,
}: {
    before: readonly number[];
    after: readonly number[];
}): Promise<void> {
    const changed: number[] = [];
    for (let b = 1; b < after.length; b++)
        if (
            Math.abs((before[b] ?? NaN) - after[b]!) > 1e-9 ||
            b >= before.length
        )
            changed.push(b);
    if (changed.length === 0) return;
    const last = changed[changed.length - 1]!;
    await transactionWithHistory(db, "tempoEdit", async (tx) => {
        await ensureCountsInTransaction({ tx, through: last + 1 });
        const ids = await beatIdsInTransaction(tx);
        await updateBeatsInTransaction({
            tx,
            modifiedBeats: changed
                .filter((b) => ids[b] !== undefined)
                .map((b) => ({ id: ids[b]!, duration: after[b]! })),
        });
    });
}

/** Write count lengths for ordinals `from`.. inside an edit (after counts were added or removed) */
async function writeLengthsInTransaction(
    tx: DbTransaction,
    respaced: { from: number; lengths: readonly number[] } | undefined,
) {
    if (!respaced) return;
    const ids = await beatIdsInTransaction(tx);
    await updateBeatsInTransaction({
        tx,
        modifiedBeats: respaced.lengths.flatMap((duration, i) => {
            const id = ids[respaced.from + i];
            return id === undefined || id === ids[0] ? [] : [{ id, duration }];
        }),
    });
}

/** How the moves over an added or removed count change (the drill choice) */
export type DrillChoice =
    /** The move over the spot gets longer or shorter by the counts (today's ripple) */
    | "adjust"
    /** The move keeps its counts: an added count becomes a hold at its end; a removed one comes out of a hold after it */
    | "keep";

/** What an added or removed count did to the moves */
export interface CountEditResult {
    /** Moves that kept their counts */
    kept: number;
    /** Moves that couldn't keep their counts and changed length after all */
    couldNotKeep: number;
}

/** Moves (timelines) whose range strictly contains ordinal `beat` */
async function movesAround(tx: DbTransaction, beat: number) {
    return await tx
        .select()
        .from(schema.timelines)
        .where(
            and(
                lt(schema.timelines.start_beat, beat),
                gt(schema.timelines.end_beat, beat),
            ),
        );
}

/**
 * Add `count` counts before spec beat `at`, each `duration` long. The moves after shift with the
 * music (the ripple); the move over the spot stretches (`adjust`) or holds (`keep`).
 */
export async function insertCounts({
    at,
    count,
    duration,
    drill,
    respaced,
}: {
    at: number;
    count: number;
    duration: number;
    drill: DrillChoice;
    /** Lengths to give the counts from `from` on afterwards (keep everything else in place) */
    respaced?: { from: number; lengths: readonly number[] };
}): Promise<CountEditResult> {
    return await transactionWithHistory(db, "tempoInsertCounts", async (tx) => {
        await ensureCountsInTransaction({ tx, through: at });
        const around = await movesAround(tx, at);
        await withTimelinePageRipple(tx, async () => {
            await createBeatsInTransaction({
                tx,
                newBeats: Array.from({ length: count }, () => ({
                    duration,
                    include_in_measure: true,
                })),
                startingPosition: at - 1,
            });
        });
        await writeLengthsInTransaction(tx, respaced);
        const result: CountEditResult = { kept: 0, couldNotKeep: 0 };
        if (drill === "keep")
            for (const move of around) {
                const now = await tx
                    .select()
                    .from(schema.timelines)
                    .where(eq(schema.timelines.id, move.id))
                    .get();
                if (!now) continue;
                const grew =
                    now.end_beat -
                    now.start_beat -
                    (move.end_beat - move.start_beat);
                if (grew <= 0) continue;
                try {
                    await resizeTimelineInTransaction({
                        tx,
                        timelineId: move.id,
                        start: now.start_beat,
                        end: now.end_beat - grew,
                    });
                    result.kept++;
                } catch {
                    result.couldNotKeep++;
                }
            }
        return result;
    });
}

/**
 * Remove spec beats `from`..`to - 1`. A measure or page starting on a removed count starts on the
 * next one left (or goes, when that one already starts one). With `keep`, a move that lost counts
 * takes them back from a hold after it where it can.
 */
export async function deleteCounts({
    from,
    to,
    drill,
    respaced,
}: {
    from: number;
    to: number;
    drill: DrillChoice;
    respaced?: { from: number; lengths: readonly number[] };
}): Promise<CountEditResult> {
    return await transactionWithHistory(db, "tempoDeleteCounts", async (tx) => {
        await ensureCountsInTransaction({ tx, through: to + 1 });
        const ids = await beatIdsInTransaction(tx);
        const doomed = ids.slice(Math.max(1, from), to);
        const survivor = ids[to];
        if (doomed.length === 0 || survivor === undefined)
            throw new Error("Can't remove the last count");
        const around = new Map<number, typeof schema.timelines.$inferSelect>();
        for (let b = from; b < to; b++)
            for (const m of await movesAround(tx, b)) around.set(m.id, m);
        await withTimelinePageRipple(tx, async () => {
            // Measures and pages on the removed counts move to the next count left
            const measures = await tx
                .select()
                .from(schema.measures)
                .where(
                    inArray(schema.measures.start_beat, [...doomed, survivor]),
                );
            const onSurvivor = measures.find((m) => m.start_beat === survivor);
            const moving = measures.filter((m) => m.start_beat !== survivor);
            const keep = onSurvivor ? [] : moving.slice(0, 1);
            const drop = moving.filter((m) => !keep.includes(m));
            if (keep.length)
                await updateMeasuresInTransaction({
                    tx,
                    modifiedItems: keep.map((m) => ({
                        id: m.id,
                        start_beat: survivor,
                    })),
                });
            if (drop.length)
                await deleteMeasuresInTransaction({
                    tx,
                    itemIds: new Set(drop.map((m) => m.id)),
                });
            const pages = await tx
                .select()
                .from(schema.pages)
                .where(inArray(schema.pages.start_beat, [...doomed, survivor]));
            const pageOnSurvivor = pages.some((p) => p.start_beat === survivor);
            const movingPages = pages.filter((p) => p.start_beat !== survivor);
            if (
                movingPages.length > 1 ||
                (movingPages.length && pageOnSurvivor)
            )
                throw new Error(
                    "That would remove a page. Remove fewer counts, or delete the page first.",
                );
            for (const p of movingPages)
                await tx
                    .update(schema.pages)
                    .set({ start_beat: survivor })
                    .where(eq(schema.pages.id, p.id));
            await deleteBeatsCarryingCuesInTransaction({
                tx,
                beatIds: new Set(doomed),
            });
        });
        await writeLengthsInTransaction(tx, respaced);
        const result: CountEditResult = { kept: 0, couldNotKeep: 0 };
        if (drill === "keep")
            for (const move of around.values()) {
                const now = await tx
                    .select()
                    .from(schema.timelines)
                    .where(eq(schema.timelines.id, move.id))
                    .get();
                if (!now) continue;
                const lost =
                    move.end_beat -
                    move.start_beat -
                    (now.end_beat - now.start_beat);
                if (lost <= 0) continue;
                try {
                    await resizeTimelineInTransaction({
                        tx,
                        timelineId: move.id,
                        start: now.start_beat,
                        end: now.end_beat + lost,
                    });
                    result.kept++;
                } catch {
                    result.couldNotKeep++;
                }
            }
        return result;
    });
}

/**
 * Regroup the stretch `[from, to)` (spec beats) into measures starting at `starts`: a time
 * signature change. Rehearsal marks stay on their measure's first count, or move to the new
 * measure that holds it.
 */
export async function regroupMeasuresWrite({
    from,
    to,
    starts,
}: {
    from: number;
    to: number;
    starts: readonly number[];
}): Promise<void> {
    await transactionWithHistory(db, "tempoTimeSignature", async (tx) => {
        await ensureCountsInTransaction({ tx, through: to });
        const ids = await beatIdsInTransaction(tx);
        const ordinalOf = new Map(ids.map((id, i) => [id, i]));
        const all = await tx.select().from(schema.measures);
        const inside = all.filter((m) => {
            const o = ordinalOf.get(m.start_beat);
            return o !== undefined && o >= from && o < to;
        });
        const wanted = new Set(starts.map((s) => ids[s]!));
        const marks = new Map<
            number,
            { mark: string | null; notes: string | null }
        >();
        for (const m of inside)
            if (!wanted.has(m.start_beat) && (m.rehearsal_mark || m.notes)) {
                // the new measure holding this count
                const o = ordinalOf.get(m.start_beat)!;
                const holder =
                    [...starts].reverse().find((s) => s <= o) ?? from;
                marks.set(ids[holder]!, {
                    mark: m.rehearsal_mark,
                    notes: m.notes,
                });
            }
        const drop = inside.filter((m) => !wanted.has(m.start_beat));
        if (drop.length)
            await deleteMeasuresInTransaction({
                tx,
                itemIds: new Set(drop.map((m) => m.id)),
            });
        const have = new Set(inside.map((m) => m.start_beat));
        const add = starts.map((s) => ids[s]!).filter((id) => !have.has(id));
        if (add.length)
            await createMeasuresInTransaction({
                tx,
                newItems: add.map((id) => ({
                    start_beat: id,
                    rehearsal_mark: marks.get(id)?.mark ?? null,
                    notes: marks.get(id)?.notes ?? null,
                })),
            });
        const keptWithMark = inside.filter(
            (m) => wanted.has(m.start_beat) && marks.has(m.start_beat),
        );
        if (keptWithMark.length)
            await updateMeasuresInTransaction({
                tx,
                modifiedItems: keptWithMark.map((m) => ({
                    id: m.id,
                    rehearsal_mark:
                        m.rehearsal_mark ?? marks.get(m.start_beat)!.mark,
                })),
            });
    });
}

/** Set (or clear, with null) a measure's rehearsal mark */
export async function setRehearsalMark({
    measureId,
    mark,
}: {
    measureId: number;
    mark: string | null;
}): Promise<void> {
    await transactionWithHistory(db, "tempoRehearsalMark", async (tx) => {
        await updateMeasuresInTransaction({
            tx,
            modifiedItems: [{ id: measureId, rehearsal_mark: mark }],
        });
    });
}

/** Read-modify-write the workspace settings (locks, measure numbers) */
export async function patchWorkspaceSettings(
    patch: (s: WorkspaceSettings) => Partial<WorkspaceSettings>,
): Promise<void> {
    const current = await getWorkspaceSettingsParsed({ db });
    await updateWorkspaceSettingsParsed({
        db,
        settings: { ...current, ...patch(current) },
    });
}
