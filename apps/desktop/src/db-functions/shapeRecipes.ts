import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import * as schema from "@om-electron/database/migrations/schema";
import type { DbConnection, DbTransaction } from "./types";

/**
 * Shape recipes (ADR 0006): how a placed shape laid out its marchers, stored beside the positions
 * so the shape can be reopened and edited. Positions stay the source of truth; a member's
 * override is where it stands less where its recipe put it (`x`, `y`).
 *
 * A recipe stands at a count (`beat`; 0 is the starting spots), not in a move (ADR 0006 revision of
 * 2026-11-22, "a shape is a formation at a count"): it lists every marcher placed in it, however
 * and whenever each gets to its spot (a move of its own, any move or layer, or standing still).
 * Every mark of one shape carries one `shapeKey`, the id of its first mark (§9.2). An order mark
 * (pathways step 4g, `ORDER_MARK_KINDS`) is no shape: it stands at its count too, and every reader
 * that asks for shapes skips the marks (`shapeRecipesOnly`, or a kind no shape tool reads). A
 * marcher is in at most one shape recipe at a count, and in at most one order mark at a count
 * (§1.4): saving a recipe takes its marchers out of the others there, and deletes any recipe left
 * with no one. Writes run inside the edit that placed the positions, so the shape and its
 * positions are one undo step.
 */

export interface ShapeRecipeRecord {
    readonly kind: string;
    readonly kindVersion: number;
    /** The kind's parameters, JSON-serializable, in field units */
    readonly params: unknown;
    readonly orderMode: string;
    readonly reverse: boolean;
}

export interface ShapeRecipeMember {
    readonly marcherId: number;
    readonly slot: number;
    /** Where the recipe put the marcher, without any override */
    readonly x: number;
    readonly y: number;
}

export interface StoredShapeRecipe extends ShapeRecipeRecord {
    readonly id: number;
    /** The count the recipe stands at (0: the starting spots) */
    readonly beat: number;
    /** Which shape it is a mark of: the id of the shape's first mark (§9.2) */
    readonly shapeKey: number;
    readonly members: readonly ShapeRecipeMember[];
}

const recipes = schema.timeline_shape_recipes;
const members = schema.timeline_shape_recipe_marchers;

/** Where-clause for the recipes nobody is in */
const noMembers = () =>
    sql`NOT EXISTS (SELECT 1 FROM ${members} WHERE ${members.recipe_id} = ${recipes.id})`;

/** Two counts the same, as stored */
export const sameBeat = (a: number, b: number): boolean =>
    Math.abs(a - b) < 1e-9;

/** Where-clause for the recipes standing at count `beat`: a range, so the `beat` index serves it */
export const recipesAtBeat = (beat: number) =>
    sql`${recipes.beat} BETWEEN ${beat - 1e-9} AND ${beat + 1e-9}`;

/**
 * Saves a recipe for `members` at count `beat`, replacing `replaces` when given (an edited recipe
 * keeps its id and its shape key). Every member is listed, whichever move brings it there or none
 * (§1.3). They leave the other recipes of their class at the count (shapes and ungroup marks one
 * class, order marks the other), and recipes left empty are deleted.
 *
 * A new recipe is a shape of its own (its `shapeKey` is its id), unless `shapeKey` says which
 * shape it is a mark of: an edit of a carried shape at a later count takes the key of the mark it
 * was carried from (§1.5).
 *
 * `keepOrderMarks` leaves the order marks at the count alone: a shape's members changed by hand
 * (one dragged off) don't redefine an order set by hand there.
 *
 * @returns the recipe's id
 */
