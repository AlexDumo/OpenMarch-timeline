import { describe, expect, it } from "vitest";
import { walksCross } from "../../geometry/segments";
import { leastTravel } from "../../leastTravel";
import type { XY } from "../../types";
import { ORDER_PICTURES, ORDER_SAMPLE, ORDER_SPOTS } from "../orderPictures";

/**
 * Who goes where's pictures (#559, #568): the three answers read differently, and each picture's
 * moves follow the rule its answer names
 */

const { from, to } = ORDER_SAMPLE;
const walks = (spots: readonly number[]) =>
    from.map((p, i) => ({ from: p, to: to[spots[i]!]! }));
const travel = (spots: readonly number[]) =>
    walks(spots).reduce(
        (sum, w) => sum + Math.hypot(w.to.x - w.from.x, w.to.y - w.from.y),
        0,
    );
const crossings = (spots: readonly number[]) => {
    const all = walks(spots);
    let n = 0;
    for (let i = 0; i < all.length; i++)
        for (let j = i + 1; j < all.length; j++)
            if (walksCross(all[i]!, all[j]!)) n++;
    return n;
};
const same = (a: readonly number[], b: readonly number[]) =>
    a.every((v, i) => v === b[i]);
/** A spot's shade: the old-line place of the marcher who lands on it */
const landed = (key: keyof typeof ORDER_PICTURES) =>
    ORDER_PICTURES[key].shades!.dots;

describe("who goes where's pictures", () => {
    it("are three different pictures, with three different moves", () => {
        const { nearest, keep, reverse } = ORDER_SPOTS;
        expect(same(nearest, keep)).toBe(false);
        expect(same(nearest, reverse)).toBe(false);
        expect(same(keep, reverse)).toBe(false);
        const drawn = Object.values(ORDER_PICTURES).map((p) =>
            JSON.stringify(p),
        );
        expect(new Set(drawn).size).toBe(3);
    });

    it("Least travel: the solver's answer, the shortest walks, none crossing", () => {
        expect(ORDER_SPOTS.nearest).toEqual(leastTravel(from, to));
        expect(crossings(ORDER_SPOTS.nearest)).toBe(0);
        expect(travel(ORDER_SPOTS.nearest)).toBeLessThan(
            travel(ORDER_SPOTS.keep),
        );
        expect(travel(ORDER_SPOTS.nearest)).toBeLessThan(
            travel(ORDER_SPOTS.reverse),
        );
        // The ramp lands mixed: neither in order nor flipped
        const shades = landed("nearest");
        const sorted = [...shades].sort((a, b) => a - b);
        expect(shades).not.toEqual(sorted);
        expect(shades).not.toEqual([...sorted].reverse());
    });

    it("Keep order: first to first, last to last, the ramp in order along the new line", () => {
        expect(ORDER_SPOTS.keep).toEqual(from.map((_, i) => i));
        const shades = landed("keep");
        expect(shades).toEqual([...shades].sort((a, b) => a - b));
    });

    it("Reverse: first to last, the ramp flipped along the new line", () => {
        expect(ORDER_SPOTS.reverse).toEqual(
            from.map((_, i) => from.length - 1 - i),
        );
        const shades = landed("reverse");
        expect(shades).toEqual([...shades].sort((a, b) => b - a));
    });

    it("shades the old line in its order, first an empty ring to last a solid dot", () => {
        for (const picture of Object.values(ORDER_PICTURES)) {
            const old = picture.shades!.faintDots;
            expect(old).toHaveLength(from.length);
            expect(old[0]).toBe(0);
            expect(old[old.length - 1]).toBe(1);
            expect(old).toEqual([...old].sort((a, b) => a - b));
            expect(picture.dots as readonly XY[]).toEqual(to);
        }
    });
});
