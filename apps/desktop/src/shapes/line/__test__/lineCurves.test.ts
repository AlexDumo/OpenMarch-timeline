import { describe, expect, it } from "vitest";
import { curveTool, lineTool } from "../lineTool";
import {
    isLineParams,
    linePath,
    MAX_TENSION,
    SMOOTH,
    type LineParams,
} from "../lineGeometry";
import { chipLayout } from "../../editor/chip";
import {
    liveTargets,
    openLive,
    pressLive,
    releaseLive,
} from "../../placed/liveBox";
import {
    boxesAt,
    PLACED_KINDS,
    type PlacedBox,
    type PlacedRecipe,
} from "../../placed/placedBox";
import { placementOf } from "../../tool/shapePlacement";
import { SHAPE_TOOLS } from "../../tool/shapeTools";
import { toolId, type AnyToolKind, type ToolEnv } from "../../tool/toolKind";
import {
    edit,
    finishPoints,
    openTool,
    pointerMove,
    press,
    release,
    slotsOf,
    undo,
    type ToolState,
} from "../../tool/toolMachine";
import type { ShapeContext, XY } from "../../types";

/**
 * Smooth points and the Curve (#525, spec #522): each point has a tension, 0 a corner and more a
 * smooth point the line bends through. A click on a point toggles it, its tension handle sets how
 * round, the Points menu sets every point; smooth points never hold a marcher, and spots stay
 * evenly apart straight across along the curve. Curve is a preset of the Line whose points start
 * smooth. Driven through the shape session with the real Line kind.
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
};
const ctx: ShapeContext = { stepPx: STEP, snapPoint: (p) => p };
const marchers = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        at: { x: 300 + i * 7, y: 300 },
        drillRank: i,
    }));

function click(t: ToolState, at: XY): ToolState {
    t = pointerMove(t, at, env);
    t = press(t, at, env);
    return release(t, ctx, { double: false });
}

/** A line of `kind` clicked through `points`, finished with Enter */
function clicked(
    kind: AnyToolKind,
    n: number,
    points: readonly XY[],
): ToolState {
    let t = openTool(kind, marchers(n));
    for (const p of points) t = click(t, p);
    return finishPoints(t, ctx);
}

/** A handle pressed and dragged to `to`, or clicked where it is when `to` is absent */
function onHandle(t: ToolState, key: string, to?: XY): ToolState {
    const h = t.kind.handles(t.params, t.spots);
    const at = h.find((x) => x.key === key)!.at;
    t = press(t, at, env);
    expect(t.gesture).toMatchObject({ type: "handle", key });
    if (!to) return release(t, ctx, { double: false });
    t = pointerMove(t, to, env);
    return release(t, ctx, null);
}

const paramsOf = (t: ToolState) => t.params as LineParams;
const tensions = (t: ToolState) => paramsOf(t).points.map((q) => q.tension);
const spotsOf = (t: ToolState) => slotsOf(t, ctx).map(({ x, y }) => ({ x, y }));
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const handleKeys = (t: ToolState) =>
    t.kind.handles(t.params, t.spots).map((h) => h.key);
const gapsOf = (spots: readonly XY[]) =>
    spots.slice(1).map((p, i) => dist(spots[i]!, p));
/** How far `at` is from the line drawn through `t`'s outline */
const offLine = (t: ToolState, at: XY) => {
    const path = linePath(paramsOf(t));
    return dist(path.at(path.project(at)), at);
};
const interval = lineTool.params.find((p) => p.key === "interval")!;
const choice = (key: string) => lineTool.choices!.find((c) => c.key === key)!;
const typed = (t: ToolState, text: string) =>
    edit(t, interval.type(t.params, t.spots, text, env), ctx);
const picked = (t: ToolState, key: string, value: string) =>
    edit(t, choice(key).pick(t.params, t.spots, value, env), ctx);

const ARCH = [
    { x: 0, y: 0 },
    { x: 40, y: -20 },
    { x: 80, y: 0 },
];
/** A Line with a corner at its second point: an L, its arms 40 long */
const L = (n = 5) =>
    clicked(lineTool, n, [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 40 },
    ]);

