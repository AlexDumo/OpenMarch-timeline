import { sameBeat, type StoredShapeRecipe } from "@/db-functions/shapeRecipes";

/**
 * Where a placed shape recipe stands in the show: its count, and which shape it is (ADR 0006,
 * revision of 2026-11-22, "a shape is a formation at a count"). Every reader asks here.
 *
 * Since migration 0029 both are stored: a recipe's count is its `beat` (0 for the starting
 * spots; an order mark's can fall partway through a count), and the shape it is a mark of is its
 * `shapeKey`, the id of the shape's first mark (§9.2).
 */

/** What the count rule reads of a recipe */
export type CountedRecipe = Pick<StoredShapeRecipe, "id" | "beat">;

/** The count (beat) `recipe` stands at */
export function recipeCount(recipe: Pick<CountedRecipe, "beat">): number {
    return recipe.beat;
}

/** Which shape `recipe` is a mark of */
export function recipeShapeKey(
    recipe: Pick<StoredShapeRecipe, "shapeKey">,
): number {
    return recipe.shapeKey;
}

/** Two counts the same, as stored */
export const sameCount = sameBeat;

/** Of `recipes`, those standing at count `beat`, in their order */
export function recipesAtCount<R extends Pick<CountedRecipe, "beat">>(
    recipes: readonly R[],
    beat: number,
): R[] {
    return recipes.filter((recipe) => sameCount(recipeCount(recipe), beat));
}
