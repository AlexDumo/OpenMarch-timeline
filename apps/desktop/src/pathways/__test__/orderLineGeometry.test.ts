import { describe, expect, it } from "vitest";
import {
    ORDER_GAP_PX,
    ORDER_MIN_WIDTH,
    bowedLeg,
    legPoint,
    legTangent,
    numberSide,
    orderLegs,
    orderLineSizes,
    orderWidthBetween,
    overlapsEarlier,
    trimLeg,
    type OrderLeg,
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
