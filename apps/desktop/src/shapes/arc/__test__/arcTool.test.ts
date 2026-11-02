import { describe, expect, it } from "vitest";
import { arcTool } from "../arcTool";
import {
    arcEnds,
    arcGuide,
    bendHandlePoint,
    bendOf,
    ellipseOf,
    isArcParams,
    MIDDLE_KEY,
    withBend,
    withEnds,
    withSweep,
} from "../arcGeometry";
import {
    bentSegment,
    isLineParams,
    linePath,
    lineSpots,
    withLineFrame,
    lineFrame,
    type LineParams,
} from "../../line/lineGeometry";
import { lineFillSpots } from "../../line/lineFill";
import { distributionOf, switchModes } from "../../distribute/modes";
import { PLACED_KINDS } from "../../placed/placedBox";
import { SHAPE_TOOLS } from "../../tool/shapeTools";
import { circleTool } from "../../circle/circleTool";
import type { ToolEnv } from "../../tool/toolKind";
import {
    edit,
    openTool,
    pointerMove,
    press,
    release,
    slotsOf,
    switchKind,
    pickMenu,
    undo,
    type ToolState,
} from "../../tool/toolMachine";
import type { ShapeContext, XY } from "../../types";

/**
 * The Arc (#634): drawn end to end, stretched by its handles as a box is (onto an ellipse when one
 * way only), its degrees set in the editor round its circle, spaced as a Line, closed by its chord
 * or round to a circle. Driven through the shape session with the real Arc kind.
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
const fine: ToolEnv = { ...env, snap: false, fine: true };
const ctx: ShapeContext = { stepPx: STEP, snapPoint: (p) => p };
const marchers = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        at: { x: 300 + i * 7, y: 300 },
        drillRank: i,
    }));

const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const paramsOf = (t: ToolState) => t.params as LineParams;
const spotsOf = (t: ToolState) => slotsOf(t, ctx).map(({ x, y }) => ({ x, y }));

/** An arc of `n` dragged from `from` to `to` */
function drawn(n: number, from: XY, to: XY): ToolState {
    let t = openTool(arcTool, marchers(n));
    t = pointerMove(t, from, env);
    t = press(t, from, env);
    t = pointerMove(t, to, env);
    return release(t, ctx, null);
}

/** Handle `key` dragged to `to` */
function onHandle(t: ToolState, key: string, to: XY, e = env): ToolState {
    const h = t.kind.handles(t.params, t.spots, t.selected);
    const at = h.find((x) => x.key === key)!.at;
    t = press(t, at, e);
    expect(t.gesture).toMatchObject({ type: "handle", key });
    t = pointerMove(t, to, e);
    return release(t, ctx, null);
}

/** A 180° arc of 7 from (100, 200) to (160, 200), bowing up: its circle's center (130, 200), r 30 */
function halfTurn(): ToolState {
    const t = drawn(7, { x: 100, y: 200 }, { x: 160, y: 200 });
    return edit(t, withBend(paramsOf(t), 180), ctx);
}

/** A two-point open arc from (0, 0) to (40, 0) turning `bend` degrees */
const arc = (bend: number): LineParams =>
    withBend(
        {
            points: [
                { x: 0, y: 0, tension: 0 },
                { x: 40, y: 0, tension: 0 },
            ],
            spacing: { mode: "fit" },
        },
        bend,
    );

describe("the bent segment", () => {
    it("runs from end to end on one circle", () => {
        for (const bend of [30, 90, 180, 270, -120]) {
            const segment = bentSegment({ x: 0, y: 0 }, { x: 40, y: 0 }, bend);
            const path = linePath(arc(bend));
            expect(segment.type).toBe("arc");
            expect(dist(path.at(0), { x: 0, y: 0 })).toBeLessThan(1e-9);
            expect(dist(path.at(path.length), { x: 40, y: 0 })).toBeLessThan(
                1e-9,
            );
            // Its length is the sweep times the radius
            if (segment.type === "arc")
                expect(path.length).toBeCloseTo(
                    (Math.abs(bend) * Math.PI * segment.r) / 180,
                    9,
                );
        }
    });

    it("bows left of its first end for a positive sweep (toward the back of the field)", () => {
        const mid = linePath(arc(90)).at(linePath(arc(90)).length / 2);
        expect(mid.y).toBeLessThan(0);
        const other = linePath(arc(-90));
        expect(other.at(other.length / 2).y).toBeGreaterThan(0);
    });

    it("is a half circle about the chord's middle at 180°", () => {
        const path = linePath(arc(180));
        const mid = path.at(path.length / 2);
        expect(mid.x).toBeCloseTo(20, 9);
        expect(mid.y).toBeCloseTo(-20, 9);
        expect(path.length).toBeCloseTo(20 * Math.PI, 9);
    });
});

