import { describe, expect, it } from "vitest";
import { lineTool } from "../lineTool";
import {
    holdsMarcher,
    lineSpots,
    segmentMidpoint,
    SMOOTH,
    splitSegment,
    type LineParams,
    type LinePoint,
} from "../lineGeometry";
import type { ToolEnv } from "../../tool/toolKind";
import {
    edit,
    openTool,
    pickMenu,
    pointerMove,
    press,
    release,
    slotsOf,
    type ToolState,
} from "../../tool/toolMachine";
import type { ShapeContext, XY } from "../../types";

/**
 * Splitting a segment (owner feedback on #596): a new point that holds a marcher lands on the
 * marcher spot nearest the segment's midpoint, so the split moves no marcher and changes no
 * interval, measured ↔ or along the path, unlocked or locked. A point that holds none, or a
 * segment with no spot inside it, splits at the midpoint.
 */

const STEP = 10;
const half = STEP / 2;
const snapHalf = (v: number) => Math.round(v / half) * half;
const env: ToolEnv = {
    stepPx: STEP,
    snap: true,
    pull: true,
    constrain: false,
    gridSnap: (p) => ({ x: snapHalf(p.x), y: snapHalf(p.y) }),
    hitRadius: 3,
    zoom: 1,
};
const fine: ToolEnv = { ...env, snap: false, fine: true, gridSnap: (p) => p };
const ctx: ShapeContext = { stepPx: STEP, snapPoint: (p) => p };
const marchers = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        at: { x: 300 + i * 7, y: 300 },
        drillRank: i,
    }));

const corner = (x: number, y: number, more?: Partial<LinePoint>) => ({
    x,
    y,
    tension: 0,
    ...more,
});
const paramsOf = (t: ToolState) => t.params as LineParams;
const spotsOf = (t: ToolState) => slotsOf(t, ctx).map(({ x, y }) => ({ x, y }));
const pointsOf = (t: ToolState) =>
    paramsOf(t).points.map(({ x, y }) => ({ x, y }));
const interval = lineTool.params.find((p) => p.key === "interval")!;
const measured = lineTool.choices!.find((c) => c.key === "measured")!;
const typed = (t: ToolState, text: string) =>
    edit(t, interval.type(t.params, t.spots, text, env), ctx);
const measuredBy = (t: ToolState, value: string) =>
    edit(t, measured.pick(t.params, t.spots, value, env), ctx);
const locked = (t: ToolState) =>
    lineTool.lock!.locked(t.params, t.spots)
        ? t
        : edit(t, lineTool.lock!.toggle(t.params, t.spots, env), ctx);
const intervalOf = (t: ToolState) => interval.value(t.params, t.spots, STEP);

const expectSame = (a: readonly XY[], b: readonly XY[]) => {
    expect(a).toHaveLength(b.length);
    a.forEach((s, i) => {
        expect(s.x).toBeCloseTo(b[i]!.x, 9);
        expect(s.y).toBeCloseTo(b[i]!.y, 9);
    });
};

function drawn(n: number, from: XY, to: XY): ToolState {
    let t = openTool(lineTool, marchers(n));
    t = press(t, from, env);
    t = pointerMove(t, to, env);
    return release(t, ctx);
}
function opened(params: LineParams, n: number): ToolState {
    return edit(openTool(lineTool, marchers(n)), params, ctx);
}

/** A midpoint handle clicked */
function clicked(t: ToolState, key: string): ToolState {
    const at = lineTool
        .handles(paramsOf(t), t.spots)
        .find((h) => h.key === key)!.at;
    t = press(t, at, env);
    expect(t.gesture).toMatchObject({ type: "handle", key });
    return release(t, ctx, { double: false });
}

/** 8 marchers measured ↔ 2 apart on a diagonal, 7 gaps: its midpoint is between two spots */
const sideToSide = () =>
    typed(measuredBy(drawn(8, { x: 0, y: 0 }, { x: 140, y: 50 }), "x"), "2");

/** Every way to split segment 0 of the open shape: a click, the menu, and a press-drag's start */
const SPLITS: [string, (t: ToolState) => ToolState][] = [
    ["clicking its midpoint", (t) => clicked(t, "m0")],
    ["Add point here", (t) => pickMenu(t, "m0", "add", ctx, env)],
];

