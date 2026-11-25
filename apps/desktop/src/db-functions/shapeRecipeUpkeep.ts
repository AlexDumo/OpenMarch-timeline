import { and, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import * as schema from "@om-electron/database/migrations/schema";
import type { DbTransaction } from "./types";
import {
    hasShapeRecipes,
    ORDER_MARK_KINDS,
    recipesAtBeat,
    sameBeat,
} from "./shapeRecipes";

/**
 * **Keeping shape recipes true after an edit** (ADR 0006 revision of 2026-11-22, §4 as amended by
 * §9.1). A recipe stands at a count, not in a move, so deleting a move no longer cascades to it.
 * This step stands in for that cascade.
 *
 * `transactionWithHistory` runs it right after the edit's function, before the history group is
 * read, so what it deletes is in the edit's undo step. It never runs during undo or redo replay,
 * which restore what an edit changed.
 *
 * It reads only what the edit changed: the assignment rows it deleted or re-timed, from
 * `timeline_change_log` (which the write wrapper drains just after). An edit that removed no
 * arrival costs one read of the log; otherwise only the recipes at the counts those rows ended at
 * are looked at, with no list of row ids bound as SQL variables.
 *
 * A recipe goes only when **every** member's arrival at its count went with this edit (each member
 * has a deleted row ending there), none was only re-timed, and no member arrives there now: the
 * moves that brought the whole shape there were deleted (Delete move, a page's move taken out). It
 * isn't for anything else:
 *
 * - A member off its spot stays listed (§9.1): only placing or editing the shape, dragging a
 *   member off at the count, joining another shape there or deleting the marcher changes who is
 *   listed. The field shows it as a hole.
 * - A member that stands still through the count had no arrival to lose, so a recipe with one is
 *   kept.
 * - A row only re-timed (a clip drag, a resize, a merge's refit) keeps its recipe; moving the recipe
 *   with it is step 3 of §7.
 * - A Basic re-cut writes new rows ending at the same count, so the shape stays.
 * - Order marks are left alone: they never went with a move.
 *
 * The starting spots (count 0) have no arrival rows, so their recipes are never touched here.
 */

/** What the edit did to the rows ending at count `beat`: who lost an arrival there, and how */
interface CountChange {
    readonly beat: number;
    /** Marchers with a row ending at `beat` that the edit deleted */
    readonly deleted: Set<number>;
    /** Marchers with a row ending at `beat` that the edit moved to end elsewhere */
    readonly reTimed: Set<number>;
}

/** The counts this edit took arrivals away from, read from the change log */
async function countsLosingArrivals(tx: DbTransaction): Promise<CountChange[]> {
    const log = schema.timeline_change_log;
    const rows = await tx
        .select({
            marcher: sql<number>`json_extract(${log.before}, '$.marcher')`,
            end: sql<number>`json_extract(${log.before}, '$.end')`,
            endAfter: sql<number | null>`json_extract(${log.after}, '$.end')`,
            deleted: sql<number>`${log.after} IS NULL`,
        })
        .from(log)
        .where(and(eq(log.tbl, "assignments"), isNotNull(log.before)))
        .all();
    const byBeat = new Map<number, CountChange>();
    for (const row of rows) {
        const deleted = Boolean(row.deleted);
        if (
            !deleted &&
            row.endAfter !== null &&
            sameBeat(row.endAfter, row.end)
        )
            continue;
        const change = byBeat.get(row.end) ?? {
            beat: row.end,
            deleted: new Set<number>(),
            reTimed: new Set<number>(),
        };
        (deleted ? change.deleted : change.reTimed).add(row.marcher);
        byBeat.set(row.end, change);
    }
    return [...byBeat.values()].filter((c) => c.deleted.size > 0);
}

/**
 * Deletes the recipes the edit left with nobody arriving at their count (see the module comment).
 * Their member rows cascade.
 */
export async function keepShapeRecipesTrueInTransaction(
    tx: DbTransaction,
): Promise<void> {
    if (!(await hasShapeRecipes(tx))) return;
    const changes = await countsLosingArrivals(tx);
    if (changes.length === 0) return;
    const r = schema.timeline_shape_recipes;
    const m = schema.timeline_shape_recipe_marchers;
    const a = schema.timeline_assignments;
    const gone: number[] = [];
    for (const change of changes) {
        // The shapes at this count, with who they list (the beat index finds them)
        const listed = await tx
            .select({ id: r.id, marcherId: m.marcher_id })
            .from(r)
            .innerJoin(m, eq(m.recipe_id, r.id))
            .where(
                and(
                    recipesAtBeat(change.beat),
                    notInArray(r.kind, [...ORDER_MARK_KINDS]),
                ),
            )
            .all();
        const members = new Map<number, number[]>();
        for (const row of listed)
            members.set(row.id, [
                ...(members.get(row.id) ?? []),
                row.marcherId,
            ]);
        for (const [id, ids] of members) {
            if (!ids.every((marcher) => change.deleted.has(marcher))) continue;
            if (ids.some((marcher) => change.reTimed.has(marcher))) continue;
            // Anyone arriving at the count another way now keeps it
            const arriving = await tx
                .select({ id: a.id })
                .from(a)
                .innerJoin(m, eq(m.marcher_id, a.marcher_id))
                .where(and(eq(m.recipe_id, id), eq(a.end_beat, change.beat)))
                .limit(1)
                .get();
            if (!arriving) gone.push(id);
        }
    }
    for (const id of gone) await tx.delete(r).where(eq(r.id, id)).run();
}
