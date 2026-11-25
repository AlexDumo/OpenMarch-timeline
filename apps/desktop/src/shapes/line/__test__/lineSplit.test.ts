import { describe, expect, it } from "vitest";
import { isArcParams } from "../../arc/arcGeometry";
import { lineSpots, type LineParams, type LinePoint } from "../lineGeometry";
import { splitCount, splitLine } from "../lineSplit";
import type { XY } from "../../types";

/**
 * Split here (#1336): a line cut in two between two marchers, nobody moving. Each piece is laid
 * out again from its own params and compared with the spots it was cut from.
 */

const pt = (
    x: number,
    y: number,
    more: Partial<LinePoint> = {},
): LinePoint => ({
    x,
    y,
    tension: 0,
    ...more,
});

const fit = (
    points: LinePoint[],
    more: Partial<LineParams> = {},
): LineParams => ({
    points,
    spacing: { mode: "fit" },
    ...more,
});

const near = (a: readonly XY[], b: readonly XY[], tol = 1e-6) => {
    expect(a.length).toBe(b.length);
    a.forEach((p, i) => {
        expect(Math.hypot(p.x - b[i]!.x, p.y - b[i]!.y)).toBeLessThan(tol);
    });
};

/** Splits `p` of `n` after `k` and checks every spot stays where it was */
function splitKeeps(p: LineParams, n: number, k: number, tol = 1e-6) {
    const before = lineSpots(p, n)
        .slice()
        .sort((a, b) => a.s! - b.s!);
    const [one, two] = splitLine(p, n, k);
    expect(one.spots).toBe(k);
    expect(two.spots).toBe(n - k);
    if (one.params) near(lineSpots(one.params, k), before.slice(0, k), tol);
    if (two.params) near(lineSpots(two.params, n - k), before.slice(k), tol);
    return [one, two] as const;
}

describe("splitLine", () => {
    it("cuts a straight line between marchers, nobody moving", () => {
        const p = fit([pt(0, 0), pt(100, 0)]);
        const [one, two] = splitKeeps(p, 11, 4);
        expect(one.params!.points.map((q) => q.x)).toEqual([0, 30]);
        expect(two.params!.points.map((q) => q.x)).toEqual([40, 100]);
    });

    it("leaves a piece of one marcher without a line", () => {
        const [one, two] = splitKeeps(fit([pt(0, 0), pt(100, 0)]), 5, 1);
        expect(one.params).toBeNull();
        expect(two.params!.points[0]!.x).toBeCloseTo(25);
    });

    it("keeps the corners between, and their marchers", () => {
        const p = fit([pt(0, 0), pt(40, 0), pt(40, 40), pt(100, 40)]);
        splitKeeps(p, 15, 3);
        splitKeeps(p, 15, 6);
        splitKeeps(p, 15, 11);
    });

    it("cuts an arc into two arcs turning its sweep between them", () => {
        const arc = fit([pt(0, 0, { bend: 120 }), pt(100, 0)]);
        expect(isArcParams(arc)).toBe(true);
        const [one, two] = splitKeeps(arc, 9, 3);
        expect(isArcParams(one.params)).toBe(true);
        expect(isArcParams(two.params)).toBe(true);
        // 8 even gaps: 2 in the first, one cut, 5 in the second
        expect(one.params!.points[0]!.bend).toBeCloseTo(30);
        expect(two.params!.points[0]!.bend).toBeCloseTo(75);
    });

    it("cuts an arc on an ellipse", () => {
        const arc = fit([
            pt(0, 0, { bend: 150, ellipse: { ratio: 0.5, axis: 20 } }),
            pt(100, 0),
        ]);
        splitKeeps(arc, 9, 4, 1e-3);
    });

    it("keeps a curve's spots, taking a point or two to hold its bend", () => {
        const curve = fit([
            pt(0, 0, { tension: 1 }),
            pt(50, 30, { tension: 1 }),
            pt(100, 0, { tension: 1 }),
        ]);
        // A gentle curve keeps its spots within a hair
        for (const k of [1, 2, 5, 8, 10]) splitKeeps(curve, 11, k, 0.1);
        // A tight S-curve can't be matched exactly by its pieces' own points: its marchers
        // settle onto them, a little way at most
        const s = fit([
            pt(0, 0, { tension: 1 }),
            pt(40, 40, { tension: 1 }),
            pt(80, -20, { tension: 1.5 }),
            pt(130, 10, { tension: 1 }),
        ]);
        for (const k of [3, 7, 12]) splitKeeps(s, 16, k, 2.5);
    });

    it("keeps the interval in Keep interval and on the path", () => {
        const keep: LineParams = {
            points: [pt(0, 0), pt(80, 0)],
            spacing: { mode: "keep", groups: [{ interval: 10 }] },
        };
        splitKeeps(keep, 9, 4);
        const path: LineParams = {
            points: [pt(0, 0), pt(100, 0)],
            spacing: {
                mode: "path",
                groups: [{ interval: 10 }],
                anchor: "center",
            },
        };
        splitKeeps(path, 5, 2);
    });

    it("cuts mixed interval groups where the cut falls", () => {
        const p: LineParams = {
            points: [pt(0, 0), pt(100, 0)],
            spacing: {
                mode: "keep",
                groups: [{ interval: 5, count: 4 }, { interval: 10 }],
            },
        };
        const [one, two] = splitKeeps(p, 9, 6);
        expect(one.params!.spacing).toEqual({
            mode: "keep",
            groups: [
                { interval: 5, count: 4 },
                { interval: 10, count: 2 },
            ],
        });
        expect(two.params!.spacing).toEqual({
            mode: "keep",
            groups: [{ interval: 10 }],
        });
    });
});

describe("splitCount", () => {
    const p = fit([pt(0, 0), pt(100, 0)]);
    it("counts the spots before the click", () => {
        expect(splitCount(p, 11, { x: 35, y: 2 })).toBe(4);
        expect(splitCount(p, 11, { x: 30, y: 0 })).toBe(4);
    });
    it("has nothing to split past the last spot or on a closed line", () => {
        expect(splitCount(p, 11, { x: 120, y: 0 })).toBeNull();
        expect(
            splitCount(
                { ...p, points: [...p.points, pt(50, 50)], closed: true },
                11,
                { x: 35, y: 0 },
            ),
        ).toBeNull();
    });
});