describe("splitting a segment on a marcher's spot", () => {
    it("lands the new corner on the spot nearest the midpoint", () => {
        const t = sideToSide();
        const before = spotsOf(t);
        expect(before.map((s) => s.x)).toEqual([
            0, 20, 40, 60, 80, 100, 120, 140,
        ]);
        const split = clicked(t, "m0");
        const p = pointsOf(split);
        expect(p).toHaveLength(3);
        expect(holdsMarcher(paramsOf(split), 1)).toBe(true);
        // Nearest the midpoint (70 across): a spot either side, either is as near
        expect(
            before.some((s) => Math.hypot(s.x - p[1]!.x, s.y - p[1]!.y) < 1e-9),
        ).toBe(true);
        expect(Math.abs(p[1]!.x - 70)).toBe(10);
    });

    for (const [how, split] of SPLITS) {
        it(`keeps every spot and the ↔ interval, unlocked, ${how}`, () => {
            const t = sideToSide();
            expect(paramsOf(t).spacing.mode).toBe("fit");
            const after = split(t);
            expect(pointsOf(after)).toHaveLength(3);
            expectSame(spotsOf(after), spotsOf(t));
            expect(intervalOf(after)).toBeCloseTo(intervalOf(t), 9);
            spotsOf(after)
                .slice(1)
                .forEach((s, i) =>
                    expect(s.x - spotsOf(after)[i]!.x).toBeCloseTo(20, 9),
                );
        });

        it(`keeps every spot and the ↔ interval, locked, ${how}`, () => {
            const t = locked(sideToSide());
            expect(paramsOf(t).spacing.mode).toBe("keep");
            const after = split(t);
            expect(paramsOf(after).spacing.mode).toBe("keep");
            expectSame(spotsOf(after), spotsOf(t));
            spotsOf(after)
                .slice(1)
                .forEach((s, i) =>
                    expect(s.x - spotsOf(after)[i]!.x).toBeCloseTo(20, 9),
                );
        });

        it(`keeps every spot along the path, ${how}`, () => {
            const t = typed(drawn(8, { x: 0, y: 0 }, { x: 140, y: 0 }), "2");
            const after = split(t);
            expectSame(spotsOf(after), spotsOf(t));
            expect(intervalOf(after)).toBeCloseTo(2, 9);
            const locks = locked(t);
            expectSame(spotsOf(split(locks)), spotsOf(locks));
        });
    }

    it("starts a midpoint press-drag from the spot, the spacing kept until it moves", () => {
        const t = sideToSide();
        const at = segmentMidpoint(paramsOf(t), 0);
        let drag = press(t, at, env);
        expect(drag.gesture).toMatchObject({ type: "handle", key: "m0" });
        // Moved onto the spot it split on, unsnapped: nothing has changed
        const p = splitSegment(paramsOf(t), 0, 8);
        drag = pointerMove(drag, p.points[1]!, fine);
        expectSame(spotsOf(drag), spotsOf(t));
        // Moved straight up: still on whole steps side to side
        drag = release(
            pointerMove(drag, { x: at.x + 2, y: at.y - 30 }, env),
            ctx,
        );
        const xs = spotsOf(drag).map((s) => s.x / STEP);
        xs.forEach((x) => expect(x).toBeCloseTo(Math.round(x * 2) / 2, 6));
    });

    it("keeps the midpoint where the segment holds only one gap, every marcher still placed", () => {
        // 4 marchers: one gap on the first leg (2 steps), two on the second
        const L: LineParams = {
            points: [corner(0, 0), corner(20, 0), corner(20, 40)],
            spacing: { mode: "fit" },
        };
        const p = splitSegment(L, 0, 4);
        expect(p.points[1]).toMatchObject({ x: 10, y: 0, tension: 0 });
        const spots = lineSpots(p, 4);
        expect(spots).toHaveLength(4);
        spots.forEach((s) => {
            expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
        });
        // A marcher on every corner
        for (const q of p.points)
            expect(
                spots.some((s) => Math.hypot(s.x - q.x, s.y - q.y) < 1e-9),
            ).toBe(true);
    });

    it("splits a smooth segment at its midpoint, on its curve", () => {
        const curve: LineParams = {
            points: [
                corner(0, 0),
                { x: 60, y: 40, tension: SMOOTH },
                corner(140, 0),
            ],
            spacing: { mode: "fit" },
        };
        const p = splitSegment(curve, 0, 8);
        expect(p.points[1]!.tension).toBe(SMOOTH);
        const mid = segmentMidpoint(curve, 0);
        expect(p.points[1]!.x).toBeCloseTo(mid.x, 9);
        expect(p.points[1]!.y).toBeCloseTo(mid.y, 9);
    });

    it("splits at the midpoint with corners off, no marcher on the new point", () => {
        const flat: LineParams = {
            points: [corner(0, 0), corner(140, 50)],
            spacing: { mode: "fit" },
            corners: false,
        };
        const p = splitSegment(flat, 0, 8);
        expect(p.points[1]).toMatchObject({ x: 70, y: 25 });
        expectSame(
            lineSpots(p, 8).map(({ x, y }) => ({ x, y })),
            lineSpots(flat, 8).map(({ x, y }) => ({ x, y })),
        );
    });

    it("lands on a spot on a closed line, its last segment too", () => {
        // A square 60 a side, 12 marchers: 3 gaps a side, so each midpoint is between spots
        const square: LineParams = {
            points: [
                corner(0, 0),
                corner(60, 0),
                corner(60, 60),
                corner(0, 60),
            ],
            closed: true,
            spacing: { mode: "fit" },
        };
        const t = opened(square, 12);
        const set = (s: readonly XY[]) =>
            s.map(({ x, y }) => `${x.toFixed(6)},${y.toFixed(6)}`).sort();
        for (const key of ["m0", "m3"]) {
            const after = clicked(t, key);
            expect(pointsOf(after)).toHaveLength(5);
            expect(set(spotsOf(after))).toEqual(set(spotsOf(t)));
        }
    });
});