export async function saveShapeRecipeInTransaction({
    tx,
    beat,
    recipe,
    members: placed,
    replaces,
    shapeKey,
    keepOrderMarks = false,
}: {
    tx: DbTransaction;
    beat: number;
    recipe: ShapeRecipeRecord;
    members: readonly ShapeRecipeMember[];
    replaces?: number;
    shapeKey?: number;
    keepOrderMarks?: boolean;
}): Promise<number> {
    const marcherIds = placed.map((m) => m.marcherId);
    const values = {
        beat,
        kind: recipe.kind,
        kind_version: recipe.kindVersion,
        params: JSON.stringify(recipe.params),
        order_mode: recipe.orderMode,
        reverse: recipe.reverse,
    };

    let id: number;
    if (replaces !== undefined) {
        await tx
            .update(recipes)
            .set(
                shapeKey === undefined
                    ? values
                    : { ...values, shape_key: shapeKey },
            )
            .where(eq(recipes.id, replaces))
            .run();
        await tx.delete(members).where(eq(members.recipe_id, replaces)).run();
        id = replaces;
    } else {
        // The id SQLite would give it, written out so a new shape's key can be its own id
        const next = await tx
            .select({ id: sql<number>`coalesce(max(${recipes.id}), 0) + 1` })
            .from(recipes)
            .get();
        id = Number(next?.id ?? 1);
        await tx
            .insert(recipes)
            .values({ ...values, id, shape_key: shapeKey ?? id })
            .run();
    }

    // Out of the other recipes at its count
    if (marcherIds.length > 0)
        await takeOutOfOthers(tx, {
            id,
            beat,
            recipe,
            marcherIds,
            keepOrderMarks,
        });

    if (placed.length > 0) {
        await tx
            .insert(members)
            .values(
                placed.map((m) => ({
                    recipe_id: id,
                    marcher_id: m.marcherId,
                    slot: m.slot,
                    x: m.x,
                    y: m.y,
                })),
            )
            .run();
    }

    await deleteEmptyRecipes(tx);
    return id;
}

/**
 * Takes `marcherIds` out of the other recipes at count `beat` (`saveShapeRecipeInTransaction`):
 * a shape or ungroup mark out of the others of its class and, unless `keepOrderMarks`, out of the
 * order marks; an order mark out of the other order marks only
 */
async function takeOutOfOthers(
    tx: DbTransaction,
    {
        id,
        beat,
        recipe,
        marcherIds,
        keepOrderMarks,
    }: {
        id: number;
        beat: number;
        recipe: ShapeRecipeRecord;
        marcherIds: readonly number[];
        keepOrderMarks: boolean;
    },
): Promise<void> {
    const orderMark = isOrderMarkKind(recipe.kind);
    const kinds = orderMark
        ? inArray(recipes.kind, [...ORDER_MARK_KINDS])
        : keepOrderMarks
          ? notInArray(recipes.kind, [...ORDER_MARK_KINDS])
          : undefined;
    const others = tx
        .select({ id: recipes.id })
        .from(recipes)
        .where(and(recipesAtBeat(beat), notInArray(recipes.id, [id]), kinds));
    await tx
        .delete(members)
        .where(
            and(
                inArray(members.recipe_id, others),
                inArray(members.marcher_id, [...marcherIds]),
            ),
        )
        .run();
}

/**
 * Whether any of `marcherIds` arrives at count `beat`: a row of theirs ends there (the starting
 * spots hold everyone). A recipe changed at a count its marchers only stand still through, with
 * no one set there, is saved where it was instead of copied there (#485).
 */
export async function anyArrivesAt(
    tx: DbTransaction,
    beat: number,
    marcherIds: readonly number[],
): Promise<boolean> {
    if (beat === 0) return true;
    if (marcherIds.length === 0) return false;
    const a = schema.timeline_assignments;
    const row = await tx
        .select({ id: a.id })
        .from(a)
        .where(
            and(
                inArray(a.marcher_id, [...new Set(marcherIds)]),
                sql`abs(${a.end_beat} - ${beat}) < 1e-9`,
            ),
        )
        .limit(1)
        .get();
    return row !== undefined;
}

/** The beat move `timelineId` ends at, undefined when it's gone */
async function moveEndOf(
    tx: DbTransaction,
    timelineId: number,
): Promise<number | undefined> {
    const t = schema.timelines;
    const move = await tx
        .select({ end: t.end_beat })
        .from(t)
        .where(eq(t.id, timelineId))
        .get();
    return move?.end;
}

/** The order marks at count `beat` */
async function orderMarksAtBeat(
    tx: DbTransaction,
    beat: number,
): Promise<number[]> {
    const rows = await tx
        .select({ id: recipes.id })
        .from(recipes)
        .where(
            and(
                inArray(recipes.kind, [...ORDER_MARK_KINDS]),
                recipesAtBeat(beat),
            ),
        )
        .all();
    return rows.map((r) => r.id);
}

