import { describe, expect, it } from "vitest";
import {
    editorPlacement,
    FLIP_MARGIN_PX,
    GAP_PX,
    type PlacementInput,
} from "../editorPlacement";

/** Where the floating editor goes, Glide and Steady (#437) */

/** A 100 × 60 box centered at (cx, cy), turned by `degrees` */
const box = (cx: number, cy: number, degrees = 0) => {
    const a = (degrees * Math.PI) / 180;
    return [
        [-50, -30],
        [50, -30],
        [50, 30],
        [-50, 30],
    ].map(([x, y]) => ({
        x: cx + x * Math.cos(a) - y * Math.sin(a),
        y: cy + x * Math.sin(a) + y * Math.cos(a),
    }));
};

const input = (over: Partial<PlacementInput> = {}): PlacementInput => ({
    motion: "glide",
    outline: box(400, 200),
    center: { x: 400, y: 200 },
    width: 300,
    height: 40,
    fieldWidth: 1000,
    fieldHeight: 600,
    wasAbove: false,
    ...over,
});

describe("Glide", () => {
    it("sits under the outline, centered", () => {
        const p = editorPlacement(input());
        expect(p.above).toBe(false);
        expect(p.left).toBe(400 - 150);
        expect(p.top).toBeGreaterThan(230 + GAP_PX);
    });

    it("goes above with no room below, and follows the outline as it turns", () => {
        expect(editorPlacement(input({ outline: box(400, 540) })).above).toBe(
            true,
        );
        const still = editorPlacement(input());
        const turned = editorPlacement(input({ outline: box(400, 200, 30) }));
        expect(turned.top).not.toBe(still.top);
    });
});

describe("Steady", () => {
    const steady = (over: Partial<PlacementInput> = {}) =>
        input({ motion: "steady", ...over });

    it("doesn't move as the shape turns about its center", () => {
        const still = editorPlacement(steady());
        for (const degrees of [15, 45, 90, 170])
            expect(
                editorPlacement(steady({ outline: box(400, 200, degrees) })),
            ).toEqual(still);
    });

    it("flips above only with clearly no room below, and back only with clear room", () => {
        // The circle round the box reaches 200 + 58 + 20 below its center
        const atBottom = (cy: number, wasAbove: boolean) =>
            editorPlacement(
                steady({
                    outline: box(400, cy),
                    center: { x: 400, y: cy },
                    wasAbove,
                }),
            ).above;
        const bottomOf = (cy: number) =>
            cy + Math.hypot(50, 30) + GAP_PX + 6 + 40;
        // Just past the edge: stays below
        const justOver = 600 - bottomOf(0) + FLIP_MARGIN_PX / 2;
        expect(atBottom(justOver, false)).toBe(false);
        // Clearly past it: above, and it stays above until there's clear room again
        const wellOver = 600 - bottomOf(0) + FLIP_MARGIN_PX * 2;
        expect(atBottom(wellOver, false)).toBe(true);
        expect(atBottom(justOver, true)).toBe(true);
        const roomy = 600 - bottomOf(0) - FLIP_MARGIN_PX * 2;
        expect(atBottom(roomy, true)).toBe(false);
    });
});