describe("reading an arc back", () => {
    it("reads a bent two-point line, not a straight one or three points", () => {
        expect(isArcParams(arc(90))).toBe(true);
        const straight = {
            ...arc(90),
            points: arc(90).points.map(({ bend: _b, ...q }) => q),
        };
        expect(isArcParams(straight)).toBe(false);
        expect(
            isArcParams({
                ...arc(90),
                points: [...arc(90).points, { x: 80, y: 0, tension: 0 }],
            }),
        ).toBe(false);
    });

    it("refuses a bend of a full turn or more", () => {
        const p = arc(90);
        const bad = {
            ...p,
            points: [{ ...p.points[0]!, bend: 360 }, p.points[1]!],
        };
        expect(isLineParams(bad)).toBe(false);
    });

    it("reads both closed arcs, and is read back as itself", () => {
        expect(isArcParams(withEnds(arc(90), "chord"))).toBe(true);
        expect(isArcParams(withEnds(arc(90), "circle"))).toBe(true);
        expect(PLACED_KINDS).toContain(arcTool);
        expect(SHAPE_TOOLS.map((e) => e.kind)).toContain(arcTool);
        expect(arcTool.shape.id).toBe("arc");
        expect(arcTool.shape.version).toBe(2);
    });
});

describe("drawing an arc", () => {
    it("lands its ends as a Line's and bows a quarter turn left of the drag", () => {
        const t = drawn(5, { x: 101, y: 199 }, { x: 159, y: 201 });
        const p = paramsOf(t);
        expect(p.points.map(({ x, y }) => ({ x, y }))).toEqual([
            { x: 100, y: 200 },
            { x: 160, y: 200 },
        ]);
        expect(bendOf(p)).toBe(90);
        expect(arcEnds(p)).toBe("open");
    });

    it("puts a marcher on each end and spaces the rest evenly, equal chords apart", () => {
        const t = drawn(5, { x: 100, y: 200 }, { x: 160, y: 200 });
        const spots = spotsOf(t);
        expect(spots).toHaveLength(5);
        const ends = [spots[0]!, spots[4]!].sort((a, b) => a.x - b.x);
        expect(dist(ends[0]!, { x: 100, y: 200 })).toBeLessThan(1e-6);
        expect(dist(ends[1]!, { x: 160, y: 200 })).toBeLessThan(1e-6);
        const ordered = lineSpots(paramsOf(t), 5);
        const chords = ordered.slice(1).map((s, i) => dist(s, ordered[i]!));
        for (const c of chords) expect(c).toBeCloseTo(chords[0]!, 6);
    });
});

describe("its degrees (owner on #634)", () => {
    const bend = () => arcTool.params.find((p) => p.key === "bend")!;

    it("reads its sweep in the editor and takes a typed one, its circle staying", () => {
        const t = halfTurn();
        expect(bend().display(t.params, t.spots, STEP)).toBe("180°");
        const typed = edit(t, bend().type(t.params, t.spots, "90", env), ctx);
        const p = paramsOf(typed);
        expect(bendOf(p)).toBeCloseTo(90, 6);
        const g = arcGuide(p)!;
        expect(dist(g.center, { x: 130, y: 200 })).toBeLessThan(1e-6);
        expect(g.rx).toBeCloseTo(30, 6);
    });

    it("grows evenly from its middle, so in Fit its marchers spread out", () => {
        const t = halfTurn();
        const middle = bendHandlePoint(paramsOf(t));
        const gapBefore = dist(
            lineSpots(paramsOf(t), 7)[0]!,
            lineSpots(paramsOf(t), 7)[1]!,
        );
        const wider = withSweep(paramsOf(t), 270);
        expect(dist(bendHandlePoint(wider), middle)).toBeLessThan(1e-6);
        const spots = lineSpots(wider, 7);
        expect(dist(spots[0]!, spots[1]!)).toBeGreaterThan(gapBefore);
    });

    it("drags in whole degrees and never turns a full circle", () => {
        const t = halfTurn();
        const roles = {
            fine: false,
            constrain: false,
            fromCenter: false,
        } as never;
        const more = bend().scrub(
            t.params,
            7,
            { dx: 20, dy: 0, axis: "x", roles },
            env,
        );
        expect(bendOf(more as LineParams)).toBeCloseTo(190, 6);
        const most = bend().scrub(
            t.params,
            7,
            { dx: 2000, dy: 0, axis: "x", roles },
            env,
        );
        expect(Math.abs(bendOf(most as LineParams))).toBeLessThanOrEqual(359);
    });

    it("keeps a locked interval as its degrees change, the circle sized to it", () => {
        let t = halfTurn();
        t = edit(t, arcTool.lock!.toggle(t.params, t.spots, env), ctx);
        const before = linePath(paramsOf(t)).length;
        t = edit(t, bend().type(t.params, t.spots, "90", env), ctx);
        expect(bendOf(paramsOf(t))).toBeCloseTo(90, 6);
        expect(linePath(paramsOf(t)).length).toBeCloseTo(before, 6);
    });
});