describe("a point's tension", () => {
    it("makes the line bend through a smooth point and turn sharply at a corner", () => {
        const corner = clicked(lineTool, 4, ARCH);
        const curve = clicked(curveTool, 4, ARCH);
        expect(tensions(corner)).toEqual([0, 0, 0]);
        expect(tensions(curve)).toEqual([SMOOTH, SMOOTH, SMOOTH]);
        // Both pass through every point
        for (const q of ARCH) expect(offLine(curve, q)).toBeLessThan(1e-6);
        // The corner's outline is its three points; the curve's bows out past the straight
        // segments, so it's longer
        expect(lineTool.outline!(corner.params, 4)).toEqual(ARCH);
        expect(linePath(paramsOf(curve)).length).toBeGreaterThan(
            linePath(paramsOf(corner)).length + 1,
        );
        // Halfway to the top, the curve stands above the straight segment
        const outline = curveTool.outline!(curve.params, 4);
        const near20 = outline.reduce((a, b) =>
            Math.abs(b.x - 20) < Math.abs(a.x - 20) ? b : a,
        );
        expect(near20.y).toBeLessThan(-10.5);
    });

    it("reads a recipe's tensions from 0 to the roundest, and nothing else", () => {
        const points = (tension: number) => [
            { x: 0, y: 0, tension: 0 },
            { x: 40, y: -20, tension },
            { x: 80, y: 0, tension: 0 },
        ];
        const read = (tension: number) =>
            isLineParams({ points: points(tension), spacing: { mode: "fit" } });
        expect(read(0)).toBe(true);
        expect(read(SMOOTH)).toBe(true);
        expect(read(0.3)).toBe(true);
        expect(read(MAX_TENSION)).toBe(true);
        expect(read(MAX_TENSION + 0.1)).toBe(false);
        expect(read(-0.5)).toBe(false);
        expect(read(Number.NaN)).toBe(false);
    });
});

describe("setting a point's tension", () => {
    it("turns a corner smooth on a click of its handle, and back with another", () => {
        let t = onHandle(L(), "p1");
        expect(tensions(t)).toEqual([0, SMOOTH, 0]);
        // One undo step
        expect(tensions(undo(t))).toEqual([0, 0, 0]);
        t = onHandle(t, "p1");
        expect(tensions(t)).toEqual([0, 0, 0]);
    });

    it("gives a smooth point a tension handle, dragged out for rounder and back to a corner", () => {
        let t = onHandle(L(), "p1");
        expect(handleKeys(t)).toContain("t1");
        expect(handleKeys(L())).not.toContain("t1");
        const p1 = paramsOf(t).points[1]!;
        const at = t.kind
            .handles(t.params, t.spots)
            .find((h) => h.key === "t1")!.at;
        // Twice as far out from the point: twice the tension
        const out = {
            x: p1.x + (at.x - p1.x) * 2,
            y: p1.y + (at.y - p1.y) * 2,
        };
        t = onHandle(t, "t1", out);
        expect(tensions(t)[1]).toBeCloseTo(2 * SMOOTH, 6);
        // Halfway back: in tenths
        const back = {
            x: p1.x + (at.x - p1.x) * 0.53,
            y: p1.y + (at.y - p1.y) * 0.53,
        };
        const t2 = onHandle(onHandle(L(), "p1"), "t1", back);
        expect(tensions(t2)[1]).toBeCloseTo(0.5, 9);
        // Behind the point: a corner again, its handle gone
        const behind = { x: p1.x - (at.x - p1.x), y: p1.y - (at.y - p1.y) };
        const t3 = onHandle(onHandle(L(), "p1"), "t1", behind);
        expect(tensions(t3)[1]).toBe(0);
        expect(handleKeys(t3)).not.toContain("t1");
    });

    it("sets every point from the Points menu, which says when there are both", () => {
        const points = choice("points");
        const t = L();
        expect(points.current(t.params, t.spots)).toBe("corner");
        const smooth = picked(t, "points", "smooth");
        expect(tensions(smooth)).toEqual([SMOOTH, SMOOTH, SMOOTH]);
        expect(points.current(smooth.params, smooth.spots)).toBe("smooth");
        expect(tensions(picked(smooth, "points", "corner"))).toEqual([0, 0, 0]);
        const mixed = onHandle(t, "p1");
        expect(points.current(mixed.params, mixed.spots)).toBe("mixed");
        expect(
            points.options(mixed.params, mixed.spots).map((o) => o.value),
        ).toEqual(["corner", "smooth", "mixed"]);
        // A smooth point made smooth keeps its tension
        const t1 = mixed.kind
            .handles(mixed.params, mixed.spots)
            .find((h) => h.key === "t1")!.at;
        const rounder = onHandle(mixed, "t1", {
            x: 40 + (t1.x - 40) * 1.5,
            y: t1.y * 1.5,
        });
        expect(tensions(rounder)[1]).toBeCloseTo(1.5, 9);
        const kept = picked(rounder, "points", "smooth");
        expect(tensions(kept)[1]).toBe(tensions(rounder)[1]);
        // Not on a straight line of two points, which can't bend
        const two = clicked(lineTool, 5, [ARCH[0]!, ARCH[2]!]);
        expect(points.shown!(two.params, two.spots)).toBe(false);
        expect(points.shown!(t.params, t.spots)).toBe(true);
    });

    it("hides the corners switch on a line whose only corner turned smooth", () => {
        const corners = choice("corners");
        const t = L();
        expect(corners.shown!(t.params, t.spots)).toBe(true);
        const smooth = onHandle(t, "p1");
        expect(corners.shown!(smooth.params, smooth.spots)).toBe(false);
    });

    it("splits a curved segment on its curve, the new point smooth", () => {
        const t = clicked(curveTool, 5, ARCH);
        const mid = t.kind
            .handles(t.params, t.spots)
            .find((h) => h.key === "m0")!;
        expect(offLine(t, mid.at)).toBeLessThan(1e-6);
        const split = onHandle(t, "m0");
        expect(paramsOf(split).points[1]).toMatchObject({
            ...mid.at,
            tension: SMOOTH,
        });
    });
});

