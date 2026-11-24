import { describe, expect, it } from "vitest";
import {
    loopPoint,
    makeLoop,
    nearestOnLoop,
    outlineCorners,
    validateRouteGeometry,
    type XY,
} from "@openmarch/core";
import {
    twoArcs,
    bulgeLeaving,
    loopAlong,
    loopThrough,
    ringOrder,
} from "../closedOutline";
import {
    closedOutlineOf,
    fitOutline,
    goRoundPreview,
    lineRound,
    loopOutline,
    planGoRound,
    walkingOutline,
} from "../timelineTrailAround";
import { ringTrailOrder } from "../timelineTrailDrag";
import { lineTool } from "@/shapes/line/lineTool";
import { linePath, SMOOTH, type LineParams } from "@/shapes/line/lineGeometry";

/**
 * Any closed outline as a closed route (fork #1213): the smooth loop through the marchers, and a
 * placed shape's own outline, stored as corners and arc legs (no file-format change).
 */

/** `n` round an oval of semi-axes `a`, `b` about (0, 0), evenly by angle, clockwise on the field */
const oval = (n: number, a: number, b: number): XY[] =>
    Array.from({ length: n }, (_, i) => {
        const t = (2 * Math.PI * i) / n;
        return [a * Math.cos(t), b * Math.sin(t)];
    });
/** A bean: an oval pushed in on one side, so the curve bends both ways */
const bean = (n: number): XY[] =>
    Array.from({ length: n }, (_, i) => {
        const t = (2 * Math.PI * i) / n;
        const r = 10 + 3 * Math.cos(2 * t) - 2 * Math.cos(t);
        return [r * Math.cos(t), 0.8 * r * Math.sin(t)];
    });
const off = (loop: NonNullable<ReturnType<typeof makeLoop>>, p: XY) => {
    const on = loopPoint(loop, nearestOnLoop(loop, p));
    return Math.hypot(on[0] - p[0], on[1] - p[1]);
};

