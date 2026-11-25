import { and, eq, notInArray, sql } from "drizzle-orm";
import * as schema from "@om-electron/database/migrations/schema";
import type { DbTransaction } from "./types";
import {
    hasShapeRecipes,
    ORDER_MARK_KINDS,
    recipesAtBeat,
    recipesRippledIn,
    sameBeat,
    settleRecipesMetInTransaction,
} from "./shapeRecipes";

/**
 * **Keeping shape recipes true after an edit** (ADR 0006 revision of 2026-11-22, §4 as amended by
 * §9.1). A recipe stands at a count, not in a move, so it no longer rides along with its move's
 * end, and deleting a move no longer cascades to it. These two steps stand in for both.
 *
 * `transactionWithHistory` runs them right after the edit's function, before the history group is
 * read, so what they write is in the edit's undo step. They never run during undo or redo replay,
 * which restore what an edit changed.
 *
 * They read only what the edit changed: the assignment rows it deleted or re-timed, from
 * `timeline_change_log` (which the write wrapper drains just after), netted per row (a row a
 * statement moves twice counts once, from where it was to where it ended up). An edit that moved
 * no arrival costs one read of the log; otherwise only the recipes at the counts those rows ended
 * at are looked at, with no list of row ids bound as SQL variables.
 *
 * **1. Re-times** (`followReTimedArrivalsInTransaction`). A shape moves to a new count when the
 * edit re-timed the arrival of **every** member at its count to that one new count (each member has
 * a row that ended at the count and now ends at the new one) and none of them still arrives at the
 * old count: a clip drag, an edge resize, a merge with a refit, a trail or keyframe edit that moves a
 * whole shape's arrival. Otherwise it stays at its count, every member still listed (§9.1); a member
 * whose arrival moved is simply off its spot there (late, or there early), which the field shows.
 * Shapes that meet at the new count settle as the page ripple's do (one shape per marcher at a
 * count). A recipe the page ripple moved in the same edit (tempo, counts, a flag drag) is left
 * where the ripple put it, with the flag or count it was set on (`recipesRippledIn`). Order marks
 * keep their count: they never went with a move.
 *
 * **2. Deletes** (`dropShapesWithNoArrivalInTransaction`). A recipe goes only when **every**
 * member's arrival at its count went with this edit (each member has a deleted row ending there),
 * none was only re-timed, and no member arrives there now: the moves that brought the whole shape
 * there were deleted (Delete move, a page's move taken out). It isn't for anything else:
 *
 * - A member off its spot stays listed (§9.1): only placing or editing the shape, dragging a
 *   member off at the count, joining another shape there or deleting the marcher changes who is
 *   listed. The field shows it as a hole.
 * - A member that stands still through the count had no arrival to lose, so a recipe with one is
 *   kept.
 * - A row only re-timed keeps its recipe (step 1 moved it, or it stays with that member late).
 * - A Basic re-cut writes new rows ending at the same count, so the shape stays.
 * - Order marks are left alone.
 *
 * The starting spots (count 0) have no arrival rows, so their recipes are never touched here.
 */

/** One assignment row the edit changed, netted: where it ended before, and after (null: deleted) */
interface ArrivalChange {
    readonly marcher: number;
    readonly was: number;
    readonly now: number | null;
}

/**
 * The assignment rows that existed before the edit and that it deleted or changed, netted per row
 * from the change log. Rows the edit inserted are left out: they took no arrival away.
 */
async function readArrivalChanges(tx: DbTransaction): Promise<ArrivalChange[]> {
    const log = schema.timeline_change_log;
    const rows = await tx
        .select({
            row: log.row_id,
            hadBefore: sql<number>`${log.before} IS NOT NULL`,
            marcher: sql<
                number | null
            >`json_extract(${log.before}, '$.marcher')`,
            end: sql<number | null>`json_extract(${log.before}, '$.end')`,
            endAfter: sql<number | null>`json_extract(${log.after}, '$.end')`,
            deleted: sql<number>`${log.after} IS NULL`,
        })
        .from(log)
        .where(eq(log.tbl, "assignments"))
        .orderBy(log.seq)
        .all();
    const byRow = new Map<
        number,
        { marcher: number | null; was: number | null; now: number | null }
    >();
    for (const row of rows) {
        const now = row.deleted ? null : row.endAfter;
        const seen = byRow.get(row.row);
        if (seen) seen.now = now;
        else
            byRow.set(row.row, {
                // An insert has no row image before: it took nothing away
                marcher: row.hadBefore ? row.marcher : null,
                was: row.hadBefore ? row.end : null,
                now,
            });
    }
    const changes: ArrivalChange[] = [];
    for (const { marcher, was, now } of byRow.values()) {
        if (marcher === null || was === null) continue;
        if (now !== null && sameBeat(now, was)) continue;
        changes.push({ marcher, was, now });
    }
    return changes;
}

/** The shapes (not order marks) at count `beat`, with who each lists, by recipe id */
async function shapesListedAt(
    tx: DbTransaction,
    beat: number,
): Promise<Map<number, number[]>> {
    const r = schema.timeline_shape_recipes;
    const m = schema.timeline_shape_recipe_marchers;
    const listed = await tx
        .select({ id: r.id, marcherId: m.marcher_id })
        .from(r)
        .innerJoin(m, eq(m.recipe_id, r.id))
        .where(
            and(recipesAtBeat(beat), notInArray(r.kind, [...ORDER_MARK_KINDS])),
        )
        .all();
    const members = new Map<number, number[]>();
    for (const row of listed) {
        const ids = members.get(row.id);
        if (ids) ids.push(row.marcherId);
        else members.set(row.id, [row.marcherId]);
    }
    return members;
}

