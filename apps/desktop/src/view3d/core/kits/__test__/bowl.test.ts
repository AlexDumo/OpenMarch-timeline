// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
    bandGeometry,
    bowlOutline,
    bowlTiers,
    ringLength,
    sectioned,
    outlineOffset,
    RING_POINTS,
    type BowlOutlineOptions,
} from "../bowl";

const options: BowlOutlineOptions = {
    centerX: 0,
    centerZ: -24.385,
    halfX: 62.5,
    halfZ: 32,
    cornerRadius: 21.3,
};

describe("bowlOutline", () => {
    it("returns closed rings of a fixed size at the given offset", () => {
        const ring = bowlOutline(options);
        for (const d of [0, 5, 40]) {
            const pts = ring(d, 3);
            expect(pts).toHaveLength(RING_POINTS);
            for (const p of pts) {
                expect(p.y).toBe(3);
                expect(outlineOffset(options, p.x, p.z)).toBeCloseTo(d, 6);
            }
            // No repeated closing point.
            expect(pts[0].distanceTo(pts[pts.length - 1])).toBeGreaterThan(0);
        }
    });

    it("clamps the corner radius for a small footprint", () => {
        const ring = bowlOutline({ ...options, halfZ: 5, cornerRadius: 21.3 });
        const pts = ring(2, 0);
        for (const p of pts) {
            expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
            expect(Math.abs(p.z - options.centerZ)).toBeLessThanOrEqual(7.0001);
        }
    });
});

describe("outlineOffset", () => {
    it("is negative inside the bowl floor and positive in the stands", () => {
        expect(outlineOffset(options, 0, options.centerZ)).toBeCloseTo(-32);
        expect(outlineOffset(options, 0, options.centerZ + 40)).toBeCloseTo(8);
        expect(outlineOffset(options, 70, options.centerZ)).toBeCloseTo(7.5);
    });
});

describe("bowlTiers and bandGeometry", () => {
    it("builds one closed seat row per tread, rising row by row", () => {
        const tiers = bowlTiers(bowlOutline(options), [
            { offset: 0, rows: 4, depth: 1, rise: 0.5, base: 1, bottom: 0 },
            {
                offset: 6,
                rows: 3,
                depth: 1,
                rise: 0.5,
                base: 6,
                bottom: 5,
                fascia: true,
                side: "home",
            },
        ]);
        expect(tiers.treads).toHaveLength(7);
        expect(tiers.seatRows).toHaveLength(7);
        expect(tiers.fascia).toHaveLength(1);
        // 6 regular risers, 2 back walls and 1 soffit.
        expect(tiers.risers).toHaveLength(9);
        // The back walls are also listed on their own, as the same objects.
        expect(tiers.backWalls).toHaveLength(2);
        tiers.backWalls.forEach((w) => expect(tiers.risers).toContain(w));
        expect(tiers.tiers[0]).toMatchObject({ back: 4, top: 2.5 });
        expect(tiers.tiers[1]).toMatchObject({ back: 9, top: 7 });
        tiers.seatRows.forEach((row) => {
            expect(row.closed).toBe(true);
            expect(row.points).toHaveLength(RING_POINTS);
        });
        expect(tiers.seatRows[0].side).toBe("neutral");
        expect(tiers.seatRows[6].side).toBe("home");

        const geo = bandGeometry(tiers.treads);
        const pos = geo.getAttribute("position");
        expect(pos.count).toBe(7 * RING_POINTS * 6);
        for (let i = 0; i < pos.array.length; i++)
            expect(Number.isNaN(pos.array[i])).toBe(false);
        const normals = geo.getAttribute("normal");
        // Treads are flat: every normal is vertical.
        for (let i = 0; i < normals.count; i++)
            expect(Math.abs(normals.getY(i))).toBeCloseTo(1, 5);
        geo.dispose();
    });
});

describe("sectioned", () => {
    it("sets each pair's tile to its ring length over the section count", () => {
        const ring = bowlOutline(options);
        const pairs = sectioned(
            [
                { a: ring(0, 0), b: ring(0, 1) },
                { a: ring(10, 0), b: ring(10, 1) },
            ],
            20,
        );
        expect(pairs[0].tile).toBeCloseTo(ringLength(pairs[0].a) / 20, 9);
        // Outer rings are longer, so their sections are wider.
        expect(pairs[1].tile!).toBeGreaterThan(pairs[0].tile!);
        // One tile of U per section: the last quad ends at exactly 20.
        const geo = bandGeometry(pairs.slice(0, 1));
        const uv = geo.getAttribute("uv");
        let maxU = 0;
        for (let i = 0; i < uv.count; i++) maxU = Math.max(maxU, uv.getX(i));
        expect(maxU).toBeCloseTo(20, 6);
        geo.dispose();
    });
});