describe("closed outlines as arcs (fork #1213)", () => {
    it("bulgeLeaving: the arc leaves along the direction given, either side", () => {
        // a quarter circle from (1, 0) to (0, 1) about the origin leaves straight up the y axis
        const k = bulgeLeaving([1, 0], [0, 1], [0, 1])!;
        expect(Math.abs(k)).toBeCloseTo(Math.tan(Math.PI / 8) / 2, 9);
        const loop = makeLoop({
            closed: true,
            from: [1, 0],
            to: [1, 0],
            points: [{ at: [0, 1], bulge: k }],
            toBulge: k,
        })!;
        // every point of that leg is on the unit circle (the leg back is another arc)
        for (let d = 0; d <= Math.PI / 2; d += Math.PI / 40)
            expect(Math.hypot(...loopPoint(loop, d))).toBeCloseTo(1, 9);
        // straight on is no arc; back on itself can't be one
        expect(bulgeLeaving([0, 0], [4, 0], [1, 0])).toBe(0);
        expect(bulgeLeaving([0, 0], [4, 0], [-1, 0])).toBeNull();
    });

    it("twoArcs: two arcs through both ends, each the way it's asked to run", () => {
        const legs = twoArcs([0, 0], [1, 0], [10, 4], [0, 1]);
        expect(legs).toHaveLength(2);
        expect(legs[1]!.at).toEqual([10, 4]);
        expect(legs.every((l) => !!l.bulge)).toBe(true);
    });

    it("the smooth loop through marchers on an oval: a valid closed route, through every marcher, with no corners, clockwise", () => {
        const pts = oval(12, 14, 7);
        const g = loopThrough(pts)!;
        expect(validateRouteGeometry(g).ok).toBe(true);
        expect(g.closed).toBe(true);
        expect(g.points.some((p) => "tension" in p)).toBe(false);
        const loop = makeLoop(g)!;
        for (const p of pts) expect(off(loop, p)).toBeLessThan(1e-6);
        // a curve all the way: no corner anywhere
        expect(outlineCorners(loop)).toEqual([]);
        // near the true oval between marchers (within a quarter of a step of an oval 28 by 14)
        for (let d = 0; d < loop.L; d += loop.L / 200) {
            const [x, y] = loopPoint(loop, d);
            expect(Math.abs(Math.hypot(x / 14, y / 7) - 1)).toBeLessThan(0.03);
        }
        // walked the given way round (clockwise on the field): the second marcher comes next
        expect(nearestOnLoop(loop, pts[1]!)).toBeLessThan(
            nearestOnLoop(loop, pts[2]!),
        );
        // given the other way round, it's stored the same way round
        const back = makeLoop(loopThrough([...pts].reverse())!)!;
        expect(back.L).toBeCloseTo(loop.L, 6);
    });

    it("a curve that bends both ways (a bean) is followed too", () => {
        const pts = bean(16);
        const loop = makeLoop(loopThrough(pts)!)!;
        for (const p of pts) expect(off(loop, p)).toBeLessThan(1e-6);
        expect(outlineCorners(loop)).toEqual([]);
    });

    it("a shape's own outline: curves become arcs on the drawn curve, sharp turns stay corners", () => {
        // an oval drawn as 96 short stretches
        const drawn = oval(96, 14, 7);
        const g = loopAlong(drawn)!;
        expect(validateRouteGeometry(g).ok).toBe(true);
        const loop = makeLoop(g)!;
        expect(g.points.length).toBeLessThan(80);
        for (const p of drawn) expect(off(loop, p)).toBeLessThan(0.02);
        expect(outlineCorners(loop)).toEqual([]);
        // a triangle keeps its three corners and straight sides
        const tri = loopAlong([
            [0, 0],
            [12, 0],
            [6, 9],
        ])!;
        expect(tri.points.every((p) => !p.bulge)).toBe(true);
        expect(outlineCorners(makeLoop(tri)!)).toHaveLength(3);
        // a D: a straight side and a half circle, corners only where they meet
        const half: XY[] = Array.from({ length: 49 }, (_, i) => {
            const t = -Math.PI / 2 + (Math.PI * i) / 48;
            return [8 * Math.cos(t), 8 * Math.sin(t)];
        });
        const d = makeLoop(loopAlong(half)!)!;
        expect(outlineCorners(d)).toHaveLength(2);
        for (const p of half) expect(off(d, p)).toBeLessThan(0.02);
    });

    it("ringOrder: marchers standing in a closed loop, in order round it; not an open curve or a block", () => {
        const pts = bean(16);
        // shuffled, so the order isn't the given one
        const shuffled = pts
            .map((p, i) => ({ p, i }))
            .sort((a, b) => ((a.i * 7) % 16) - ((b.i * 7) % 16));
        const ring = ringOrder(shuffled.map((s) => s.p))!;
        const round = ring.map((k) => shuffled[k]!.i);
        round.forEach((i, k) => {
            const next = round[(k + 1) % 16]!;
            expect([1, 15]).toContain((next - i + 16) % 16);
        });
        // three quarters of it: open
        expect(ringOrder(pts.slice(0, 12))).toBeNull();
        // a block of four by four
        const block: XY[] = Array.from({ length: 16 }, (_, i) => [
            (i % 4) * 2,
            Math.floor(i / 4) * 2,
        ]);
        expect(ringOrder(block)).toBeNull();
    });

    it("closedOutlineOf: a circle and a box as before, then the shape's outline, then the loop through the marchers", () => {
        const circle = oval(12, 10, 10);
        expect(closedOutlineOf(circle, 1)!.kind).toBe("circle");
        expect(fitOutline(oval(12, 14, 7), 1)).toBeNull();
        // marchers on an oval: the loop through them
        const marchers = oval(12, 14, 7);
        const through = closedOutlineOf(marchers, 1)!;
        expect(through.kind).toBe("loop");
        expect(through.full).toBe(true);
        // with the placed oval's own outline, that one: the true oval between marchers
        const drawn = oval(96, 14, 7);
        const own = closedOutlineOf(marchers, 1, [drawn])!;
        expect(own.kind).toBe("loop");
        expect(own.geometry.points.length).toBeGreaterThan(
            through.geometry.points.length,
        );
        // an open curve stays open
        expect(closedOutlineOf(bean(16).slice(0, 12), 1)).toBeNull();
    });

    it("going round the loop: each marcher onto the next one's spot, on the curve at every moment", () => {
        const marchers = bean(16);
        const outline = closedOutlineOf(marchers, 1)!;
        const plan = planGoRound(marchers, outline, {
            reversed: false,
            amount: 2,
            unit: "spots",
            step: 1,
        });
        // by spots: everyone ends on a marcher's start
        for (const spot of plan.spots)
            expect(
                Math.min(
                    ...marchers.map((m) =>
                        Math.hypot(m[0] - spot[0], m[1] - spot[1]),
                    ),
                ),
            ).toBeLessThan(1e-6);
        // and between spots they're on the outline, not cutting across it
        for (const p of [0.13, 0.37, 0.5, 0.81])
            for (const at of goRoundPreview(plan, p))
                expect(off(outline.loop, at)).toBeLessThan(1e-6);
    });
});

