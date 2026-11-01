import { describe, expect, it } from "vitest";
import { walksCross } from "../../geometry/segments";
import { leastTravel } from "../../leastTravel";
import type { XY } from "../../types";
import { ORDER_PICTURES, ORDER_SAMPLE, ORDER_SPOTS } from "../orderPictures";

/**
 * Who goes where's pictures (#559, #568): the three answers read differently, each picture's
 * moves follow the rule its answer names, and the old line's first marcher, the one each picture
 * picks out, lands on a different spot in each
 */

const { from, to } = ORDER_SAMPLE;
const last = from.length - 1;
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
/** The closest a walk passes to a marcher other than its own */
const clearance = (spots: readonly number[]) => {
    let min = Infinity;
    for (const w of walks(spots))
        for (const p of [...from, ...to]) {
            if (p === w.from || p === w.to) continue;
            const dx = w.to.x - w.from.x;
            const dy = w.to.y - w.from.y;
            const t = Math.max(
                0,
                Math.min(
                    1,
                    ((p.x - w.from.x) * dx + (p.y - w.from.y) * dy) /
                        (dx * dx + dy * dy),
                ),
            );
            min = Math.min(
                min,
                Math.hypot(p.x - w.from.x - t * dx, p.y - w.from.y - t * dy),
            );
        }
    return min;
};
/** Where a picture's solid marcher lands, as a spot index */
const landsOn = (key: keyof typeof ORDER_PICTURES) =>
    ORDER_PICTURES[key].marked!.dot;

describe("who goes where's pictures", () => {
    it("show at least four marchers", () => {
        expect(from.length).toBeGreaterThanOrEqual(4);
        expect(to).toHaveLength(from.length);
    });

    it("are three different pictures, the solid marcher landing on three different spots", () => {
        const { nearest, keep, reverse } = ORDER_SPOTS;
        expect(nearest).not.toEqual(keep);
        expect(nearest).not.toEqual(reverse);
        expect(keep).not.toEqual(reverse);
        expect(
            new Set(Object.values(ORDER_PICTURES).map((p) => JSON.stringify(p)))
                .size,
        ).toBe(3);
        expect(
            new Set([landsOn("nearest"), landsOn("keep"), landsOn("reverse")])
                .size,
        ).toBe(3);
    });

    it("pick out the old line's first marcher, solid where it starts and where it lands", () => {
        for (const [key, picture] of Object.entries(ORDER_PICTURES)) {
            expect(picture.marked!.faintDot).toBe(0);
            expect(picture.marked!.dot).toBe(
                ORDER_SPOTS[key as keyof typeof ORDER_SPOTS][0],
            );
            expect(picture.faintDots as readonly XY[]).toEqual(from);
            expect(picture.dots as readonly XY[]).toEqual(to);
        }
    });

    it("draw the old line faintly through its marchers in order", () => {
        for (const picture of Object.values(ORDER_PICTURES))
            expect(
                picture.lines.some(
                    (line) =>
                        line.faint &&
                        !line.dashed &&
                        JSON.stringify(line.points) === JSON.stringify(from),
                ),
            ).toBe(true);
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
        // The solid marcher lands on neither end
        expect(landsOn("nearest")).not.toBe(0);
        expect(landsOn("nearest")).not.toBe(last);
    });

    it("Keep order: first to first and on in order, no walks crossing", () => {
        expect(ORDER_SPOTS.keep).toEqual(from.map((_, i) => i));
        expect(landsOn("keep")).toBe(0);
        expect(crossings(ORDER_SPOTS.keep)).toBe(0);
    });

    it("Reverse: first to last, flipped, its walks crossing", () => {
        expect(ORDER_SPOTS.reverse).toEqual(from.map((_, i) => last - i));
        expect(landsOn("reverse")).toBe(last);
        expect(crossings(ORDER_SPOTS.reverse)).toBeGreaterThan(0);
    });

    it("keep walks clear of the other marchers", () => {
        // A fifth of the spots' spacing
        const room = (to[1]!.x - to[0]!.x) / 5;
        for (const spots of Object.values(ORDER_SPOTS))
            expect(clearance(spots)).toBeGreaterThan(room);
    });
});
