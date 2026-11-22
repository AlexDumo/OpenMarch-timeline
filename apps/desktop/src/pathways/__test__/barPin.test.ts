import { describe, expect, it } from "vitest";
import { barCovers, nextPin, placedKey } from "../barPin";
import type { PathSession } from "../pathPenStore";

/**
 * The drawing bar keeps clear of the trail (#1102): pinned while drawing, it moves once a placed
 * point runs the drawing under it, never for the pointer alone
 */

const SIZE = { width: 200, height: 40 };
const PIN = { left: 100, top: 300, key: "a" };
const PLACE = { left: 100, top: 500 };

describe("the drawing bar's pin (#1102)", () => {
    it("barCovers: a point under the bar or just at its edge, not one clear of it", () => {
        expect(barCovers(PIN, 200, 40, [{ x: 150, y: 320 }])).toBe(true);
        expect(barCovers(PIN, 200, 40, [{ x: 97, y: 298 }])).toBe(true);
        expect(barCovers(PIN, 200, 40, [{ x: 150, y: 260 }])).toBe(false);
        expect(barCovers(PIN, 200, 40, [{ x: 320, y: 320 }])).toBe(false);
    });

    it("the same placed points keep the pin, even with the drawing under it (the pointer's leg on its way to Finish)", () => {
        expect(nextPin(PIN, "a", PLACE, SIZE, [{ x: 150, y: 320 }])).toBe(PIN);
    });

    it("a new point that runs the drawing under the bar moves it to where it goes now", () => {
        expect(nextPin(PIN, "b", PLACE, SIZE, [{ x: 150, y: 320 }])).toEqual({
            ...PLACE,
            key: "b",
        });
    });

    it("a new point clear of the bar keeps it where it is", () => {
        expect(nextPin(PIN, "b", PLACE, SIZE, [{ x: 150, y: 100 }])).toEqual({
            ...PIN,
            key: "b",
        });
    });

    it("placedKey changes when a point is added or moved", () => {
        const of = (points: { x: number; y: number }[]) =>
            placedKey({
                points: points.map((at, i) => ({ id: `${i}`, at })),
            } as unknown as PathSession);
        const one = of([{ x: 1, y: 2 }]);
        expect(of([{ x: 1, y: 2 }])).toBe(one);
        expect(of([{ x: 1, y: 3 }])).not.toBe(one);
        expect(
            of([
                { x: 1, y: 2 },
                { x: 4, y: 5 },
            ]),
        ).not.toBe(one);
    });
});
