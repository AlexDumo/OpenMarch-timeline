// apps/desktop/src/view3d/core/instruments/__test__/guard.test.ts
// cspell:words tris
import { describe, expect, it } from "vitest";
import {
    bounds,
    triangleCount,
    PART_BLACK,
    PART_SILK,
    PART_CHROME,
    PART_WOOD,
} from "../mesh";
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

    it("hangs the rifle's sling from its swivel tips", () => {
        // the sling is the rifle's only black piece
        const sling = guardModel("rifle").pieces.filter(
            (p) => p.part === PART_BLACK,
        );
        expect(sling.length).toBe(1);
        const ringY = (z: number) => {
            const ys: number[] = [];
            const pos = sling[0].positions;
            for (let i = 0; i < pos.length; i += 3)
                if (Math.abs(pos[i + 2] - z) < 0.01) ys.push(pos[i + 1]);
            expect(ys.length).toBeGreaterThan(0);
            return ys.reduce((a, b) => a + b, 0) / ys.length;
        };
        // front swivel tip at (y -0.035, z 0.45), back at (y -0.095, z -0.22)
        expect(Math.abs(ringY(0.45) - -0.035)).toBeLessThan(0.004);
        expect(Math.abs(ringY(-0.22) - -0.095)).toBeLessThan(0.004);
    });

    it("hangs the back swivel from the stock's underside, not inside it", () => {
        const m = guardModel("rifle");
        // the stock: the white body behind the grip
        const stock = m.pieces.filter(
            (p) => p.part === PART_WOOD && bounds([p]).min[2] < -0.25,
        );
        expect(stock.length).toBe(1);
        // the stock's lowest point on its ring at z -0.2, just ahead of the
        // swivel at -0.22 (the underside drops toward the butt from there)
        let underside = 0;
        const sp = stock[0].positions;
        for (let i = 0; i < sp.length; i += 3)
            if (Math.abs(sp[i + 2] - -0.2) < 0.005)
                underside = Math.min(underside, sp[i + 1]);
        expect(underside).toBeLessThan(-0.07);
        const swivel = m.pieces.filter((p) => {
            const b = bounds([p]);
            return (
                p.part === PART_CHROME && b.min[2] > -0.24 && b.max[2] < -0.2
            );
        });
        expect(swivel.length).toBe(1);
        const b = bounds(swivel);
        // it starts just inside the wood and hangs below it
        expect(b.max[1]).toBeLessThan(underside + 0.008);
        expect(b.min[1]).toBeLessThan(underside - 0.01);
    });

    it("colors every vertex", () => {
        for (const id of IDS)
            for (const p of guardModel(id).pieces)
                expect(p.colors?.length).toBe(p.positions.length);
    });
});