describe("turning and flipping", () => {
    it("bows the other way when mirrored, so it stays where it was drawn", () => {
        const p = arc(90);
        const frame = lineFrame(p);
        const flipped = withLineFrame(p, { ...frame, flipY: true });
        expect(bendOf(flipped)).toBe(-90);
        const path = linePath(flipped);
        expect(path.at(path.length / 2).y).toBeGreaterThan(0);
        // Turned, it keeps its sweep
        const turned = withLineFrame(p, { ...frame, rotation: Math.PI / 2 });
        expect(bendOf(turned)).toBe(90);
    });
});

describe("closing it", () => {
    it("closes by its chord, filling as a closed Line, and opens again as it was", () => {
        const p = arc(180);
        const chord = withEnds(p, "chord");
        expect(arcEnds(chord)).toBe("chord");
        expect(switchModes(arcTool, { params: chord, n: 8 })).toEqual([
            "files",
            "outline",
            "spread",
        ]);
        expect(distributionOf(arcTool, chord, 8)?.mode).toBe("outline");
        expect(withEnds(chord, "open")).toEqual(p);
    });

    it("closes round to a whole circle, its marchers evenly round it", () => {
        const circle = withEnds(arc(90), "circle");
        expect(arcEnds(circle)).toBe("circle");
        const spots = lineFillSpots(circle, 8, STEP);
        expect(spots).toHaveLength(8);
        const path = linePath(circle);
        expect(path.closed).toBe(true);
        // Every spot the same distance from the circle's center
        const center = {
            x: spots.reduce((s, q) => s + q.x, 0) / 8,
            y: spots.reduce((s, q) => s + q.y, 0) / 8,
        };
        const r = dist(spots[0]!, center);
        for (const q of spots) expect(dist(q, center)).toBeCloseTo(r, 6);
        expect(withEnds(circle, "open")).toEqual(arc(90));
    });

    it("keeps a circle a circle as it bends", () => {
        const circle = withEnds(arc(90), "circle");
        const bent = withBend(circle, 200);
        expect(isArcParams(bent)).toBe(true);
        expect(bent.points[1]!.bend).toBe(160);
    });

    it("closes from an end's right-click menu, one undo step", () => {
        const t = drawn(6, { x: 100, y: 200 }, { x: 160, y: 200 });
        const sections = arcTool.menu!.sections(t.params, t.spots, "p0")!;
        expect(sections[0]!.items.map((i) => i.value)).toEqual([
            "open",
            "chord",
            "circle",
        ]);
        const closed = pickMenu(t, "p0", "chord", ctx, env);
        expect(arcEnds(paramsOf(closed))).toBe("chord");
        expect(arcEnds(paramsOf(undo(closed)))).toBe("open");
    });

    it("closes from the editor's Open or closed menu", () => {
        const t = drawn(6, { x: 100, y: 200 }, { x: 160, y: 200 });
        const ends = arcTool.choices!.find((c) => c.key === "ends")!;
        expect(ends.current(t.params, t.spots)).toBe("open");
        const circle = ends.pick(t.params, t.spots, "circle", env);
        expect(arcEnds(circle)).toBe("circle");
    });
});