/**
 * Takes `marcherIds` out of the order marks (pathways step 4g) at the count move `timelineId` ends
 * at, and deletes marks left with no one: an edit to that move's trail is newer than an order set
 * or cleared by hand there, so the trail's order holds again (the latest action wins). A mark at a
 * later count (the line stood still there) is left alone. Run inside that edit's transaction, so
 * undo brings the marks back with it.
 */
export async function dropOrderMarksInTransaction(
    tx: DbTransaction,
    timelineId: number,
    marcherIds: readonly number[],
): Promise<void> {
    if (marcherIds.length === 0 || !(await hasShapeRecipes(tx))) return;
    const end = await moveEndOf(tx, timelineId);
    if (end === undefined) return;
    const marks = await orderMarksAtBeat(tx, end);
    if (marks.length === 0) return;
    await tx
        .delete(members)
        .where(
            and(
                inArray(members.recipe_id, marks),
                inArray(members.marcher_id, [...new Set(marcherIds)]),
            ),
        )
        .run();
    await deleteEmptyRecipes(tx);
}

/** The recipes the page ripple moved in each transaction (`recipesRippledIn`) */
const rippledRecipes = new WeakMap<object, Set<number>>();

/**
 * The recipes the page ripple moved to a new count in `tx`. The re-time step after an edit
 * (`shapeRecipeUpkeep.ts`) leaves them alone: the ripple re-times rows over the whole grid, and its
 * rule for recipes (with the flag or count they were set on) already placed them, so a recipe it
 * brought onto a count whose arrivals moved on mustn't follow those too.
 */
export const recipesRippledIn = (tx: DbTransaction): ReadonlySet<number> =>
    rippledRecipes.get(tx) ?? new Set();

/**
 * Moves every recipe's count after a page or beat edit (the page ripple), shapes and order marks
 * alike (ADR 0006 revision of 2026-11-22, §4): `place` gives a recipe's new count from its old one,
 * or null when the page it was set on is gone, which deletes it. The starting spots (0) stay.
 */
export async function rippleShapeRecipesInTransaction(
    tx: DbTransaction,
    place: (beat: number) => number | null,
): Promise<void> {
    if (!(await hasShapeRecipes(tx))) return;
    const rippled = rippledRecipes.get(tx) ?? new Set<number>();
    rippledRecipes.set(tx, rippled);
    const all = await tx
        .select({ id: recipes.id, beat: recipes.beat, kind: recipes.kind })
        .from(recipes)
        .all();
    const gone: number[] = [];
    const kept: { id: number; mark: boolean; was: number; now: number }[] = [];
    for (const recipe of all) {
        if (recipe.beat === 0) continue;
        const next = place(recipe.beat);
        if (next === null) {
            gone.push(recipe.id);
            continue;
        }
        kept.push({
            id: recipe.id,
            mark: isOrderMarkKind(recipe.kind),
            was: recipe.beat,
            now: next,
        });
        if (sameBeat(next, recipe.beat)) continue;
        rippled.add(recipe.id);
        await tx
            .update(recipes)
            .set({ beat: next })
            .where(eq(recipes.id, recipe.id))
            .run();
    }
    if (gone.length > 0)
        await tx.delete(recipes).where(inArray(recipes.id, gone)).run();
    await settleRecipesMetInTransaction(
        tx,
        kept.filter((k) => k.mark),
    );
    await settleRecipesMetInTransaction(
        tx,
        kept.filter((k) => !k.mark),
    );
}

/**
 * Recipes of one class an edit brought onto one count (the page ripple, or a re-time): a marcher
 * stays in the one that was latest before it (then the newest), as saving a recipe takes its
 * marchers out of the others at its count. Recipes left empty are deleted. `kept` lists each
 * recipe's count before (`was`) and after (`now`) the edit, those that didn't move too.
 */