describe("spots along a curve", () => {
    it("never puts a marcher on a smooth point, neighbors evenly apart straight across", () => {
        // Four marchers on a symmetric arch: none on its top
        const t = clicked(curveTool, 4, ARCH);
        const spots = spotsOf(t);
        expect(spots[0]).toEqual(ARCH[0]);
        expect(spots.at(-1)).toEqual(ARCH[2]);
        for (const s of spots) expect(dist(s, ARCH[1]!)).toBeGreaterThan(1);
        const gaps = gapsOf(spots);
        for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 6);
        for (const s of spots) expect(offLine(t, s)).toBeLessThan(1e-6);
        // The chip shows that interval, worked out
        const chip = chipLayout(lineTool, t.params, t.spots, env).intervals[0]!;
        expect(Number(interval.value!(t.params, t.spots, STEP))).toBeCloseTo(
            gaps[0]! / STEP,
            6,
        );
        expect(chip.derived).toBe(true);
    });

    it("keeps a marcher on each corner but not on a smooth point between them", () => {
        // A zigzag whose second point is a corner and third smooth
        let t = clicked(lineTool, 7, [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 60, y: 30 },
            { x: 100, y: 30 },
        ]);
        t = onHandle(t, "p2");
        expect(tensions(t)).toEqual([0, 0, SMOOTH, 0]);
        const spots = spotsOf(t);
        expect(spots.some((s) => dist(s, { x: 40, y: 0 }) < 1e-9)).toBe(true);
        expect(spots.every((s) => dist(s, { x: 60, y: 30 }) > 0.5)).toBe(true);
    });

    it("keeps a typed interval straight across between neighbors along the curve", () => {
        const t = typed(clicked(curveTool, 5, ARCH), "2");
        expect(paramsOf(t).spacing.mode).toBe("keep");
        for (const g of gapsOf(spotsOf(t))) expect(g).toBeCloseTo(2 * STEP, 6);
    });

    it("makes a curved run between corners whole intervals when an interval is typed", () => {
        // An L whose second arm bends through a smooth point: a corner, then a curve
        let t = clicked(lineTool, 7, [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 55, y: 25 },
            { x: 40, y: 50 },
        ]);
        t = onHandle(t, "p2");
        t = typed(t, "2");
        for (const g of gapsOf(spotsOf(t))) expect(g).toBeCloseTo(2 * STEP, 6);
        // The corner holds a marcher, and isn't off its interval
        const corner = paramsOf(t).points[1]!;
        expect(spotsOf(t).some((s) => dist(s, corner) < 1e-6)).toBe(true);
        expect(interval.note!(t.params, t.spots)).toBeNull();
    });
});

