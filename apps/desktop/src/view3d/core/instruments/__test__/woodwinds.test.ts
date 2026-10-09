// apps/desktop/src/view3d/core/instruments/__test__/woodwinds.test.ts
import { describe, expect, it } from "vitest";
import { bounds, triangleCount, PART_CHROME } from "../mesh";
import { SAX_SHAPES, WOODWIND_DIMENSIONS, woodwindModel } from "../woodwinds";
import { hold } from "../holds";
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

describe("woodwind key work and placement", () => {
    it("keeps the alto's rods and posts outside its conical body", () => {
        const m = woodwindModel("altoSax");
        const sh = SAX_SHAPES.altoSax;
        // the body runs from its top (12 cm above the left hand's grip) to the bow, on the axis y = yb
        const [, yb, grip] = m.leftGrip;
        const top = grip - 0.12;
        const bowZ =
            WOODWIND_DIMENSIONS.altoSax.length - sh.bowWidth / 2 - sh.rBow;
        const rAt = (z: number) =>
            sh.rTop + ((sh.rBow - sh.rTop) * (z - top)) / (bowZ - top);
        let checked = 0;
        for (const p of m.pieces) {
            if (p.part !== PART_CHROME) continue;
            const b = bounds([p]);
            // the rods and their posts: chrome pieces along the body, below the octave key
            if (b.min[2] < top + 0.045 || b.max[2] > bowZ - 0.02) continue;
            for (let i = 0; i < p.positions.length; i += 3) {
                const [x, y, z] = [
                    p.positions[i],
                    p.positions[i + 1],
                    p.positions[i + 2],
                ];
                expect(Math.hypot(x, y - yb)).toBeGreaterThanOrEqual(rAt(z));
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(100);
    });

    it("hangs the bari's body as far in front of the chest as the alto's under the sax hold", () => {
        const h = hold("sax", "up");
        const zAxis = h.instrument.bellAxis;
        const len = Math.hypot(...zAxis);
        const z = zAxis.map((v) => v / len);
        const c = h.instrument.capsAxis;
        const d = c[0] * z[0] + c[1] * z[1] + c[2] * z[2];
        const y = c.map((v, i) => v - d * z[i]);
        const yl = Math.hypot(...y);
        // world forward (body +Z) of the body's front at its top
        const front = (id: "altoSax" | "bariSax") => {
            const [, yb, grip] = woodwindModel(id).leftGrip;
            const top = grip - 0.12;
            return (
                h.instrument.origin[2] +
                (yb * y[2]) / yl +
                top * z[2] -
                SAX_SHAPES[id].rTop
            );
        };
        // the chest's front is at z 0.12
        expect(front("altoSax")).toBeGreaterThan(0.15);
        expect(front("bariSax")).toBeGreaterThan(0.15);
        expect(Math.abs(front("bariSax") - front("altoSax"))).toBeLessThan(
            0.02,
        );
    });
});
