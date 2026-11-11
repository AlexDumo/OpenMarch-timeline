import { describe, expect, it } from "vitest";
import {
    ORDER_GAP_PX,
    ORDER_MIN_WIDTH,
    bowedLeg,
    crossedMarchers,
    legPoint,
    legTangent,
    numberSide,
    orderLegs,
    orderLineSizes,
    orderWidthBetween,
    overlapsEarlier,
    ringArcs,
    trimClearOf,
    trimLeg,
    type Box,
    type OrderLeg,
    type OrderObstacles,
} from "../orderLineGeometry";
import type { XY } from "../orderSweep";

const straight = (from: XY, to: XY): OrderLeg => ({ from, to, control: null });
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);

describe("the order line's sizes", () => {
    it("is the dot's diameter at the leader and a third of it at the tail", () => {
        const sizes = orderLineSizes(6, 9.5);
        expect(sizes.leader).toBe(12);
        expect(sizes.tail).toBe(4);
        expect(orderWidthBetween(0, sizes)).toBe(12);
        expect(orderWidthBetween(1, sizes)).toBe(4);
        expect(orderWidthBetween(0.5, sizes)).toBe(8);
    });

    it("counts its halo in the dot's width", () => {
        expect(orderLineSizes(6, 9.5, 1).leader).toBe(10);
    });

    it("keeps a minimum on screen zoomed far out", () => {
        const sizes = orderLineSizes(0.5, 2);
        expect(sizes.leader).toBe(ORDER_MIN_WIDTH.leader);
        expect(sizes.tail).toBe(ORDER_MIN_WIDTH.tail);
    });

    it("stops a pixel or two past the dot's selection ring", () => {
        expect(orderLineSizes(6, 9.5).gap).toBe(9.5 + ORDER_GAP_PX);
    });
});

