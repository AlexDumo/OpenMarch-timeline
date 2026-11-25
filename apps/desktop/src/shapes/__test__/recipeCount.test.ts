// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
    ORDER_CLEAR_RECIPE_KIND,
    ORDER_RECIPE_KIND,
    UNGROUPED_RECIPE_KIND,
} from "@/db-functions/shapeRecipes";
import {
    recipeCount,
    recipeMoveEnd,
    recipeMoveIds,
    recipesAtCount,
    recipeShapeKey,
    sameCount,
    type CountedRecipe,
} from "../placed/recipeCount";

// Moves 10, 20 and 30 end at beats 8, 16 and 24; move 40 is gone
const ends = new Map<number, number>([
    [10, 8],
    [20, 16],
    [30, 24],
]);
const moveEndOf = (id: number) => ends.get(id);

const shape = (
    id: number,
    timelineId: number | null,
    kind = "box",
): CountedRecipe => ({ id, timelineId, kind, params: { spots: 4 } });

const mark = (
    id: number,
    timelineId: number | null,
    beat?: number,
    kind = ORDER_RECIPE_KIND,
): CountedRecipe => ({
    id,
    timelineId,
    kind,
    params: beat === undefined ? { spots: 3 } : { spots: 3, beat },
});

describe("a recipe's count", () => {
    it("is its move's end for a shape placed on a page", () => {
        expect(recipeCount(shape(1, 10), moveEndOf)).toBe(8);
        expect(recipeCount(shape(2, 20, "line"), moveEndOf)).toBe(16);
    });

    it("is its move's end for an ungrouped mark", () => {
        expect(
            recipeCount(shape(1, 30, UNGROUPED_RECIPE_KIND), moveEndOf),
        ).toBe(24);
    });

    it("is beat 0 for the starting spots (no move)", () => {
        expect(recipeCount(shape(1, null), moveEndOf)).toBe(0);
        expect(recipeMoveEnd(shape(1, null), moveEndOf)).toBe(0);
    });

    it("is an order mark's own beat, wherever it's stored", () => {
        expect(recipeCount(mark(1, null, 12.5), moveEndOf)).toBe(12.5);
        // A line standing still on a page is in the move before
        expect(recipeCount(mark(2, 10, 16), moveEndOf)).toBe(16);
        expect(
            recipeCount(mark(3, null, 4, ORDER_CLEAR_RECIPE_KIND), moveEndOf),
        ).toBe(4);
    });

    it("is an order mark's move's end when it has no beat of its own (saved before marks kept one)", () => {
        expect(recipeCount(mark(1, 20), moveEndOf)).toBe(16);
        expect(recipeCount(mark(2, null), moveEndOf)).toBe(0);
        // A beat that isn't a number is no beat
        expect(
            recipeCount(
                {
                    ...mark(3, 30),
                    params: { spots: 3, beat: "12" },
                },
                moveEndOf,
            ),
        ).toBe(24);
    });

    it("is undefined when its move is gone, order marks with a beat of their own too", () => {
        expect(recipeCount(shape(1, 40), moveEndOf)).toBeUndefined();
        expect(recipeCount(mark(2, 40), moveEndOf)).toBeUndefined();
        expect(recipeCount(mark(3, 40, 12), moveEndOf)).toBeUndefined();
        expect(recipeMoveEnd(shape(1, 40), moveEndOf)).toBeUndefined();
    });

    it("of an order mark is still its move's end where only the move is asked (`recipeMoveEnd`)", () => {
        expect(recipeMoveEnd(mark(1, 10, 12), moveEndOf)).toBe(8);
    });
});

describe("a recipe's shape key", () => {
    it("is its own id until marks of one shape share a key", () => {
        expect(recipeShapeKey(shape(7, 10))).toBe(7);
        expect(recipeShapeKey(mark(9, null, 3))).toBe(9);
    });
});

describe("the recipes at a count", () => {
    const recipes = [
        shape(1, 10),
        shape(2, 20),
        shape(3, null),
        mark(4, null, 8),
        mark(5, 10),
        mark(6, 20, 8.5),
        shape(7, 40),
        shape(8, 10, UNGROUPED_RECIPE_KIND),
    ];

    it("lists those standing there, in their order", () => {
        expect(recipesAtCount(recipes, 8, moveEndOf).map((r) => r.id)).toEqual([
            1, 4, 5, 8,
        ]);
        expect(recipesAtCount(recipes, 16, moveEndOf).map((r) => r.id)).toEqual(
            [2],
        );
        expect(recipesAtCount(recipes, 0, moveEndOf).map((r) => r.id)).toEqual([
            3,
        ]);
        expect(
            recipesAtCount(recipes, 8.5, moveEndOf).map((r) => r.id),
        ).toEqual([6]);
    });

    it("leaves out a recipe whose move is gone, and counts nobody stands at", () => {
        expect(recipesAtCount(recipes, 24, moveEndOf)).toEqual([]);
        expect(recipesAtCount([shape(7, 40)], 0, moveEndOf)).toEqual([]);
    });

    it("compares counts as stored, within rounding", () => {
        expect(sameCount(8, 8 + 1e-12)).toBe(true);
        expect(sameCount(8, 8.001)).toBe(false);
        expect(
            recipesAtCount([mark(1, null, 0.1 + 0.2)], 0.3, moveEndOf).map(
                (r) => r.id,
            ),
        ).toEqual([1]);
    });
});

describe("the moves recipes are stored in", () => {
    it("are those of recipes in a move, the starting spots left out", () => {
        expect(
            recipeMoveIds([shape(1, 10), shape(2, null), mark(3, 20, 4)]),
        ).toEqual([10, 20]);
    });
});