export async function settleRecipesMetInTransaction(
    tx: DbTransaction,
    kept: readonly { id: number; was: number; now: number }[],
): Promise<void> {
    const met = kept.filter((a) =>
        kept.some((b) => b.id !== a.id && sameBeat(a.now, b.now)),
    );
    if (met.length === 0) return;
    const rows = await tx
        .select({ recipe: members.recipe_id, marcher: members.marcher_id })
        .from(members)
        .where(
            inArray(
                members.recipe_id,
                met.map((m) => m.id),
            ),
        )
        .all();
    const latestFirst = [...met].sort((a, b) => b.was - a.was || b.id - a.id);
    const done = new Set<number>();
    for (const mark of latestFirst) {
        if (done.has(mark.id)) continue;
        const group = latestFirst.filter((m) => sameBeat(m.now, mark.now));
        const claimed = new Set<number>();
        for (const m of group) {
            done.add(m.id);
            const theirs = rows
                .filter((r) => r.recipe === m.id)
                .map((r) => r.marcher);
            const taken = theirs.filter((id) => claimed.has(id));
            if (taken.length > 0)
                await tx
                    .delete(members)
                    .where(
                        and(
                            eq(members.recipe_id, m.id),
                            inArray(members.marcher_id, taken),
                        ),
                    )
                    .run();
            for (const id of theirs) claimed.add(id);
        }
    }
    await tx
        .delete(recipes)
        .where(
            and(
                inArray(
                    recipes.id,
                    met.map((m) => m.id),
                ),
                noMembers(),
            ),
        )
        .run();
}

/**
 * The kind of a recipe that marks its members **ungrouped** (`ungroupShape`, `UNGROUPED_KIND` in
 * `shapes/placed/placedBox.ts`). It stores no shape, so code asking whether a marcher is in a
 * shape skips it (`shapeRecipesOnly`).
 */
export const UNGROUPED_RECIPE_KIND = "ungrouped";

/**
 * The kind of a recipe that holds a line's order set by hand (pathways step 4g, DL-26): its members
 * by slot, the leader first. It stores no shape and moves no one. Saving one takes its marchers out
 * of the other order marks at its beat only; a shape saved later at that beat takes them out of it.
 */
export const ORDER_RECIPE_KIND = "order";

/**
 * The kind of a recipe that ends its members' order by hand (Clear order, pathways step 4g): as an
 * ungrouped mark ends it, but leaving the shapes they're in alone
 */
export const ORDER_CLEAR_RECIPE_KIND = "orderClear";

/** The order marks: kinds that store no shape, only who is in which order */
export const ORDER_MARK_KINDS: ReadonlySet<string> = new Set([
    ORDER_RECIPE_KIND,
    ORDER_CLEAR_RECIPE_KIND,
]);

/** Whether a recipe of `kind` is an order mark rather than a shape */
export const isOrderMarkKind = (kind: string): boolean =>
    ORDER_MARK_KINDS.has(kind);

/** Where-clause for the recipes that describe a shape: every kind but an ungrouped or order mark */
export const shapeRecipesOnly = () =>
    notInArray(recipes.kind, [UNGROUPED_RECIPE_KIND, ...ORDER_MARK_KINDS]);

/**
 * After `marcherIds` are cleared off moves `timelineIds`, takes those that no longer arrive at the
 * count of an ungrouped mark at one of those moves' ends out of it (no row of theirs ends there),
 * and deletes a mark left with nobody. Only cleared marchers: a marcher whose rows are only re-cut
 * into other moves over the same page (Basic's mid-page points) still arrives, and stays in. A
 * mark still naming a marcher cleared off its page would keep hiding the earlier shape that
 * marcher now stands in (Clear this page reverts the page, its Ungroup included). Real shapes'
 * recipes are left to their writers. Run after the clear, while the moves are still there.
 */
export async function dropUngroupedLeavers(
    tx: DbTransaction,
    timelineIds: readonly number[],
    marcherIds: readonly number[],
): Promise<void> {
    if (
        timelineIds.length === 0 ||
        marcherIds.length === 0 ||
        !(await hasShapeRecipes(tx))
    )
        return;
    const t = schema.timelines;
    const ends = (
        await tx
            .selectDistinct({ end: t.end_beat })
            .from(t)
            .where(inArray(t.id, [...new Set(timelineIds)]))
            .all()
    ).map((r) => r.end);
    if (ends.length === 0) return;
    const marks = await tx
        .select({ id: recipes.id, beat: recipes.beat })
        .from(recipes)
        .where(
            and(
                eq(recipes.kind, UNGROUPED_RECIPE_KIND),
                inArray(recipes.beat, ends),
            ),
        )
        .all();
    if (marks.length === 0) return;
    for (const mark of marks) {
        const a = schema.timeline_assignments;
        const stillArriving = new Set(
            (
                await tx
                    .selectDistinct({ id: a.marcher_id })
                    .from(a)
                    .where(
                        and(
                            inArray(a.marcher_id, [...new Set(marcherIds)]),
                            sql`abs(${a.end_beat} - ${mark.beat}) < 1e-9`,
                        ),
                    )
                    .all()
            ).map((r) => r.id),
        );
        const leavers = [...new Set(marcherIds)].filter(
            (id) => !stillArriving.has(id),
        );
        if (leavers.length > 0)
            await tx
                .delete(members)
                .where(
                    and(
                        eq(members.recipe_id, mark.id),
                        inArray(members.marcher_id, leavers),
                    ),
                )
                .run();
    }
    await deleteEmptyRecipes(tx);
}

