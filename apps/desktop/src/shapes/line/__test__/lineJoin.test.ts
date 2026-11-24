// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
    holdsMarcher,
    lineSegments,
    linePath,
    lineSpots,
    type LineParams,
} from "../lineGeometry";
import { joinLines, reverseLine } from "../lineJoin";
import { makePath } from "../../geometry/path";
import type { XY } from "../../types";

const STEP = 12;
const FIT = { mode: "fit" } as const;

const straight: LineParams = {
    points: [
        { x: 0, y: 0, tension: 0 },
        { x: 48, y: 0, tension: 0 },
    ],
    spacing: FIT,
};
/** An Arc as the Arc kind saves it: two points, the first bent */
const arc = (from: XY, to: XY, bend = 90): LineParams => ({
    points: [
        { ...from, tension: 0, bend },
        { ...to, tension: 0 },
    ],
    spacing: FIT,
});
/** A figure of every stretch type: straight, curved through a smooth point, an arc, an ellipse arc */
const mixed: LineParams = {
    points: [
        { x: 0, y: 0, tension: 0 },
        { x: 30, y: 10, tension: 1 },
        { x: 60, y: 0, tension: 0, bend: 120 },
        {
            x: 90,
            y: 20,
            tension: 0,
            bend: -70,
            ellipse: { ratio: 0.5, axis: 30 },
        },
        { x: 120, y: 40, tension: 0 },
        { x: 150, y: 30, tension: 0, marcher: false },
        { x: 170, y: 60, tension: 0 },
    ],
    spacing: FIT,
};

const near = (a: XY, b: XY, tolerance = 1e-6) =>
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(tolerance);

/**
 * The two lines trace the same path, one the other way round. A closed line's reversed path starts
 * at its last point, `from` along the first's (its whole length but the last stretch)
 */
function samePathReversed(p: LineParams, q: LineParams, from?: number) {
    const a = linePath(p);
    const b = linePath(q);
    expect(b.length).toBeCloseTo(a.length, 6);
    const L = a.length;
    const back = (t: number) =>
        from === undefined ? L - t : (((from - t) % L) + L) % L;
    for (let k = 0; k <= 40; k++) {
        const t = (L * k) / 40;
        near(b.at(t), a.at(back(t)));
    }
}

describe("reverseLine", () => {
    it("runs a straight line the other way", () => {
        expect(reverseLine(straight).points).toEqual([
            { x: 48, y: 0, tension: 0 },
            { x: 0, y: 0, tension: 0 },
        ]);
    });

    it("moves an arc's bend to the other end of its stretch and turns it the other way", () => {
        const r = reverseLine(arc({ x: 0, y: 0 }, { x: 40, y: 0 }, 90));
        expect(r.points[0]).toEqual({ x: 40, y: 0, tension: 0, bend: -90 });
        expect(r.points[1]).toEqual({ x: 0, y: 0, tension: 0 });
        samePathReversed(arc({ x: 0, y: 0 }, { x: 40, y: 0 }, 90), r);
    });

    it("keeps every stretch's geometry and type in a mixed figure", () => {
        const r = reverseLine(mixed);
        samePathReversed(mixed, r);
        expect(lineSegments(r).map((s) => s.type)).toEqual(
            lineSegments(mixed)
                .map((s) => s.type)
                .reverse(),
        );
        // The ellipse goes with its bend; a point's own marcher answer stays on its point
        expect(r.points[2]).toEqual({
            x: 120,
            y: 40,
            tension: 0,
            bend: 70,
            ellipse: { ratio: 0.5, axis: 30 },
        });
        expect(r.points[1]!.marcher).toBe(false);
        expect(r.points.at(-1)!.bend).toBeUndefined();
    });

    it("keeps a closed line's wrap-round arc", () => {
        const closed: LineParams = {
            points: [
                { x: 0, y: 0, tension: 0 },
                { x: 40, y: 0, tension: 0 },
                { x: 40, y: 40, tension: 0, bend: 90 },
            ],
            closed: true,
            spacing: FIT,
        };
        const last = makePath([lineSegments(closed).at(-1)!]).length;
        samePathReversed(
            closed,
            reverseLine(closed),
            linePath(closed).length - last,
        );
    });

    it("is undone by running it back", () => {
        const twice = reverseLine(reverseLine(mixed));
        expect(twice.points).toEqual(mixed.points);
    });

    it("reverses interval groups and swaps a run's anchor", () => {
        const r = reverseLine({
            ...straight,
            spacing: {
                mode: "path",
                anchor: "start",
                groups: [{ interval: 12, count: 2 }, { interval: 24 }],
            },
        });
        expect(r.spacing).toEqual({
            mode: "path",
            anchor: "end",
            groups: [{ interval: 24 }, { interval: 12, count: 2 }],
        });
    });
});