describe("switching kinds", () => {
    it("turns a drawn Circle into a half-circle arc across its frame", () => {
        let t = openTool(circleTool, marchers(6));
        t = pointerMove(t, { x: 100, y: 100 }, env);
        t = press(t, { x: 100, y: 100 }, env);
        t = pointerMove(t, { x: 130, y: 100 }, env);
        t = release(t, ctx, null);
        const switched = switchKind(t, arcTool, ctx, env);
        expect(switched.kind).toBe(arcTool);
        expect(isArcParams(switched.params)).toBe(true);
        expect(Math.abs(bendOf(paramsOf(switched)))).toBe(180);
    });
});

describe("its whole circle", () => {
    it("shows the circle the arc is part of, through both ends", () => {
        const p = arc(90);
        const [circle] = arcTool.construction!(p, 5);
        expect(circle).toBeDefined();
        for (const end of p.points)
            expect(dist(end, circle!.center)).toBeCloseTo(circle!.rx, 9);
        expect(arcTool.construction!(withEnds(p, "chord"), 5)).toHaveLength(1);
    });

    it("shows none once it's closed to a circle", () => {
        expect(arcTool.construction!(withEnds(arc(90), "circle"), 5)).toEqual(
            [],
        );
    });
});

describe("stretching it (owner on #634)", () => {
    const handleAt = (t: ToolState, key: string) =>
        t.kind.handles(t.params, t.spots, null).find((h) => h.key === key)!.at;

    it("has a handle at each end and one in the middle", () => {
        const t = halfTurn();
        const keys = t.kind.handles(t.params, t.spots, null).map((h) => h.key);
        expect(keys).toEqual(["p0", "p1", MIDDLE_KEY]);
        expect(dist(handleAt(t, MIDDLE_KEY), { x: 130, y: 170 })).toBeLessThan(
            1e-6,
        );
    });

    it("stretches side to side from an end, the other side staying, onto an ellipse", () => {
        let t = halfTurn();
        // p1 at (160, 200) dragged 20 further out: 60 wide → 80 wide, the left side at 100 kept
        t = onHandle(t, "p1", { x: 180, y: 200 });
        const p = paramsOf(t);
        const g = arcGuide(p)!;
        expect(ellipseOf(p)).toBeDefined();
        expect(g.rx).toBeCloseTo(40, 6);
        expect(g.ry).toBeCloseTo(30, 6);
        expect(Math.min(p.points[0]!.x, p.points[1]!.x)).toBeCloseTo(100, 6);
        expect(Math.abs(bendOf(p))).toBeCloseTo(180, 6);
        // In Fit, the marchers spread side to side
        const spots = lineSpots(p, 7);
        for (const q of spots)
            expect(
                ((q.x - g.center.x) / g.rx) ** 2 +
                    ((q.y - g.center.y) / g.ry) ** 2,
            ).toBeCloseTo(1, 3);
    });

    it("stretches front to back from the middle, its ends' line staying", () => {
        let t = halfTurn();
        t = onHandle(t, MIDDLE_KEY, { x: 130, y: 160 });
        const p = paramsOf(t);
        const g = arcGuide(p)!;
        expect(g.ry).toBeCloseTo(40, 6);
        expect(g.rx).toBeCloseTo(30, 6);
        for (const q of p.points) expect(q.y).toBeCloseTo(200, 6);
    });

    it("keeps its proportions with constrain", () => {
        let t = halfTurn();
        t = onHandle(t, "p1", { x: 180, y: 200 }, { ...env, constrain: true });
        const g = arcGuide(paramsOf(t))!;
        expect(ellipseOf(paramsOf(t))).toBeUndefined();
        expect(g.rx).toBeCloseTo(40, 6);
        expect(g.ry).toBeCloseTo(40, 6);
        // The ends' line stays
        for (const q of paramsOf(t).points) expect(q.y).toBeCloseTo(200, 6);
    });

    it("stretches about its circle's center with fromCenter", () => {
        let t = halfTurn();
        t = onHandle(t, "p1", { x: 170, y: 200 }, { ...env, fromCenter: true });
        const g = arcGuide(paramsOf(t))!;
        expect(g.center.x).toBeCloseTo(130, 6);
        expect(g.rx).toBeCloseTo(40, 6);
    });

    it("sticks back to a circle near equal sizes", () => {
        let t = halfTurn();
        t = onHandle(t, "p1", { x: 180, y: 200 });
        // 80 wide back to 61: within 5% of 60 deep
        t = onHandle(t, "p1", { x: 161, y: 200 });
        expect(ellipseOf(paramsOf(t))).toBeUndefined();
    });

    it("keeps its degrees, and its degrees then grow round the ellipse", () => {
        let t = halfTurn();
        t = onHandle(t, MIDDLE_KEY, { x: 130, y: 160 });
        const g = arcGuide(paramsOf(t))!;
        const wider = withSweep(paramsOf(t), 270);
        const now = arcGuide(wider)!;
        expect(now.rx).toBeCloseTo(g.rx, 6);
        expect(now.ry).toBeCloseTo(g.ry, 6);
        expect(dist(now.center, g.center)).toBeLessThan(1e-6);
    });

    it("reads its width and depth in the editor and takes typed ones", () => {
        const t = halfTurn();
        const width = arcTool.params.find((q) => q.key === "width")!;
        const depth = arcTool.params.find((q) => q.key === "depth")!;
        expect(width.display(t.params, t.spots, STEP)).toBe("6");
        expect(depth.display(t.params, t.spots, STEP)).toBe("6");
        expect(width.words!(t.params, 7)).toEqual({ before: "Circle" });
        expect(depth.words!(t.params, 7)).toEqual({
            before: "×",
            after: "steps",
        });
        const typed = edit(t, depth.type(t.params, t.spots, "8", env), ctx);
        const g = arcGuide(paramsOf(typed))!;
        expect(g.ry).toBeCloseTo(40, 6);
        expect(width.words!(typed.params, 7)).toEqual({ before: "Ellipse" });
    });

    it("drags width and depth each on its own, both together with constrain", () => {
        const t = edit(halfTurn(), withSweep(paramsOf(halfTurn()), 180), ctx);
        const width = arcTool.params.find((q) => q.key === "width")!;
        const depth = arcTool.params.find((q) => q.key === "depth")!;
        const roles = {
            fine: false,
            constrain: false,
            fromCenter: false,
        } as never;
        const wider = width.scrub(
            t.params,
            7,
            { dx: 16, dy: 0, axis: "x", roles },
            env,
        );
        expect(width.display(wider, 7, STEP)).toBe("7");
        expect(depth.display(wider, 7, STEP)).toBe("6");
        const both = width.scrub(
            t.params,
            7,
            {
                dx: 48,
                dy: 0,
                axis: "x",
                roles: {
                    fine: false,
                    constrain: true,
                    fromCenter: false,
                } as never,
            },
            env,
        );
        expect(width.display(both, 7, STEP)).toBe("9");
        expect(depth.display(both, 7, STEP)).toBe("9");
    });

    it("closes all the way around an ellipse, and opens again", () => {
        let t = halfTurn();
        t = onHandle(t, MIDDLE_KEY, { x: 130, y: 160 });
        const p = paramsOf(t);
        const round = withEnds(p, "circle");
        expect(isArcParams(round)).toBe(true);
        expect(round.points[1]!.ellipse).toEqual(round.points[0]!.ellipse);
        const ends = arcTool.choices!.find((c) => c.key === "ends")!;
        expect(
            ends.options(round, 7).find((o) => o.value === "circle")!.label,
        ).toBe("Close all the way around");
        const g = arcGuide(p)!;
        for (const q of lineFillSpots(round, 8, STEP))
            expect(
                ((q.x - g.center.x) / g.rx) ** 2 +
                    ((q.y - g.center.y) / g.ry) ** 2,
            ).toBeCloseTo(1, 3);
        expect(withEnds(round, "open")).toEqual(p);
    });

    it("turns and mirrors its ellipse with the shape", () => {
        let t = halfTurn();
        t = onHandle(t, MIDDLE_KEY, { x: 130, y: 160 });
        const p = paramsOf(t);
        const frame = lineFrame(p);
        const turned = withLineFrame(p, {
            ...frame,
            rotation: frame.rotation + Math.PI / 2,
        });
        expect(arcGuide(turned)!.ry).toBeCloseTo(40, 6);
        const mirrored = withLineFrame(p, { ...frame, flipY: true });
        const m = arcGuide(mirrored)!;
        expect(m.rx).toBeCloseTo(30, 6);
        expect(m.ry).toBeCloseTo(40, 6);
        for (const q of lineSpots(mirrored, 7)) {
            const dx = q.x - m.center.x;
            const dy = q.y - m.center.y;
            const u = (dx * Math.cos(m.axis) + dy * Math.sin(m.axis)) / m.rx;
            const v = (-dx * Math.sin(m.axis) + dy * Math.cos(m.axis)) / m.ry;
            expect(u * u + v * v).toBeCloseTo(1, 3);
        }
    });
});
