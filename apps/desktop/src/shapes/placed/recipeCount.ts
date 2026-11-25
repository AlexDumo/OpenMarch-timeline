import {
    isOrderMarkKind,
    orderMarkBeat,
    type StoredShapeRecipe,
} from "@/db-functions/shapeRecipes";
import { readTimelineEndBeats } from "@/db-functions/timelines";
import type { DbConnection, DbTransaction } from "@/db-functions/types";

/**
 * Where a placed shape recipe stands in the show: its count, and which shape it is (ADR 0006,
 * revision of 2026-11-22, "a shape is a formation at a count", step 1). Every reader asks here,
 * so step 2 can store the count (`beat`) and the shape key (`shape_key`) in one place.
 *
 * Until then a recipe's count is worked out as the readers always did:
 *
 * - a recipe in a move stands at the move's end (`timelines.end_beat`);
 * - a recipe in no move (`null`) stands at the starting spots, beat 0;
 * - an order mark (pathways step 4g, `ORDER_MARK_KINDS`) stands at its own beat
 *   (`orderMarkBeat`), or, saved before marks kept one, where its move puts it;
 * - a recipe whose move is gone (read before the cascade caught up) stands nowhere: undefined.
 *
 * Writers (saving recipes, splits and merges carrying them) still go by move until step 2.
 */

/** What the count rule reads of a recipe */
export type CountedRecipe = Pick<
    StoredShapeRecipe,
    "id" | "timelineId" | "kind" | "params"
>;

/** The end beat of move `timelineId`, undefined for a move that's gone */
export type MoveEndOf = (timelineId: number) => number | undefined;

/**
 * Where the move recipe `recipe` is stored in ends: 0 for the starting spots (no move), undefined
 * for a move that's gone. A shape's count; an order mark's only when it has no beat of its own.
 */
export function recipeMoveEnd(
    recipe: Pick<CountedRecipe, "timelineId">,
    moveEndOf: MoveEndOf,
): number | undefined {
    return recipe.timelineId === null ? 0 : moveEndOf(recipe.timelineId);
}

/** The count (beat) `recipe` stands at, or undefined when its move is gone */
export function recipeCount(
    recipe: CountedRecipe,
    moveEndOf: MoveEndOf,
): number | undefined {
    const moveEnd = recipeMoveEnd(recipe, moveEndOf);
    if (moveEnd === undefined) return undefined;
    return isOrderMarkKind(recipe.kind)
        ? (orderMarkBeat(recipe.params) ?? moveEnd)
        : moveEnd;
}

/**
 * Which shape `recipe` is a mark of. Every recipe is its own shape until marks of one shape share
 * a stored key (§9.2, step 2).
 */
export function recipeShapeKey(recipe: Pick<CountedRecipe, "id">): number {
    return recipe.id;
}

/** Two counts the same, as stored */
export const sameCount = (a: number, b: number): boolean =>
    Math.abs(a - b) < 1e-9;

/** Of `recipes`, those standing at count `beat`, in their order */
export function recipesAtCount<R extends CountedRecipe>(
    recipes: readonly R[],
    beat: number,
    moveEndOf: MoveEndOf,
): R[] {
    return recipes.filter((recipe) => {
        const count = recipeCount(recipe, moveEndOf);
        return count !== undefined && sameCount(count, beat);
    });
}

/** The moves `recipes` are stored in, whose ends their counts need */
export function recipeMoveIds(
    recipes: readonly Pick<CountedRecipe, "timelineId">[],
): number[] {
    return recipes.flatMap((r) =>
        r.timelineId === null ? [] : [r.timelineId],
    );
}

/**
 * The end beats of the moves `recipes` are stored in, by move id; moves that are gone are left
 * out
 */
export function readRecipeMoveEnds(
    db: DbConnection | DbTransaction,
    recipes: readonly Pick<CountedRecipe, "timelineId">[],
): Promise<Map<number, number>> {
    return readTimelineEndBeats(db, recipeMoveIds(recipes));
}