describe("joinLines", () => {
    it("joins ends within a step into one corner holding a marcher, halfway between them", () => {
        const b = arc({ x: 50, y: 4 }, { x: 90, y: 4 });
        const j = joinLines(straight, b, STEP);
        expect(j.merged).toBe(true);
        expect(j.reversedA).toBe(false);
        expect(j.reversedB).toBe(false);
        expect(j.params.points).toEqual([
            { x: 0, y: 0, tension: 0 },
            { x: 49, y: 2, tension: 0, marcher: true, bend: 90 },
            { x: 90, y: 4, tension: 0 },
        ]);
        expect(j.params.spacing).toEqual(FIT);
        // The arc stays an arc
        expect(lineSegments(j.params).map((s) => s.type)).toEqual([
            "line",
            "arc",
        ]);
    });

    it("bridges ends further apart with a straight stretch, both ends holding a marcher", () => {
        const b = arc({ x: 80, y: 0 }, { x: 120, y: 0 });
        const j = joinLines(straight, b, STEP);
        expect(j.merged).toBe(false);
        expect(j.params.points).toEqual([
            { x: 0, y: 0, tension: 0 },
            { x: 48, y: 0, tension: 0, marcher: true },
            { x: 80, y: 0, tension: 0, marcher: true, bend: 90 },
            { x: 120, y: 0, tension: 0 },
        ]);
        expect(lineSegments(j.params).map((s) => s.type)).toEqual([
            "line",
            "line",
            "arc",
        ]);
    });

    it("joins the nearest pair of ends, running either line the other way, and moves neither", () => {
        // a's start is nearest b's end: both run the other way
        const b = arc({ x: -60, y: 0 }, { x: -2, y: 0 }, 60);
        const j = joinLines(straight, b, STEP);
        expect(j.reversedA).toBe(true);
        expect(j.reversedB).toBe(true);
        expect(j.params.points[0]).toEqual({ x: 48, y: 0, tension: 0 });
        expect(j.params.points.at(-1)).toEqual({ x: -60, y: 0, tension: 0 });
        // The arc's piece of the joined line is the arc as it was (its end on the joint), run
        // backwards: same length, bulging the same way
        expect(lineSegments(j.params)[1]!.type).toBe("arc");
        const piece = linePath({
            ...j.params,
            points: j.params.points.slice(1),
        });
        const original = linePath({
            ...b,
            points: [b.points[0]!, { ...b.points[1]!, x: -1 }],
        });
        expect(piece.length).toBeCloseTo(original.length, 6);
        near(piece.at(piece.length / 2), original.at(original.length / 2));
    });

    it("keeps each piece's corners: a corner of a line whose corners held none still holds none", () => {
        const a: LineParams = {
            points: [
                { x: 0, y: 0, tension: 0 },
                { x: 24, y: 24, tension: 0 },
                { x: 48, y: 0, tension: 0 },
            ],
            corners: false,
            spacing: FIT,
        };
        const b: LineParams = {
            points: [
                { x: 48, y: 0, tension: 0 },
                { x: 72, y: 24, tension: 0 },
                { x: 96, y: 0, tension: 0 },
            ],
            spacing: FIT,
        };
        const j = joinLines(a, b, STEP);
        expect(j.params.corners).toBeUndefined();
        expect(holdsMarcher(j.params, 1)).toBe(false);
        expect(holdsMarcher(j.params, 2)).toBe(true);
        expect(holdsMarcher(j.params, 3)).toBe(true);
        // Both off stays off, the joint still holding one
        const off = joinLines(a, { ...b, corners: false }, STEP);
        expect(off.params.corners).toBe(false);
        expect(holdsMarcher(off.params, 2)).toBe(true);
        expect(holdsMarcher(off.params, 3)).toBe(false);
    });

    it("drops what the joined line can't keep: groups, measured, turn", () => {
        const j = joinLines(
            {
                ...straight,
                measured: "x",
                turn: 30,
                spacing: { mode: "keep", groups: [{ interval: 12 }] },
            },
            arc({ x: 48, y: 0 }, { x: 96, y: 0 }),
            STEP,
        );
        expect(j.params).toEqual({ points: j.params.points, spacing: FIT });
    });

    it("spreads marchers evenly through the joint, exactly one on it", () => {
        // 48 straight, then a quarter circle on a 40 chord (about 44.4 along)
        const j = joinLines(
            straight,
            arc({ x: 48, y: 0 }, { x: 88, y: 0 }),
            STEP,
        );
        const spots = lineSpots(j.params, 9);
        const onJoint = spots.filter((s) => Math.hypot(s.x - 48, s.y) < 1e-6);
        expect(onJoint).toHaveLength(1);
        const gaps = spots.slice(1).map((s, i) => s.s! - spots[i]!.s!);
        expect(Math.max(...gaps) / Math.min(...gaps)).toBeLessThan(1.2);
        near(spots[0]!, { x: 0, y: 0 });
        near(spots.at(-1)!, { x: 88, y: 0 });
    });
});