/** Whether any marcher recipe `id` lists has a row ending at count `beat` now */
async function anyMemberArrivesAt(
    tx: DbTransaction,
    id: number,
    beat: number,
): Promise<boolean> {
    const m = schema.timeline_shape_recipe_marchers;
    const a = schema.timeline_assignments;
    const arriving = await tx
        .select({ id: a.id })
        .from(a)
        .innerJoin(m, eq(m.marcher_id, a.marcher_id))
        .where(
            and(eq(m.recipe_id, id), sql`abs(${a.end_beat} - ${beat}) < 1e-9`),
        )
        .limit(1)
        .get();
    return arriving !== undefined;
}

/** Groups `items` by count (counts the same as stored fall together), keyed by the count */
function byCount<T>(
    items: readonly T[],
    countOf: (item: T) => number,
): Map<number, T[]> {
    const groups = new Map<number, { count: number; items: T[] }>();
    for (const item of items) {
        const count = countOf(item);
        const key = Math.round(count * 1e6);
        const group = groups.get(key);
        if (group) group.items.push(item);
        else groups.set(key, { count, items: [item] });
    }
    return new Map([...groups.values()].map((g) => [g.count, g.items]));
}

/**
 * Step 1 of the module comment: moves each shape whose every member's arrival the edit re-timed
 * to one new count there, and settles shapes that meet at it.
 */
async function followReTimedArrivalsInTransaction(
    tx: DbTransaction,
    changes: readonly ArrivalChange[],
): Promise<void> {
    const rippled = recipesRippledIn(tx);
    const reTimed = changes.filter(
        (c): c is ArrivalChange & { now: number } => c.now !== null,
    );
    if (reTimed.length === 0) return;
    const moves: { id: number; was: number; now: number }[] = [];
    for (const [was, rows] of byCount(reTimed, (c) => c.was)) {
        if (sameBeat(was, 0)) continue;
        // Where each marcher's arrival at `was` went
        const nowOf = new Map<number, number[]>();
        for (const row of rows) {
            const nows = nowOf.get(row.marcher);
            if (nows) nows.push(row.now);
            else nowOf.set(row.marcher, [row.now]);
        }
        for (const [id, ids] of await shapesListedAt(tx, was)) {
            if (rippled.has(id)) continue;
            const targets = ids.flatMap((marcher) => nowOf.get(marcher) ?? []);
            if (!ids.every((marcher) => nowOf.has(marcher))) continue;
            const now = targets[0]!;
            if (!targets.every((t) => sameBeat(t, now))) continue;
            // A member still arriving at the count (Split at playhead cut its row there) keeps it
            if (await anyMemberArrivesAt(tx, id, was)) continue;
            moves.push({ id, was, now });
        }
    }
    if (moves.length === 0) return;
    const r = schema.timeline_shape_recipes;
    for (const move of moves)
        await tx
            .update(r)
            .set({ beat: move.now })
            .where(eq(r.id, move.id))
            .run();
    // Shapes already at a new count meet the ones that came: one shape per marcher there
    const moved = new Set(moves.map((m) => m.id));
    for (const [now, arrived] of byCount(moves, (m) => m.now)) {
        const there = [...(await shapesListedAt(tx, now)).keys()]
            .filter((id) => !moved.has(id))
            .map((id) => ({ id, was: now, now }));
        if (there.length > 0)
            await settleRecipesMetInTransaction(tx, [...arrived, ...there]);
    }
}

/**
 * Step 2 of the module comment: deletes the recipes the edit left with nobody arriving at their
 * count. Their member rows cascade.
 */
async function dropShapesWithNoArrivalInTransaction(
    tx: DbTransaction,
    changes: readonly ArrivalChange[],
): Promise<void> {
    const gone: number[] = [];
    for (const [beat, rows] of byCount(changes, (c) => c.was)) {
        const deleted = new Set(
            rows.filter((c) => c.now === null).map((c) => c.marcher),
        );
        if (deleted.size === 0) continue;
        const reTimed = new Set(
            rows.filter((c) => c.now !== null).map((c) => c.marcher),
        );
        for (const [id, ids] of await shapesListedAt(tx, beat)) {
            if (!ids.every((marcher) => deleted.has(marcher))) continue;
            if (ids.some((marcher) => reTimed.has(marcher))) continue;
            // Anyone arriving at the count another way now keeps it
            if (!(await anyMemberArrivesAt(tx, id, beat))) gone.push(id);
        }
    }
    const r = schema.timeline_shape_recipes;
    for (const id of gone) await tx.delete(r).where(eq(r.id, id)).run();
}

/**
 * Moves the shapes whose whole arrival the edit re-timed, then deletes the ones it left with
 * nobody arriving at their count (see the module comment).
 */
export async function keepShapeRecipesTrueInTransaction(
    tx: DbTransaction,
): Promise<void> {
    if (!(await hasShapeRecipes(tx))) return;
    const changes = await readArrivalChanges(tx);
    if (changes.length === 0) return;
    await followReTimedArrivalsInTransaction(tx, changes);
    await dropShapesWithNoArrivalInTransaction(tx, changes);
}
