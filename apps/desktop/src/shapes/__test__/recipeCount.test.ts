// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
    recipeCount,
    recipesAtCount,
    recipeShapeKey,
    sameCount,
} from "../placed/recipeCount";

/**
 * The read seam for a recipe's count and shape (ADR 0006 revision of 2026-11-22). Since migration
 * 0030 both are stored: how older files' counts were worked out is 0030's test
 * (`0030_shape_recipes_at_count.test.ts`).
 */
const recipe = (id: number, beat: number, shapeKey = id) => ({
    id,
    beat,
    shapeKey,
});

describe("a recipe's count", () => {
    it("is its stored beat: 0 for the starting spots, partway through a count for an order mark", () => {
        expect(recipeCount(recipe(1, 8))).toBe(8);
        expect(recipeCount(recipe(2, 0))).toBe(0);
        expect(recipeCount(recipe(3, 12.5))).toBe(12.5);
    });

    it("finds the recipes at a count, in their order", () => {
        const all = [
            recipe(1, 8),
            recipe(2, 16),
            recipe(3, 8),
            recipe(4, 8 + 1e-12),
            recipe(5, 0),
        ];
        expect(recipesAtCount(all, 8).map((r) => r.id)).toEqual([1, 3, 4]);
        expect(recipesAtCount(all, 0).map((r) => r.id)).toEqual([5]);
        expect(recipesAtCount(all, 24)).toEqual([]);
    });

    it("compares counts as stored", () => {
        expect(sameCount(8, 8 + 1e-12)).toBe(true);
        expect(sameCount(8, 8.5)).toBe(false);
    });
});

describe("a recipe's shape key", () => {
    it("is the stored key: the id of the shape's first mark", () => {
        expect(recipeShapeKey(recipe(1, 8))).toBe(1);
        expect(recipeShapeKey(recipe(7, 16, 1))).toBe(1);
    });
});