/**
 * Review of fork #1215 (2026-11-23). Each of these failed before its fix.
 */
describe("a loop is read from where the marchers stand, not from their id order (review, HIGH)", () => {
    /** A seeded random number from 0 to 1 */
    const seeded = (seed: number) => () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
    };
    const shuffled = <T>(a: readonly T[], rnd: () => number): T[] =>
        a
            .map((x) => [rnd(), x] as const)
            .sort((p, q) => p[0] - q[0])
            .map(([, x]) => x);
    const permutations = <T>(a: T[]): T[][] =>
        a.length <= 1
            ? [a]
            : a.flatMap((x, i) =>
                  permutations([...a.slice(0, i), ...a.slice(i + 1)]).map(
                      (rest) => [x, ...rest],
                  ),
              );
    /** Whether Follow would go around: a closed loop fitted through the marchers */
    const loops = (pts: readonly XY[]) =>
        closedOutlineOf(pts, 1)?.kind === "loop";
    /** The ring as sets of neighbors, by place, so two id orders can be compared */
    const ringOf = (pts: readonly XY[]): string | null => {
        const ring = ringOrder(pts);
        if (!ring) return null;
        const key = (i: number) => `${pts[i]![0]},${pts[i]![1]}`;
        return ring
            .map((i, k) =>
                [key(i), key(ring[(k + 1) % ring.length]!)].sort().join("|"),
            )
            .sort()
            .join(" ");
    };

    it("the reviewer's line of four, lowest id second, is no loop", () => {
        const starts: XY[] = [
            [2, 0],
            [0, 0],
            [4, 0],
            [6, 0],
        ];
        expect(ringOrder(starts)).toBeNull();
        expect(closedOutlineOf(starts, 1)).toBeNull();
    });

    it("straight lines, even or uneven, in every id order: never a loop", () => {
        for (const xs of [
            [0, 2, 4, 6],
            [0, 2, 4, 6, 8],
            [0, 1, 3, 4, 6],
            [0, 2, 3, 5, 6, 8],
        ])
            for (const order of permutations(xs)) {
                const pts = order.map((x): XY => [x, 0]);
                expect(ringOrder(pts), `${order}`).toBeNull();
                expect(loops(pts), `${order}`).toBe(false);
            }
        // a slanted line and a gently bowed one, in random id orders
        const rnd = seeded(11);
        const slanted: XY[] = Array.from({ length: 7 }, (_, i) => [
            3 * i,
            1.3 * i,
        ]);
        const bowed: XY[] = Array.from({ length: 6 }, (_, i) => {
            const t = -0.6 + 0.24 * i;
            return [20 * Math.sin(t), 20 - 20 * Math.cos(t)];
        });
        for (let t = 0; t < 200; t++) {
            expect(ringOrder(shuffled(slanted, rnd))).toBeNull();
            expect(loops(shuffled(bowed, rnd))).toBe(false);
        }
    });

    it("blocks, on their grid or a little off it, in random id orders: never a loop", () => {
        const rnd = seeded(7);
        for (const [w, h] of [
            [3, 3],
            [3, 4],
            [4, 4],
            [4, 5],
            [5, 6],
        ] as const) {
            const grid: XY[] = Array.from({ length: w * h }, (_, i) => [
                (i % w) * 2,
                Math.floor(i / w) * 2,
            ]);
            for (let t = 0; t < 300; t++) {
                expect(loops(shuffled(grid, rnd)), `${w}x${h}`).toBe(false);
                expect(ringOrder(shuffled(grid, rnd)), `${w}x${h}`).toBeNull();
            }
        }
        // the 3 by 3 block with every choice of first and second marcher (the reviewer's 47 of 72)
        const block: XY[] = Array.from({ length: 9 }, (_, i) => [
            (i % 3) * 2,
            Math.floor(i / 3) * 2,
        ]);
        for (let f = 0; f < 9; f++)
            for (let g = 0; g < 9; g++) {
                if (g === f) continue;
                const order = [
                    f,
                    g,
                    ...block.map((_, i) => i).filter((i) => i !== f && i !== g),
                ];
                expect(ringOrder(order.map((i) => block[i]!))).toBeNull();
            }
    });

    it("scattered marchers: the answer never depends on id order, and a scatter is rarely a loop", () => {
        const rnd = seeded(7);
        let taken = 0;
        const runs = 1500;
        for (let t = 0; t < runs; t++) {
            const n = 4 + Math.floor(rnd() * 8);
            const pts: XY[] = Array.from({ length: n }, () => [
                rnd() * 20,
                rnd() * 20,
            ]);
            const ring = ringOf(pts);
            // the same answer, and the same ring, whatever order they come in
            for (let k = 0; k < 4; k++)
                expect(ringOf(shuffled(pts, rnd))).toBe(ring);
            if (!ring) continue;
            taken++;
            // one that is taken really is a ring: each marcher's nearest stands beside it
            const order = ringOrder(pts)!;
            order.forEach((i, k) => {
                const d = (j: number) =>
                    Math.hypot(
                        pts[i]![0] - pts[j]![0],
                        pts[i]![1] - pts[j]![1],
                    );
                const nearest = Math.min(
                    ...pts.map((_, j) => (j === i ? Infinity : d(j))),
                );
                const beside = Math.min(
                    d(order[(k + 1) % n]!),
                    d(order[(k + n - 1) % n]!),
                );
                expect(beside).toBeCloseTo(nearest, 9);
            });
        }
        // Before the fix two in five scatters opened going around. A few still stand in a real
        // ring (five marchers that happen to make a tidy pentagon): under one in twenty
        expect(taken / runs).toBeLessThan(0.05);
    });

    it("real loops are still loops, in any id order, placed by hand a step off or not", () => {
        const rnd = seeded(3);
        for (const pts of [
            oval(12, 14, 7),
            bean(16),
            bean(12),
            oval(8, 9, 6),
        ]) {
            const ring = ringOf(pts);
            expect(ring).not.toBeNull();
            for (let k = 0; k < 20; k++) {
                const mixed = shuffled(pts, rnd);
                expect(ringOf(mixed)).toBe(ring);
                expect(loops(mixed)).toBe(true);
            }
        }
        // twelve and sixteen round a bean, each up to a step off its place: nearly always found
        for (const n of [12, 16]) {
            let found = 0;
            for (let t = 0; t < 200; t++) {
                const pts = bean(n).map(
                    ([x, y]): XY => [
                        x + (rnd() - 0.5) * 2,
                        y + (rnd() - 0.5) * 2,
                    ],
                );
                if (ringOrder(shuffled(pts, rnd))) found++;
            }
            expect(found, `${n}`).toBeGreaterThanOrEqual(190);
        }
    });
});

