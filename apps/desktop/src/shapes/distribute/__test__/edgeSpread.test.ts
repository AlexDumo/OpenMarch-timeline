import { describe, expect, it } from "vitest";
import { distribute, edgeSplit, spreadScale } from "../distribute";
import {
    reshuffled,
    savedDistributionOf,
    spreadDistribution,
    storedDistribution,
    type SpreadDistribution,
} from "../distribution";
import { circleRegion, rectRegion, type Region } from "../region";
import type { XY } from "../../types";

/**
 * Spread with an edge (#450): marchers evenly along the outline, as many as it holds one interval
 * apart (a spot on every corner of a box), the rest an even spread inside, at least one interval
 * in, no pair closer than the interval. The edge doesn't follow the seed: Reshuffle reshuffles
 * the inside only.
 */

const INTERVAL = 20;
const edged = (seed: number, n: number): SpreadDistribution =>
    spreadDistribution(seed, n, true);
/** The spots' places (a spread's row is its seed, so they're left out) */
const spots = (region: Region, n: number, d: SpreadDistribution) =>
    distribute({
        region,
        n,
        distribution: d,
        across: INTERVAL,
        deep: INTERVAL,
    }).map(({ x, y }) => ({ x, y }));

const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const closest = (ps: readonly XY[]) =>
    Math.min(...ps.flatMap((p, i) => ps.slice(i + 1).map((q) => dist(p, q))));

const REGIONS: Record<string, Region> = {
    "a 3:2 box": rectRegion(3, 2),
    "a square box": rectRegion(1, 1),
    "a 4:1 box": rectRegion(4, 1),
    "a circle": circleRegion(1),
};
const COUNTS = [8, 12, 16, 24, 36, 48, 72, 100];

/** How far `p` is inside the frame of `region` at `scale` (field units), on its edge at 0 */
function depthIn(region: Region, scale: number, p: XY): number {
    const b = region.bounds;
    if (region.key.startsWith("circle"))
        return b.right * scale - Math.hypot(p.x, p.y);
    return Math.min(
        b.right * scale - Math.abs(p.x),
        b.bottom * scale - Math.abs(p.y),
    );
}

describe.each(Object.entries(REGIONS))(
    "Spread with an edge in %s",
    (_, region) => {
        it.each(COUNTS)(
            "stands %i: the edge on the outline, the rest inside, no pair under the interval",
            (n) => {
                const d = edged(1, n);
                const all = spots(region, n, d);
                expect(all).toHaveLength(n);
                const scale = spreadScale(region, n, d, INTERVAL);
                const { edge, inside } = edgeSplit(region, n);
                expect(edge + inside).toBe(n);
                const onEdge = all.slice(0, edge);
                const within = all.slice(edge);
                for (const p of onEdge)
                    expect(Math.abs(depthIn(region, scale, p))).toBeLessThan(
                        1e-6,
                    );
                // Inside at least one interval in
                for (const p of within)
                    expect(depthIn(region, scale, p)).toBeGreaterThanOrEqual(
                        INTERVAL * (1 - 1e-6),
                    );
                expect(closest(all)).toBeGreaterThanOrEqual(
                    INTERVAL * (1 - 1e-6),
                );
                // With an inside, the edge's spots stand about one interval apart along it, under
                // 1½ to the next (with none inside, they spread round the whole edge)
                const ring = [...onEdge, onEdge[0]!];
                if (inside > 0)
                    for (let i = 0; i + 1 < ring.length; i++)
                        expect(dist(ring[i]!, ring[i + 1]!)).toBeLessThan(
                            1.5 * INTERVAL,
                        );
            },
        );

        it("puts a spot on every corner of a box", () => {
            if (!region.key.startsWith("rect")) return;
            for (const n of [24, 48]) {
                const d = edged(1, n);
                const scale = spreadScale(region, n, d, INTERVAL);
                const w = region.bounds.right * scale;
                const h = region.bounds.bottom * scale;
                const all = spots(region, n, d);
                for (const c of [
                    { x: -w, y: -h },
                    { x: w, y: -h },
                    { x: w, y: h },
                    { x: -w, y: h },
                ])
                    expect(
                        Math.min(...all.map((p) => dist(p, c))),
                    ).toBeLessThan(1e-6);
            }
        });

        it("is the same each time, and Reshuffle moves the inside only", () => {
            const n = 36;
            const d = edged(4, n);
            expect(spots(region, n, d)).toEqual(spots(region, n, d));
            const next = reshuffled(d, n);
            expect(next.edge).toBe(true);
            const { edge } = edgeSplit(region, n);
            const a = spots(region, n, d);
            const b = spots(region, n, next);
            expect(b.slice(0, edge)).toEqual(a.slice(0, edge));
            expect(b.slice(edge)).not.toEqual(a.slice(edge));
            // The same size for every seed: Reshuffle keeps the frame
            expect(spreadScale(region, n, next, 1)).toBe(
                spreadScale(region, n, d, 1),
            );
        });
    },
);

describe("Spread with an edge, too few for an inside", () => {
    it("stands everyone on the edge, still no closer than the interval", () => {
        for (const region of Object.values(REGIONS))
            for (const n of [3, 4, 6]) {
                const { inside } = edgeSplit(region, n);
                expect(inside).toBe(0);
                const all = spots(region, n, edged(1, n));
                expect(all).toHaveLength(n);
                expect(closest(all)).toBeGreaterThanOrEqual(
                    INTERVAL * (1 - 1e-6),
                );
            }
    });
});

describe("Spread with an edge, as stored", () => {
    it("is `edge: true`, absent when off, and kept by a saved shape", () => {
        expect(spreadDistribution(1, 10)).not.toHaveProperty("edge");
        const d = edged(3, 10);
        expect(
            storedDistribution(
                JSON.parse(JSON.stringify({ distribution: d })),
                1,
            ),
        ).toEqual(d);
        expect(
            storedDistribution({ distribution: { ...d, edge: "yes" } }, 1),
        ).not.toHaveProperty("edge");
        expect(savedDistributionOf(d)).toEqual({
            mode: "spread",
            generator: d.generator,
            edge: true,
        });
    });

    it("leaves a plain spread as it was", () => {
        for (const region of Object.values(REGIONS)) {
            const plain = spreadDistribution(2, 30);
            expect(spots(region, 30, plain)).toEqual(
                spots(region, 30, { ...plain }),
            );
            expect(spreadScale(region, 30, plain, 1)).not.toBe(
                spreadScale(region, 30, edged(2, 30), 1),
            );
        }
    });
});