describe("the Curve", () => {
    it("is in the Shapes tab after the Line, a preset of the same kind", () => {
        const entry = SHAPE_TOOLS.find((e) => e.kind === curveTool)!;
        expect(entry.action).toBe("shapeCurve");
        expect(SHAPE_TOOLS.map((e) => toolId(e.kind))).toEqual([
            "block",
            "circle",
            "line",
            "curve",
        ]);
        expect(curveTool.shape.label).toBe("Curve");
        expect(curveTool.shape.id).toBe("line");
        expect(curveTool.shape.version).toBe(lineTool.shape.version);
        // Recipes read back as the Line
        expect(PLACED_KINDS).toContain(lineTool);
        expect(PLACED_KINDS).not.toContain(curveTool);
    });

    it("draws two smooth points with a drag, bent by pulling a midpoint out", () => {
        let t = openTool(curveTool, marchers(5));
        t = press(t, { x: 0, y: 0 }, env);
        t = pointerMove(t, { x: 80, y: 0 }, env);
        t = release(t, ctx, null);
        expect(tensions(t)).toEqual([SMOOTH, SMOOTH]);
        t = onHandle(t, "m0", { x: 40, y: -30 });
        expect(tensions(t)).toEqual([SMOOTH, SMOOTH, SMOOTH]);
        expect(paramsOf(t).points[1]).toMatchObject({ x: 40, y: -30 });
    });

    it("turns a shape into an arch across its frame, every point smooth", () => {
        const line = clicked(lineTool, 5, [ARCH[0]!, ARCH[2]!]);
        const frame = lineTool.frameOf(line.params, 5);
        const curve = curveTool.fromFrame(frame, 5, env);
        expect(curve.points.map((q) => q.tension)).toEqual([
            SMOOTH,
            SMOOTH,
            SMOOTH,
        ]);
        expect(curve.points[0]).toMatchObject(ARCH[0]!);
        expect(curve.points[2]).toMatchObject(ARCH[2]!);
        expect(curve.points[1]!.y).toBeLessThan(0);
    });
});

describe("a placed curve", () => {
    const N = 6;
    function recipeOf(t: ToolState): PlacedRecipe {
        const placement = placementOf(t, ctx)!;
        return {
            ...placement.recipe,
            id: 1,
            timelineId: 10,
            members: placement.members,
            params: JSON.parse(JSON.stringify(placement.recipe.params)),
        };
    }
    const readBack = (recipe: PlacedRecipe): PlacedBox<LineParams> => {
        const at = new Map(recipe.members.map((m) => [m.marcherId, m]));
        const [placed] = boxesAt({
            recipes: [recipe],
            endBeatOf: () => 8,
            beat: 8,
            positionOf: (id) => at.get(id),
        });
        return placed as PlacedBox<LineParams>;
    };
    const arch = () => clicked(curveTool, N, [...ARCH, { x: 120, y: -20 }]);

    it("is saved as a Line recipe and keeps its tensions when reopened", () => {
        const t = onHandle(arch(), "t1", { x: 60, y: -40 });
        const recipe = recipeOf(t);
        expect(recipe.kind).toBe("line");
        const placed = readBack(recipe);
        expect(placed.kind).toBe(lineTool);
        expect(placed.params.points).toEqual(paramsOf(t).points);
        // Every member on a spot of the curve as it was drawn
        const spots = spotsOf(t);
        const { members } = liveTargets(placed, placed.params, ctx);
        expect(members).toHaveLength(N);
        for (const m of members)
            expect(spots.some((s) => dist(s, m) < 1e-6)).toBe(true);
    });

    it("saves a point clicked smooth or a corner on release", () => {
        const placed = readBack(recipeOf(arch()));
        const p1 = lineTool
            .handles(placed.params, N)
            .find((h) => h.key === "p1")!;
        const live = pressLive(openLive(placed), p1.at, env)!;
        const out = releaseLive(live, { double: false });
        expect(out.changed).toBe(true);
        expect((out.live.params as LineParams).points[1]!.tension).toBe(0);
    });
});