describe("a leader pulled out of a narrow placed shape is written round the outline shown (review, MEDIUM)", () => {
    /** `n` round an oval, evenly by angle, none on its long axis */
    const narrow = (n: number, a: number, b: number): XY[] =>
        Array.from({ length: n }, (_, i) => {
            const t = (2 * Math.PI * (i + 0.5)) / n;
            return [a * Math.cos(t), b * Math.sin(t)];
        });

    it("the reviewer's narrow ovals: the ring is read round the placed outline, which their places alone don't give back", () => {
        for (const [a, b, n] of [
            [10, 1.2, 14],
            [10, 1.5, 16],
            [12, 2, 20],
            [8, 1, 12],
        ] as const) {
            const starts = narrow(n, a, b);
            const drawn = oval(128, a, b);
            // the tool goes around the placed oval
            const placed = closedOutlineOf(starts, 1, [drawn])!;
            expect(placed.kind, `${a}x${b}`).toBe("loop");
            // their places alone make no ring: the two sides are nearer each other than the
            // marchers along them
            expect(ringOrder(starts), `${a}x${b}`).toBeNull();
            for (const reversed of [false, true]) {
                const leader = 2;
                const line = lineRound(
                    walkingOutline(placed, reversed).loop,
                    starts,
                    leader,
                );
                // without the outline shown the write can't find the ring (what refused the trail)
                expect(ringTrailOrder(starts, line, leader, 1)).toBeNull();
                // with it, the line the tool shows is the one written
                expect(
                    ringTrailOrder(
                        starts,
                        line,
                        leader,
                        1,
                        null,
                        placed.geometry,
                    ),
                    `${a}x${b}`,
                ).toEqual(line);
            }
            // an outline they don't stand on is no help
            expect(
                ringTrailOrder(
                    starts,
                    lineRound(placed.loop, starts, 2),
                    2,
                    1,
                    null,
                    loopAlong(oval(64, a + 6, b + 6))!,
                ),
            ).toBeNull();
        }
    });
});

