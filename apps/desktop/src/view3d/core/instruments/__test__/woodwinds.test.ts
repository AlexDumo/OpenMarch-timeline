// apps/desktop/src/view3d/core/instruments/__test__/woodwinds.test.ts
import { describe, expect, it } from "vitest";
import { bounds, triangleCount } from "../mesh";
import { WOODWIND_DIMENSIONS, woodwindModel } from "../woodwinds";
import type { WoodwindModelId } from "../model";

const IDS: WoodwindModelId[] = [
    "piccolo",
    "flute",
    "clarinet",
    "bassClarinet",
    "sopranoSax",
    "altoSax",
    "tenorSax",
    "bariSax",
];

describe("woodwind models", () => {
    it.each(IDS)("%s stays within the triangle budgets", (id) => {
        const high = triangleCount(woodwindModel(id, "high").pieces);
        const low = triangleCount(woodwindModel(id, "low").pieces);
        expect(high).toBeGreaterThanOrEqual(4000);
        expect(high).toBeLessThanOrEqual(12000);
        expect(low).toBeGreaterThanOrEqual(1000);
        expect(low).toBeLessThanOrEqual(3500);
    });

    it.each(IDS)("%s runs along +Z from the mouthpiece at the origin", (id) => {
        const m = woodwindModel(id);
        expect(m.mouthpiece).toEqual([0, 0, 0]);
        const b = bounds(m.pieces);
        expect(b.min[2]).toBeGreaterThan(-0.08); // nothing behind the lips but the mouthpiece
        expect(
            Math.abs(b.max[2] - WOODWIND_DIMENSIONS[id].length),
        ).toBeLessThan(0.08);
    });

    it("gives the flute and piccolo chrome bodies and the saxes lacquered ones", () => {
        const parts = (id: WoodwindModelId) =>
            new Set(woodwindModel(id).pieces.map((p) => p.part));
        expect(parts("flute").has(16)).toBe(false);
        expect(parts("flute").has(18)).toBe(true);
        expect(parts("altoSax").has(16)).toBe(true);
        expect(parts("clarinet").has(22)).toBe(true); // the black body
    });

    it("turns the sax bells back up past the bow", () => {
        for (const id of ["altoSax", "tenorSax", "bariSax"] as const) {
            const m = woodwindModel(id);
            // the widest ring is the bell rim and it sits well above the bow (smaller z than the max)
            const widest = m.pieces.reduce(
                (best, p) => {
                    const b = bounds([p]);
                    return b.max[0] - b.min[0] > best.w
                        ? {
                              w: b.max[0] - b.min[0],
                              z: (b.max[2] + b.min[2]) / 2,
                          }
                        : best;
                },
                { w: 0, z: 0 },
            );
            expect(widest.w).toBeCloseTo(WOODWIND_DIMENSIONS[id].bell, 1);
            expect(widest.z).toBeLessThan(bounds(m.pieces).max[2] - 0.15);
        }
    });

    it("colors every vertex and uses only instrument part ids", () => {
        for (const id of IDS)
            for (const p of woodwindModel(id, "high").pieces) {
                expect([16, 18, 22, 23]).toContain(p.part);
                expect(p.colors?.length).toBe(p.positions.length);
            }
    });
});
