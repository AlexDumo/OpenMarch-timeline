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
    planGoRound,
} from "../timelineTrailAround";

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