describe("a drawn outline's straight sides stay straight (review, MEDIUM)", () => {
    /** How far `p` is from the closed run of points `drawn` */
    const offDrawn = (drawn: readonly XY[], p: XY) =>
        Math.min(
            ...drawn.map((a, i) => {
                const b = drawn[(i + 1) % drawn.length]!;
                const dx = b[0] - a[0];
                const dy = b[1] - a[1];
                const f = Math.max(
                    0,
                    Math.min(
                        1,
                        ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) /
                            (dx * dx + dy * dy || 1),
                    ),
                );
                return Math.hypot(a[0] + f * dx - p[0], a[1] + f * dy - p[1]);
            }),
        );
    /** A stadium: two straight sides of `length`, `2·r` apart, joined by half circles */
    const stadium = (length: number, r: number, along: number, arc: number) => {
        const drawn: XY[] = [];
        for (let x = 0; x <= length + 1e-9; x += along) drawn.push([x, 0]);
        for (let a = -Math.PI / 2 + arc; a < Math.PI / 2 - 1e-9; a += arc)
            drawn.push([length + r * Math.cos(a), r + r * Math.sin(a)]);
        for (let x = length; x >= -1e-9; x -= along) drawn.push([x, 2 * r]);
        for (let a = Math.PI / 2 + arc; a < 1.5 * Math.PI - 1e-9; a += arc)
            drawn.push([r * Math.cos(a), r + r * Math.sin(a)]);
        return drawn;
    };
    /** The farthest the loop strays from the drawn outline, and the outline from the loop */
    const strays = (drawn: readonly XY[]) => {
        const g = loopAlong(drawn)!;
        expect(validateRouteGeometry(g).ok).toBe(true);
        const loop = makeLoop(g)!;
        let out = 0;
        for (let d = 0; d < loop.L; d += loop.L / 600)
            out = Math.max(out, offDrawn(drawn, loopPoint(loop, d)));
        const back = Math.max(...drawn.map((p) => off(loop, p)));
        return { out, back, loop, g };
    };

    it("stadiums of every roundness: the sides aren't bowed (they were 0.37 to 0.45 off)", () => {
        for (const r of [0.75, 1.5, 3, 5, 8])
            // the sides drawn as one stretch each, or through points along them
            for (const along of [10, 0.5]) {
                const drawn = stadium(10, r, along, 0.2);
                const { out, back, loop } = strays(drawn);
                // within a sliver of the drawn outline (the half circles are drawn as chords
                // 0.2 radians long, so the arcs sit that much outside them)
                expect(out, `r=${r} along=${along}`).toBeLessThan(
                    0.006 * r + 0.01,
                );
                expect(back, `r=${r} along=${along}`).toBeLessThan(
                    0.006 * r + 0.01,
                );
                // and exactly on the straight sides
                for (let x = 0.5; x < 10; x += 0.5) {
                    expect(off(loop, [x, 0])).toBeLessThan(1e-9);
                    expect(off(loop, [x, 2 * r])).toBeLessThan(1e-9);
                }
                // the sides meet the half circles without a corner
                expect(outlineCorners(loop)).toEqual([]);
            }
    });

    it("a real Line tool shape, two straight sides closed by curves: followed as drawn", () => {
        // a stadium as the Line tool draws it: corners at the sides' ends, a smooth point on
        // each cap
        const params: LineParams = {
            points: [
                { x: 0, y: 0, tension: 0 },
                { x: 100, y: 0, tension: 0 },
                { x: 118, y: 18, tension: SMOOTH },
                { x: 100, y: 36, tension: 0 },
                { x: 0, y: 36, tension: 0 },
                { x: -18, y: 18, tension: SMOOTH },
            ],
            closed: true,
            spacing: { mode: "fit" },
        };
        const drawn = lineTool.outline!(params, 16).map(
            ({ x, y }): XY => [x, y],
        );
        // the outline gives a straight side by its ends alone
        expect(drawn.filter(([x, y]) => y === 0 && x > 0 && x < 100)).toEqual(
            [],
        );
        const { out, back, loop, g } = strays(drawn);
        expect(out).toBeLessThan(0.05);
        expect(back).toBeLessThan(0.05);
        // on the path itself, finer than it is drawn, and dead on the straight sides
        const path = linePath(params);
        for (const q of path.polyline(path.length / 400))
            expect(off(loop, [q.x, q.y])).toBeLessThan(0.05);
        for (let x = 5; x < 100; x += 5) {
            expect(off(loop, [x, 0])).toBeLessThan(1e-9);
            expect(off(loop, [x, 36])).toBeLessThan(1e-9);
        }
        // and marchers the tool would place round it are on the loop
        const marchers = path
            .polyline(path.length / 16)
            .slice(0, 16)
            .map((q): XY => [q.x, q.y]);
        const outline = loopOutline(g, marchers, 11.25)!;
        expect(outline.kind).toBe("loop");
        expect(outline.residual).toBeLessThan(0.05);
    });
});
