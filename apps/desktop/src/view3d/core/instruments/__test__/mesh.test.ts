import { describe, expect, it } from "vitest";
import {
    arc,
    bellProfile,
    bounds,
    colorPieces,
    cylinder,
    lathe,
    smoothLathe,
    smoothTube,
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

describe("smooth primitives", () => {
    it("smoothTube shares ring vertices and writes radial unit normals", () => {
        const p = smoothTube(
            [
                [0, 0, 0],
                [0, 0, 0.2],
                [0, 0, 0.4],
            ],
            0.01,
            16,
            PART_METAL,
        );
        // 3 rings × 16 + 2 cap centers
        expect(p.positions.length / 3).toBe(3 * 16 + 2);
        // 2 strips × 16 quads × 2 + 2 caps × 16
        expect(triangleCount([p])).toBe(2 * 16 * 2 + 2 * 16);
        for (let i = 0; i < 3 * 16; i++) {
            const n = [
                p.normals[i * 3],
                p.normals[i * 3 + 1],
                p.normals[i * 3 + 2],
            ];
            expect(Math.hypot(...n)).toBeCloseTo(1, 6);
            expect(Math.abs(n[2])).toBeLessThan(1e-6); // perpendicular to the +Z axis
        }
    });

    it("smoothTube takes a radius per path point for a conical bore", () => {
        const p = smoothTube(
            [
                [0, 0, 0],
                [0, 0, 1],
            ],
            [0.01, 0.05],
            8,
            PART_METAL,
            { capStart: false, capEnd: false },
        );
        expect(p.positions.length / 3).toBe(16);
        const b = bounds([p]);
        expect(b.max[0]).toBeCloseTo(0.05, 6);
        expect(b.max[1]).toBeCloseTo(0.05, 6);
    });

    it("smoothLathe writes outward normals on a cylinder", () => {
        const p = smoothLathe(
            [
                [0.05, 0],
                [0.05, 0.3],
            ],
            12,
            PART_METAL,
        );
        for (let i = 0; i < p.positions.length / 3; i++) {
            const x = p.positions[i * 3];
            const z = p.positions[i * 3 + 2];
            const nx = p.normals[i * 3];
            const nz = p.normals[i * 3 + 2];
            if (Math.hypot(x, z) > 1e-6)
                expect(nx * x + nz * z).toBeGreaterThan(0);
        }
    });

    it("arc runs a quarter circle about an axis", () => {
        const pts = arc([0, 0, 0], 1, 0, 90, 4, "x");
        expect(pts.length).toBe(5);
        expect(pts[0][1]).toBeCloseTo(1, 9); // starts at +Y
        expect(pts[4][2]).toBeCloseTo(1, 9); // ends at +Z
        for (const q of pts) expect(Math.hypot(q[1], q[2])).toBeCloseTo(1, 9);
    });

    it("bellProfile flares monotonically to the rim", () => {
        const prof = bellProfile(0.01, 0.1, 0.3, 14);
        expect(prof[0][0]).toBeCloseTo(0.01, 9);
        // the flare itself ends at the length; the rim bead follows it
        expect(prof[14][1]).toBeCloseTo(0.3, 9);
        expect(prof[14][0]).toBeCloseTo(0.1, 9);
        let r = 0;
        for (const [ri] of prof.slice(0, 15)) {
            expect(ri).toBeGreaterThanOrEqual(r - 1e-9);
            r = ri;
        }
        expect(prof.length).toBeGreaterThan(15);
    });

    it("colorPieces writes one color per vertex", () => {
        const p = cylinder(0.01, [0, 0, 0], [0, 0.1, 0], 6, PART_METAL);
        const [c] = colorPieces([p], (part) =>
            part === PART_METAL ? 0xd9ad4f : 0,
        );
        expect(c.colors!.length).toBe(p.positions.length);
        // linear, as three's vertex colors are: sRGB 0xd9 -> 0.694
        expect(c.colors![0]).toBeCloseTo(
            ((0xd9 / 255 + 0.055) / 1.055) ** 2.4,
            9,
        );
    });
});
