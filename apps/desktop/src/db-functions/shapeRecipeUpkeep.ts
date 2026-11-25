import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import * as schema from "@om-electron/database/migrations/schema";
import type { DbTransaction } from "./types";
import {
    anyArrivesAt,
    hasShapeRecipes,
    ORDER_MARK_KINDS,
} from "./shapeRecipes";

/**
 * **Keeping shape recipes true after an edit** (ADR 0006 revision of 2026-11-22, §4 as amended by
 * §9.1). A recipe stands at a count, not in a move, so deleting a move no longer cascades to it.
 * This step stands in for that cascade.
 *
 * `transactionWithHistory` reads, before the edit's function, the rows that bring each recipe's
 * members to its count (`readRecipeUpkeepBefore`). Right after the function, before the history
 * group is read, it deletes the recipes the edit left with nobody arriving
 * (`keepShapeRecipesTrueInTransaction`), so the delete is in the edit's undo step. It never runs
 * during undo or redo replay, which restore what an edit changed.
 *
 * A recipe goes only when **every** member arrived at its count before the edit, every one of
 * those rows is gone, and no member has a row ending at the count now: the moves that brought the
 * whole shape there were deleted (Delete move, a page's move taken out). It isn't for anything
 * else:
 *
 * - A member off its spot stays listed (§9.1): only placing or editing the shape, dragging a
 *   member off at the count, joining another shape there or deleting the marcher changes who is
 *   listed. The field shows it as a hole.
 * - A member that stands still through the count (no row ending there) had no arrival to lose, so
 *   a recipe with one is kept.
 * - A row only re-timed (a clip drag, a resize, a merge's refit) is still there; moving the recipe
 *   with it is step 3 of §7.
 * - A Basic re-cut writes new rows ending at the same count, so the shape stays.
 * - Order marks are left alone: they never went with a move.
 *
 * The starting spots (count 0) have no arrival rows, so their recipes are never touched here.
 */

/** A recipe every member of which arrived at its count before the edit */
interface ArrivedRecipe {
    readonly beat: number;
    readonly marcherIds: readonly number[];
    /** Its members' rows ending at its count, by assignment id */
    readonly rows: readonly number[];
}

/** Before the edit: the recipes `keepShapeRecipesTrueInTransaction` checks after it, by id */
export type RecipeArrivalsBefore = ReadonlyMap<number, ArrivedRecipe>;

/**
 * The recipes (not order marks, not at the starting spots) every member of which arrives at the
 * recipe's count, with those arrival rows: what `keepShapeRecipesTrueInTransaction` checks after
 * the edit.
 */
export async function readRecipeUpkeepBefore(
    tx: DbTransaction,
): Promise<RecipeArrivalsBefore> {
    const out = new Map<number, ArrivedRecipe>();
    if (!(await hasShapeRecipes(tx))) return out;
    const r = schema.timeline_shape_recipes;
    const m = schema.timeline_shape_recipe_marchers;
    const a = schema.timeline_assignments;
    const rows = await tx
        .select({
            recipeId: r.id,
            beat: r.beat,
            marcherId: m.marcher_id,
            rowId: a.id,
        })
        .from(r)
        .innerJoin(m, eq(m.recipe_id, r.id))
        .leftJoin(
            a,
            sql`${a.marcher_id} = ${m.marcher_id} AND abs(${a.end_beat} - ${r.beat}) < 1e-9`,
        )
        .where(
            and(sql`${r.beat} > 0`, notInArray(r.kind, [...ORDER_MARK_KINDS])),
        )
        .all();
    const byRecipe = new Map<
        number,
        { beat: number; members: Map<number, number[]> }
    >();
    for (const row of rows) {
        const recipe = byRecipe.get(row.recipeId) ?? {
            beat: row.beat,
            members: new Map<number, number[]>(),
        };
        const arrivals = recipe.members.get(row.marcherId) ?? [];
        if (row.rowId !== null) arrivals.push(row.rowId);
        recipe.members.set(row.marcherId, arrivals);
        byRecipe.set(row.recipeId, recipe);
    }
    for (const [id, recipe] of byRecipe) {
        const lists = [...recipe.members.values()];
        // A member standing still through the count has no arrival to lose
        if (lists.some((l) => l.length === 0)) continue;
        out.set(id, {
            beat: recipe.beat,
            marcherIds: [...recipe.members.keys()].sort((x, y) => x - y),
            rows: lists.flat(),
        });
    }
    return out;
}

/**
 * Deletes the recipes of `before` the edit left with nobody arriving: every arrival row they had
 * is gone, and no member has a row ending at the count now (see the module comment). A recipe the
 * edit itself changed (its count or who is listed) is the edit's, and is left as it is. Their
 * member rows cascade.
 */
export async function keepShapeRecipesTrueInTransaction(
    tx: DbTransaction,
    before: RecipeArrivalsBefore,
): Promise<void> {
    if (before.size === 0) return;
    const a = schema.timeline_assignments;
    const r = schema.timeline_shape_recipes;
    const m = schema.timeline_shape_recipe_marchers;
    const ids = [...before.keys()];
    const now = await tx
        .select({ id: r.id, beat: r.beat, marcherId: m.marcher_id })
        .from(r)
        .innerJoin(m, eq(m.recipe_id, r.id))
        .where(inArray(r.id, ids))
        .all();
    const oldRows = [...before.values()].flatMap((recipe) => recipe.rows);
    const stillThere = new Set(
        (
            await tx
                .select({ id: a.id })
                .from(a)
                .where(inArray(a.id, oldRows))
                .all()
        ).map((row) => row.id),
    );
    const gone: number[] = [];
    for (const [id, recipe] of before) {
        const listed = now
            .filter((row) => row.id === id)
            .map((row) => row.marcherId)
            .sort((x, y) => x - y);
        const beat = now.find((row) => row.id === id)?.beat;
        // Gone already, or changed by the edit itself
        if (
            beat === undefined ||
            beat !== recipe.beat ||
            listed.join() !== recipe.marcherIds.join()
        )
            continue;
        // A row only re-timed is still there (step 3 of §7 moves the recipe with it)
        if (recipe.rows.some((rowId) => stillThere.has(rowId))) continue;
        if (await anyArrivesAt(tx, recipe.beat, recipe.marcherIds)) continue;
        gone.push(id);
    }
    if (gone.length > 0) await tx.delete(r).where(inArray(r.id, gone)).run();
}
