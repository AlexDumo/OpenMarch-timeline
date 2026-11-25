import { describe, expect, it } from "vitest";
import {
    isLineParams,
    lineInterval,
    lineSpots,
    type LineParams,
} from "../lineGeometry";
import { endPoint, stretchEnds, withAttach } from "../lineLinks";
import { isArcParams } from "../../arc/arcGeometry";

/**
 * A Line's attached ends (#1235): an attached end holds no marcher, the first one standing one of
 * the line's own intervals in from it; stretching keeps the far end and the line's form
 */

const straight = (x2 = 80): LineParams => ({
    points: [
        { x: 0, y: 0, tension: 0 },
        { x: x2, y: 0, tension: 0 },
    ],
    spacing: { mode: "fit" },
});

const xs = (p: LineParams, n: number) => lineSpots(p, n).map((s) => s.x);

describe("attached ends", () => {
    it("holds no marcher on an attached start: the first is one interval in", () => {
        const p = withAttach(straight(), "start", { recipe: 7, end: "end" });
        expect(xs(p, 4)).toEqual([20, 40, 60, 80]);
        expect(lineInterval(p, 4)).toBeCloseTo(20);
    });

    it("holds no marcher on an attached end, nor on both", () => {
        const end = withAttach(straight(), "end", { recipe: 7, end: "start" });
        expect(xs(end, 4)).toEqual([0, 20, 40, 60]);
        const both = withAttach(end, "start", { recipe: 8, end: "end" });
        expect(xs(both, 3)).toEqual([20, 40, 60]);
    });

    it("keeps a Keep interval's interval, its run a marcher longer", () => {
        const p: LineParams = {
            ...straight(),
            spacing: { mode: "keep", groups: [{ interval: 10 }] },
            attach: { start: { recipe: 3, end: "start" } },
        };
        const spots = xs(p, 3);
        expect(spots[1]! - spots[0]!).toBeCloseTo(10);
        expect(lineInterval(p, 3)).toBe(10);
    });

    it("counts the empty end in counted groups", () => {
        const p: LineParams = {
            ...straight(30),
            spacing: {
                mode: "path",
                anchor: "start",
                groups: [{ interval: 10, count: 3 }],
            },
            attach: { start: { recipe: 3, end: "end" } },
        };
        expect(xs(p, 3)).toEqual([10, 20, 30]);
    });

    it("lays out an attached Arc on its curve", () => {
        const arc: LineParams = {
            points: [
                { x: 0, y: 0, tension: 0, bend: 180 },
                { x: 40, y: 0, tension: 0 },
            ],
            spacing: { mode: "fit" },
            attach: { end: { recipe: 2, end: "end" } },
        };
        expect(isArcParams(arc)).toBe(true);
        const spots = lineSpots(arc, 4);
        expect(spots).toHaveLength(4);
        expect(Math.hypot(spots[0]!.x, spots[0]!.y)).toBeLessThan(1e-6);
        // No marcher on the attached end
        expect(spots.every((s) => Math.hypot(s.x - 40, s.y) > 1)).toBe(true);
    });

    it("reads an attachment back, and refuses a broken one or one on a closed line", () => {
        const ok = withAttach(straight(), "end", { recipe: 4, end: "start" });
        expect(isLineParams(JSON.parse(JSON.stringify(ok)))).toBe(true);
        expect(isLineParams({ ...straight(), attach: {} })).toBe(false);
        expect(
            isLineParams({
                ...straight(),
                attach: { end: { recipe: 4, end: "middle" } },
            }),
        ).toBe(false);
        expect(
            isLineParams({
                ...straight(),
                attach: { end: { recipe: 4, end: "start", at: 1 } },
            }),
        ).toBe(false);
        expect(
            isLineParams({
                points: [
                    { x: 0, y: 0, tension: 0 },
                    { x: 10, y: 0, tension: 0 },
                    { x: 0, y: 10, tension: 0 },
                ],
                closed: true,
                spacing: { mode: "fit" },
                attach: { end: { recipe: 4, end: "start" } },
            }),
        ).toBe(false);
    });

    it("detaches back to plain params", () => {
        const p = withAttach(straight(), "end", { recipe: 4, end: "start" });
        expect(withAttach(p, "end", undefined)).toEqual(straight());
    });
});

describe("stretchEnds", () => {
    it("moves one end, the other staying, the points between with it", () => {
        const p: LineParams = {
            points: [
                { x: 0, y: 0, tension: 0 },
                { x: 10, y: 10, tension: 1 },
                { x: 20, y: 0, tension: 0 },
            ],
            spacing: { mode: "fit" },
        };
        const out = stretchEnds(p, { end: { x: 0, y: 40 } });
        expect(endPoint(out, "start")).toEqual({ x: 0, y: 0 });
        expect(endPoint(out, "end")).toEqual({ x: 0, y: 40 });
        // Turned a quarter and doubled: (10, 10) goes to (-20, 20)
        expect(out.points[1]!.x).toBeCloseTo(-20);
        expect(out.points[1]!.y).toBeCloseTo(20);
        expect(out.points[1]!.tension).toBe(1);
    });

    it("keeps an arc's sweep and turns its ellipse", () => {
        const p: LineParams = {
            points: [
                {
                    x: 0,
                    y: 0,
                    tension: 0,
                    bend: 90,
                    ellipse: { ratio: 0.5, axis: 0 },
                },
                { x: 10, y: 0, tension: 0 },
            ],
            spacing: { mode: "fit" },
        };
        const out = stretchEnds(p, { end: { x: 0, y: 10 } });
        expect(out.points[0]!.bend).toBe(90);
        expect(out.points[0]!.ellipse!.axis).toBeCloseTo(90);
    });

    it("moves the line when both ends move the same way", () => {
        const out = stretchEnds(straight(), {
            start: { x: 5, y: 5 },
            end: { x: 85, y: 5 },
        });
        expect(out.points.map((q) => [q.x, q.y])).toEqual([
            [5, 5],
            [85, 5],
        ]);
    });

    it("is the line itself when nothing moves", () => {
        const p = straight();
        expect(stretchEnds(p, { end: { x: 80, y: 0 } })).toBe(p);
    });
});
