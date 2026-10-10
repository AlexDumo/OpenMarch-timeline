import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { schema } from "@/global/database/db";
import type { DbConnection, DbTransaction } from "./types";

/**
 * Shape recipes (ADR 0004): how a placed shape laid out its marchers, stored beside the positions
 * so the shape can be reopened and edited. Positions stay the source of truth; a member's
 * override is where it stands less where its recipe put it (`x`, `y`).
 *
 * A recipe belongs to a move (`timelineId`), or to the homes (`null`). A marcher is in at most one
 * recipe per move: saving a recipe takes its marchers out of the move's other recipes and deletes
 * any recipe left with no one. Writes run inside the edit that placed the positions, so the shape
 * and its positions are one undo step.
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
    readonly timelineId: number | null;
    readonly members: readonly ShapeRecipeMember[];
}

const recipes = schema.timeline_shape_recipes;
const members = schema.timeline_shape_recipe_marchers;

const sameMove = (timelineId: number | null) =>
    timelineId === null
        ? isNull(recipes.timeline_id)
        : eq(recipes.timeline_id, timelineId);

/**
 * Saves a recipe for `members` in move `timelineId` (`null` for homes), replacing `replaces` when
 * given (an edited recipe keeps its id). Its marchers leave the move's other recipes, and
 * recipes left empty are deleted.
 *
 * @returns the recipe's id
 */
export async function saveShapeRecipeInTransaction({
    tx,
    timelineId,
    recipe,
    members: placed,
    replaces,
}: {
    tx: DbTransaction;
    timelineId: number | null;
    recipe: ShapeRecipeRecord;
    members: readonly ShapeRecipeMember[];
    replaces?: number;
}): Promise<number> {
    const marcherIds = placed.map((m) => m.marcherId);
    const values = {
        timeline_id: timelineId,
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
            .set(values)
            .where(eq(recipes.id, replaces))
            .run();
        await tx.delete(members).where(eq(members.recipe_id, replaces)).run();
        id = replaces;
    } else {
        const inserted = await tx
            .insert(recipes)
            .values(values)
            .returning({ id: recipes.id })
            .get();
        id = inserted.id;
    }

    // Out of the move's other recipes
    if (marcherIds.length > 0) {
        const others = await tx
            .select({ id: recipes.id })
            .from(recipes)
            .where(and(sameMove(timelineId), notInArray(recipes.id, [id])))
            .all();
        if (others.length > 0) {
            await tx
                .delete(members)
                .where(
                    and(
                        inArray(
                            members.recipe_id,
                            others.map((r) => r.id),
                        ),
                        inArray(members.marcher_id, marcherIds),
                    ),
                )
                .run();
        }
    }

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

    // Recipes nobody is in anymore
    await tx
        .delete(recipes)
        .where(
            and(
                sameMove(timelineId),
                sql`NOT EXISTS (SELECT 1 FROM ${members} WHERE ${members.recipe_id} = ${recipes.id})`,
            ),
        )
        .run();
    return id;
}

/** The recipes of move `timelineId` (`null` for homes) that any of `marcherIds` are in. */
export async function readShapeRecipes({
    db,
    timelineId,
    marcherIds,
}: {
    db: DbConnection | DbTransaction;
    timelineId: number | null;
    marcherIds: readonly number[];
}): Promise<StoredShapeRecipe[]> {
    if (marcherIds.length === 0) return [];
    const hits = await db
        .selectDistinct({ id: members.recipe_id })
        .from(members)
        .innerJoin(recipes, eq(recipes.id, members.recipe_id))
        .where(
            and(
                sameMove(timelineId),
                inArray(members.marcher_id, [...new Set(marcherIds)]),
            ),
        )
        .all();
    if (hits.length === 0) return [];
    const ids = hits.map((h) => h.id);
    const rows = await db
        .select()
        .from(recipes)
        .where(inArray(recipes.id, ids))
        .all();
    const memberRows = await db
        .select()
        .from(members)
        .where(inArray(members.recipe_id, ids))
        .all();
    return rows
        .sort((a, b) => a.id - b.id)
        .map((row) => ({
            id: row.id,
            timelineId: row.timeline_id,
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
