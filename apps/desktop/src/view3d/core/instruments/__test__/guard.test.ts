// apps/desktop/src/view3d/core/instruments/__test__/guard.test.ts
// cspell:words tris
import { describe, expect, it } from "vitest";
import { bounds, triangleCount, PART_SILK, PART_CHROME } from "../mesh";
import { guardModel } from "../guard";
import type { GuardModelId } from "../model";

const IDS: GuardModelId[] = [
    "flag6",
    "swingFlag",
    "doubleSwingFlag",
    "rifle",
    "sabre",
];

describe("guard equipment", () => {
    it.each(IDS)("%s stays within the triangle budgets", (id) => {
        expect(
            triangleCount(guardModel(id, "high").pieces),
        ).toBeLessThanOrEqual(12000);
        expect(
            triangleCount(guardModel(id, "high").pieces),
        ).toBeGreaterThanOrEqual(1000);
        expect(triangleCount(guardModel(id, "low").pieces)).toBeLessThanOrEqual(
            3500,
        );
    });

    it("makes a 6 ft flag: pole along +Z with a silk at the top", () => {
        const m = guardModel("flag6");
        const pole = m.pieces.filter((p) => p.part === PART_CHROME);
        const b = bounds(pole);
        expect(b.max[2] - b.min[2]).toBeCloseTo(1.83, 1);
        const silk = m.pieces.filter((p) => p.part === PART_SILK);
        expect(silk.length).toBeGreaterThan(0);
        const s = bounds(silk);
        expect(s.max[2]).toBeGreaterThan(1.1);
        expect(s.max[0] - s.min[0]).toBeCloseTo(1.37, 1);
        // a real surface, not a line: many triangles with normals mostly along +Y
        const tris = triangleCount(silk);
        expect(tris).toBeGreaterThan(20);
        let up = 0;
        for (const p of silk)
            for (let i = 1; i < p.normals.length; i += 3)
                if (p.normals[i] > 0.5) up++;
        expect(up).toBeGreaterThan(0);
    });

    it("gives the double swing flag a second flag in the left hand", () => {
        const m = guardModel("doubleSwingFlag");
        const left = m.pieces.filter((p) => p.bone === "handL");
        expect(left.some((p) => p.part === PART_SILK)).toBe(true);
        expect(
            m.pieces.filter((p) => p.part === PART_SILK && !p.bone).length,
        ).toBeGreaterThan(0);
    });

    it("makes the rifle and sabre run along +Z from the grip", () => {
        const r = bounds(guardModel("rifle").pieces);
        expect(r.max[2] - r.min[2]).toBeCloseTo(0.91, 1);
        expect(r.min[2]).toBeLessThan(0);
        const s = bounds(guardModel("sabre").pieces);
        expect(s.max[2]).toBeGreaterThan(0.7);
        expect(s.min[2]).toBeLessThan(0);
    });

    it("colors every vertex", () => {
        for (const id of IDS)
            for (const p of guardModel(id).pieces)
                expect(p.colors?.length).toBe(p.positions.length);
    });
});
