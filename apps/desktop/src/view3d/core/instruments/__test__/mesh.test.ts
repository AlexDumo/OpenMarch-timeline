import { describe, expect, it } from "vitest";
import {
    bounds,
    cylinder,
    lathe,
    triangleCount,
    tube,
    PART_METAL,
} from "../mesh";

describe("lathe", () => {
    it("revolves a profile into a closed, bounded shape", () => {
        // a cone with a flat base: radius 0 at the tip, 0.1 at the base
        const p = lathe(
            [
                [0, 0.2],
                [0.1, 0],
                [0, 0],
            ],
            12,
            PART_METAL,
        );
        expect(triangleCount([p])).toBe(12 + 12); // side fan from the tip + base fan
        const b = bounds([p]);
        expect(b.min[1]).toBeCloseTo(0, 9);
        expect(b.max[1]).toBeCloseTo(0.2, 9);
        expect(b.max[0]).toBeCloseTo(0.1, 9);
        expect(p.positions.length).toBe(p.normals.length);
        expect(p.part).toBe(PART_METAL);
    });

    it("writes unit normals", () => {
        const p = lathe(
            [
                [0.05, 0],
                [0.05, 0.3],
            ],
            8,
            PART_METAL,
        );
        for (let i = 0; i < p.normals.length; i += 3)
            expect(
                Math.hypot(p.normals[i], p.normals[i + 1], p.normals[i + 2]),
            ).toBeCloseTo(1, 6);
    });
});

describe("tube", () => {
    it("sweeps a circle along a bent path with caps", () => {
        const p = tube(
            [
                [0, 0, 0],
                [0, 0, 0.3],
                [0.1, 0, 0.3],
            ],
            0.01,
            8,
            PART_METAL,
        );
        // two segments × 8 quads × 2 + two caps × 8
        expect(triangleCount([p])).toBe(2 * 8 * 2 + 2 * 8);
        const b = bounds([p]);
        expect(b.max[2]).toBeCloseTo(0.31, 2);
        expect(b.max[0]).toBeCloseTo(0.1, 2);
    });

    it("keeps the ring radius through a bend (no pinching)", () => {
        const p = tube(
            [
                [0, 0, 0],
                [0, 0, 0.2],
                [0.2, 0, 0.2],
            ],
            0.02,
            8,
            PART_METAL,
        );
        // the corner ring: every vertex near the corner keeps at least the
        // radius and at most radius / cos(45°) from it (faces own their vertices,
        // so find them by distance rather than by index)
        const near: number[] = [];
        for (let k = 0; k < p.positions.length / 3; k++) {
            const d = Math.hypot(
                p.positions[k * 3] - 0,
                p.positions[k * 3 + 1],
                p.positions[k * 3 + 2] - 0.2,
            );
            if (d < 0.05) near.push(d);
        }
        expect(near.length).toBeGreaterThan(0);
        for (const d of near) {
            expect(d).toBeLessThanOrEqual(0.02 / Math.cos(Math.PI / 4) + 1e-6);
            expect(d).toBeGreaterThanOrEqual(0.02 - 1e-6);
        }
    });
});

describe("cylinder", () => {
    it("runs from one point to another", () => {
        // 8 segments sample 90°, so the ring reaches the full radius on x
        const p = cylinder(0.02, [0, 0, 0], [0, 0.1, 0], 8, PART_METAL);
        const b = bounds([p]);
        expect(b.min[1]).toBeCloseTo(0, 9);
        expect(b.max[1]).toBeCloseTo(0.1, 9);
        expect(b.max[0]).toBeCloseTo(0.02, 6);
    });
});