/** Whether the show stores shape recipes at all (a database from before them doesn't) */
export async function hasShapeRecipes(
    tx: DbConnection | DbTransaction,
): Promise<boolean> {
    const row = await tx.get<{ name: string } | undefined>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'timeline_shape_recipes'`,
    );
    return row !== undefined;
}

/** Deletes the recipes nobody is in anymore */
export async function deleteEmptyRecipes(tx: DbTransaction): Promise<void> {
    await tx.delete(recipes).where(noMembers()).run();
}

/** The recipes at count `beat` (0 for the starting spots) that any of `marcherIds` are in. */
export async function readShapeRecipes({
    db,
    beat,
    marcherIds,
}: {
    db: DbConnection | DbTransaction;
    beat: number;
    marcherIds: readonly number[];
}): Promise<StoredShapeRecipe[]> {
    if (marcherIds.length === 0) return [];
    const hits = await db
        .selectDistinct({ id: members.recipe_id })
        .from(members)
        .innerJoin(recipes, eq(recipes.id, members.recipe_id))
        .where(
            and(
                recipesAtBeat(beat),
                inArray(members.marcher_id, [...new Set(marcherIds)]),
            ),
        )
        .all();
    return recipesById(
        db,
        hits.map((h) => h.id),
    );
}

/** Recipe `id` as stored, or null when there's none (a save that kept no one deletes it) */
export async function readShapeRecipe(
    db: DbConnection | DbTransaction,
    id: number,
): Promise<StoredShapeRecipe | null> {
    return (await recipesById(db, [id]))[0] ?? null;
}

/** Every recipe that any of `marcherIds` is in, in any move */
export async function readShapeRecipesOf({
    db,
    marcherIds,
}: {
    db: DbConnection | DbTransaction;
    marcherIds: readonly number[];
}): Promise<StoredShapeRecipe[]> {
    if (marcherIds.length === 0) return [];
    const hits = await db
        .selectDistinct({ id: members.recipe_id })
        .from(members)
        .where(inArray(members.marcher_id, [...new Set(marcherIds)]))
        .all();
    return recipesById(
        db,
        hits.map((h) => h.id),
    );
}

/** Every recipe in the show */
export async function readAllShapeRecipes(
    db: DbConnection | DbTransaction,
): Promise<StoredShapeRecipe[]> {
    const rows = await db.select({ id: recipes.id }).from(recipes).all();
    return recipesById(
        db,
        rows.map((r) => r.id),
    );
}

/** Recipes by id, with their members in slot order */
async function recipesById(
    db: DbConnection | DbTransaction,
    ids: readonly number[],
): Promise<StoredShapeRecipe[]> {
    if (ids.length === 0) return [];
    const rows = await db
        .select()
        .from(recipes)
        .where(inArray(recipes.id, [...ids]))
        .all();
    const memberRows = await db
        .select()
        .from(members)
        .where(inArray(members.recipe_id, [...ids]))
        .all();
    return rows
        .sort((a, b) => a.id - b.id)
        .map((row) => ({
            id: row.id,
            beat: row.beat,
            shapeKey: row.shape_key,
            kind: row.kind,
            kindVersion: row.kind_version,
            params: JSON.parse(row.params) as unknown,
            orderMode: row.order_mode,
            reverse: row.reverse,
            members: memberRows
                .filter((m) => m.recipe_id === row.id)
                .sort((a, b) => a.slot - b.slot)
                .map((m) => ({
                    marcherId: m.marcher_id,
                    slot: m.slot,
                    x: m.x,
                    y: m.y,
                })),
        }));
}