describe("trimming a leg clear of its marchers", () => {
    it("shortens a straight leg at both ends", () => {
        const leg = straight({ x: 0, y: 0 }, { x: 100, y: 0 });
        const trim = trimLeg(leg, 10, 20)!;
        expect(legPoint(leg, trim.t0).x).toBeCloseTo(10);
        expect(legPoint(leg, trim.t1).x).toBeCloseTo(80);
    });

    it("leaves nothing of a leg shorter than its gaps", () => {
        expect(
            trimLeg(straight({ x: 0, y: 0 }, { x: 15, y: 0 }), 8, 8),
        ).toBeNull();
    });

    it("runs right up to an end with no gap (Set order's pointer)", () => {
        const leg = straight({ x: 0, y: 0 }, { x: 100, y: 0 });
        expect(trimLeg(leg, 10, 0)!.t1).toBe(1);
    });

    it("measures the gap along an arc", () => {
        const leg = bowedLeg({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
        const trim = trimLeg(leg, 10, 10)!;
        expect(dist(legPoint(leg, trim.t0), leg.from)).toBeCloseTo(10, 0);
        expect(dist(legPoint(leg, trim.t1), leg.to)).toBeCloseTo(10, 0);
    });
});

describe("a leg that runs back over the line", () => {
    // A straight row, 20 px apart: x of marcher n is 20n
    const at = (n: number): XY => ({ x: 20 * n, y: 100 });

    it("is not an overlap when legs only meet end to end in a row", () => {
        expect(
            overlapsEarlier(
                straight(at(4), at(5)),
                [straight(at(3), at(4))],
                3,
            ),
        ).toBe(false);
        // Nor when a leg carries on in line past an earlier one's end
        expect(
            overlapsEarlier(
                straight(at(5), at(6)),
                [straight(at(3), at(5))],
                3,
            ),
        ).toBe(false);
    });

    it("keeps straight lines straight when nothing overlaps", () => {
        const legs = orderLegs([at(1), at(2), at(3), at(4)], 3);
        expect(legs.every((l) => l.control === null)).toBe(true);
        // A zigzag across two rows too
        const zig = orderLegs(
            [at(1), { x: 30, y: 60 }, at(2), { x: 50, y: 60 }, at(3)],
            3,
        );
        expect(zig.every((l) => l.control === null)).toBe(true);
    });

    it("bows legs that double back (clicks 3, 5, 6, 4, 2), alternating sides", () => {
        const legs = orderLegs([at(3), at(5), at(6), at(4), at(2)], 3);
        expect(legs[0]!.control).toBeNull();
        expect(legs[1]!.control).toBeNull();
        const back = legs[2]!;
        const again = legs[3]!;
        expect(back.control).not.toBeNull();
        expect(again.control).not.toBeNull();
        // Each bows to a different side of the row
        const side = (l: OrderLeg) => Math.sign(legPoint(l, 0.5).y - 100);
        expect(side(back)).not.toBe(0);
        expect(side(again)).toBe(-side(back));
        // Neither runs over the line any more, the arcs included
        expect(overlapsEarlier(back, legs.slice(0, 2), 3)).toBe(false);
        expect(overlapsEarlier(again, legs.slice(0, 3), 3)).toBe(false);
    });

    it("bows gently: still meets its marchers, a fraction of its length out", () => {
        const [, , back] = orderLegs([at(3), at(5), at(6), at(4)], 3);
        expect(legPoint(back!, 0)).toEqual(at(6));
        expect(legPoint(back!, 1)).toEqual(at(4));
        const out = Math.abs(legPoint(back!, 0.5).y - 100);
        expect(out).toBeGreaterThan(3);
        expect(out).toBeLessThanOrEqual(0.45 * 40);
    });

    it("finds a leg that runs over an earlier arc", () => {
        const arc = bowedLeg(at(0), at(4), 20);
        const over = straight(legPoint(arc, 0.3), legPoint(arc, 0.6));
        expect(overlapsEarlier(over, [arc], 3)).toBe(true);
    });

    it("points the arrow along the arc's tangent at the tail", () => {
        const legs = orderLegs([at(3), at(5), at(6), at(4)], 3);
        const way = legTangent(legs.at(-1)!, 1)!;
        // Heading left along the row, but slanting back in from the bow
        expect(way.x).toBeLessThan(0);
        expect(Math.abs(way.y)).toBeGreaterThan(0.1);
    });
});

describe("where a position number sits", () => {
    const right = { x: 1, y: 0 };
    const left = { x: -1, y: 0 };
    const down = { x: 0, y: 1 };

    it("sits below the dot when labels sit above", () => {
        expect(numberSide("above", [right, left])).toEqual({ x: 0, y: 1 });
    });

    it("sits left of the dot when labels sit beside (on the right)", () => {
        expect(numberSide("beside", [down])).toEqual({ x: -1, y: 0 });
    });

    it("moves off a leg that leaves straight down", () => {
        const side = numberSide("above", [down, right]);
        // Off both legs, and still not up where the label is
        expect(side.y).toBeGreaterThanOrEqual(0);
        expect(side.x).toBeLessThan(0);
    });

    it("never goes to the label's side while another side is clear", () => {
        const side = numberSide("above", [down, left, right]);
        expect(side.y).toBeGreaterThanOrEqual(0);
    });
});

describe("a leg that passes over a marcher it doesn't end at", () => {
    // A straight row, 40 px apart, marchers 1 to 7, with the line's sizes at a middling zoom
    const at = (n: number): XY => ({ x: 40 * n, y: 100 });
    const sizes = orderLineSizes(6, 9.5, 1);
    const obstacles: OrderObstacles = {
        at: [1, 2, 3, 4, 5, 6, 7].map(at),
        clearance: sizes.gap + sizes.leader / 2 + 1,
        endGap: sizes.gap,
    };
    const tolerance = sizes.leader / 2 + 1;
    /** How far the line's edge passes from `q`, along the whole leg */
    const edgeFrom = (leg: OrderLeg, q: XY) => {
        let best = Infinity;
        for (let i = 0; i <= 200; i++)
            best = Math.min(best, dist(legPoint(leg, i / 200), q));
        return best - sizes.leader / 2;
    };

    it("bows round it (clicks 3, 5, 6, 4, 2): 3 to 5 clears 4's dot by the gap", () => {
        const legs = orderLegs(
            [at(3), at(5), at(6), at(4), at(2)],
            tolerance,
            obstacles,
        );
        expect(legs[0]!.control).not.toBeNull();
        expect(edgeFrom(legs[0]!, at(4))).toBeGreaterThanOrEqual(sizes.gap);
        // 5 to 6 are neighbors: nothing in the way
        expect(legs[1]!.control).toBeNull();
        // No leg covers a marcher it doesn't end at
        for (const leg of legs)
            expect(crossedMarchers(leg, obstacles)).toEqual([]);
    });

    it("bows round it the other way too (clicks 2, 4, 6, 5, 3): 2 to 4 clears 3", () => {
        const legs = orderLegs(
            [at(2), at(4), at(6), at(5), at(3)],
            tolerance,
            obstacles,
        );
        expect(legs[0]!.control).not.toBeNull();
        expect(edgeFrom(legs[0]!, at(3))).toBeGreaterThanOrEqual(sizes.gap);
        for (const leg of legs)
            expect(crossedMarchers(leg, obstacles)).toEqual([]);
    });

    it("still bows the legs that run back to either side, clear of the line", () => {
        const legs = orderLegs(
            [at(3), at(5), at(6), at(4), at(2)],
            tolerance,
            obstacles,
        );
        const side = (l: OrderLeg) => Math.sign(legPoint(l, 0.5).y - 100);
        expect(side(legs[2]!)).not.toBe(0);
        expect(side(legs[3]!)).toBe(-side(legs[2]!));
        legs.forEach((leg, i) =>
            expect(overlapsEarlier(leg, legs.slice(0, i), tolerance)).toBe(
                false,
            ),
        );
    });

    it("keeps a row in order straight, and neighbors beside its ends don't count", () => {
        const legs = orderLegs(
            [1, 2, 3, 4, 5, 6, 7].map(at),
            tolerance,
            obstacles,
        );
        expect(legs.every((l) => l.control === null)).toBe(true);
        // A block: diagonal and side neighbors sit by a leg's ends, not on it
        const block: OrderObstacles = {
            ...obstacles,
            at: [0, 1, 2].flatMap((r) =>
                [1, 2, 3].map((n) => ({ x: 40 * n, y: 100 + 40 * r })),
            ),
        };
        const across = orderLegs(
            [at(1), at(2), at(3), { x: 120, y: 140 }, { x: 80, y: 140 }],
            tolerance,
            block,
        );
        expect(across.every((l) => l.control === null)).toBe(true);
    });

    it("bows round a marcher of another line, not just its own", () => {
        const legs = orderLegs([at(1), at(3)], tolerance, {
            ...obstacles,
            at: [at(1), at(3), { x: 80, y: 104 }],
        });
        expect(legs[0]!.control).not.toBeNull();
        expect(edgeFrom(legs[0]!, { x: 80, y: 104 })).toBeGreaterThanOrEqual(
            sizes.gap,
        );
    });
});

describe("the leader's ring and its label", () => {
    const center = { x: 100, y: 100 };
    const r = 14;
    const reach = 3.5;
    // A label just above the dot, wider than the ring
    const label: Box = { minX: 80, minY: 70, maxX: 120, maxY: 90 };
    /** Points along the SVG arcs `ringArcs` gives, each run clockwise from its start */
    const along = (arcs: string): XY[] => {
        const points: XY[] = [];
        const re =
            /M([-\d.e]+),([-\d.e]+) A[-\d.e]+,[-\d.e]+ 0 [01] 1 ([-\d.e]+),([-\d.e]+)/g;
        for (const m of arcs.matchAll(re)) {
            const a0 = Math.atan2(+m[2]! - center.y, +m[1]! - center.x);
            let a1 = Math.atan2(+m[4]! - center.y, +m[3]! - center.x);
            if (a1 < a0) a1 += 2 * Math.PI;
            for (let i = 0; i <= 50; i++) {
                const a = a0 + ((a1 - a0) * i) / 50;
                points.push({
                    x: center.x + r * Math.cos(a),
                    y: center.y + r * Math.sin(a),
                });
            }
        }
        return points;
    };
    const covers = (p: XY, b: Box, pad: number) =>
        p.x >= b.minX - pad &&
        p.x <= b.maxX + pad &&
        p.y >= b.minY - pad &&
        p.y <= b.maxY + pad;

    it("is whole when no label is near", () => {
        expect(ringArcs(center, r, reach, [])).toBeNull();
        expect(
            ringArcs(center, r, reach, [
                { minX: 200, minY: 0, maxX: 240, maxY: 20 },
            ]),
        ).toBeNull();
    });

    it("leaves a gap where it would cover the label, and keeps the rest", () => {
        const arcs = ringArcs(center, r, reach, [label])!;
        expect(arcs).toBeTruthy();
        const points = along(arcs);
        expect(points.length).toBeGreaterThan(0);
        expect(points.some((p) => covers(p, label, reach))).toBe(false);
        // The bottom of the ring, away from the label, is still drawn
        expect(points.some((p) => p.y > 110)).toBe(true);
    });

    it("keeps clear of a label beside the dot too", () => {
        const beside: Box = { minX: 110, minY: 93, maxX: 150, maxY: 107 };
        const points = along(ringArcs(center, r, reach, [beside])!);
        expect(points.some((p) => covers(p, beside, reach))).toBe(false);
        expect(points.some((p) => p.x < 90)).toBe(true);
    });
});

describe("a leg's end and its marcher's label", () => {
    // A label above the marcher at the leg's start, and the leg leaving up and right
    const label: Box = { minX: 80, minY: 70, maxX: 120, maxY: 92 };
    const leg = straight({ x: 100, y: 100 }, { x: 160, y: 40 });

    it("stops short of the label when only its last few px run into it", () => {
        const t0 = trimLeg(leg, 10, 10)!.t0;
        const t = trimClearOf(leg, t0, false, label, 30);
        expect(t).toBeGreaterThan(t0);
        const p = legPoint(leg, t);
        expect(p.x > label.maxX || p.y < label.minY).toBe(true);
    });

    it("is left as it is when it doesn't reach the label", () => {
        const away = straight({ x: 100, y: 100 }, { x: 160, y: 140 });
        expect(trimClearOf(away, 0.1, false, label, 30)).toBe(0.1);
    });

    it("is left as it is when it runs on through the label", () => {
        const up = straight({ x: 100, y: 100 }, { x: 100, y: 0 });
        expect(trimClearOf(up, 0.1, false, label, 10)).toBe(0.1);
    });

    it("trims from the end it arrives at", () => {
        const into = straight({ x: 160, y: 40 }, { x: 100, y: 100 });
        const t1 = trimLeg(into, 10, 10)!.t1;
        const t = trimClearOf(into, t1, true, label, 30);
        expect(t).toBeLessThan(t1);
        const p = legPoint(into, t);
        expect(p.x > label.maxX || p.y < label.minY).toBe(true);
    });
});
