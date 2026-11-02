import { describe, expect, it } from "vitest";
import { arcTool, BEND_KEY } from "../arcTool";
import {
    arcEnds,
    bendOf,
    isArcParams,
    landBend,
    withBend,
    withEnds,
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
 * The Arc (#634): drawn end to end, bent by its middle handle, spaced as a Line, closed by its
 * chord or round to a circle. Driven through the shape session with the real Arc kind.
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

describe("bending it", () => {
    it("takes the sweep from the handle, sticking to 90° and 180°", () => {
        let t = drawn(5, { x: 100, y: 200 }, { x: 160, y: 200 });
        // A half circle's middle is half the chord off it
        t = onHandle(t, BEND_KEY, { x: 131, y: 171 });
        expect(bendOf(paramsOf(t))).toBe(180);
        t = onHandle(t, BEND_KEY, { x: 130, y: 188 });
        // tan(θ/4) = 2h / c → about 87°: sticks to 90
        expect(bendOf(paramsOf(t))).toBe(90);
    });

    it("bends freely in whole degrees with fine held", () => {
        let t = drawn(5, { x: 100, y: 200 }, { x: 160, y: 200 });
        t = onHandle(t, BEND_KEY, { x: 130, y: 188 }, fine);
        const bend = bendOf(paramsOf(t));
        expect(bend).toBe(Math.round(bend));
        expect(bend).not.toBe(90);
    });

    it("bows the other way when dragged past the chord", () => {
        let t = drawn(5, { x: 100, y: 200 }, { x: 160, y: 200 });
        t = onHandle(t, BEND_KEY, { x: 130, y: 230 });
        expect(bendOf(paramsOf(t))).toBe(-180);
    });

    it("never turns a full circle", () => {
        let t = drawn(5, { x: 100, y: 200 }, { x: 160, y: 200 });
        t = onHandle(t, BEND_KEY, { x: 130, y: -5000 });
        expect(Math.abs(bendOf(paramsOf(t)))).toBeLessThanOrEqual(359);
    });

    it("reads its sweep in the editor and takes a typed one", () => {
        const t = drawn(5, { x: 100, y: 200 }, { x: 160, y: 200 });
        const bend = arcTool.params.find((p) => p.key === "bend")!;
        expect(bend.display(t.params, t.spots, STEP)).toBe("90°");
        const typed = edit(t, bend.type(t.params, t.spots, "120", env), ctx);
        expect(bendOf(paramsOf(typed))).toBe(120);
        expect(arcTool.handleTip!(typed.params, 5, BEND_KEY)).toBe("120°");
    });

    it("keeps a locked interval as it bends, the arc growing from its pivot", () => {
        let t = drawn(5, { x: 100, y: 200 }, { x: 160, y: 200 });
        t = edit(t, arcTool.lock!.toggle(t.params, t.spots, env), ctx);
        const before = linePath(paramsOf(t)).length;
        t = onHandle(t, BEND_KEY, { x: 131, y: 171 });
        expect(bendOf(paramsOf(t))).toBe(180);
        expect(linePath(paramsOf(t)).length).toBeCloseTo(before, 6);
    });

    it("lands a sweep on the common ones within a few degrees", () => {
        expect(landBend(87, env)).toBe(90);
        expect(landBend(-176, env)).toBe(-180);
        expect(landBend(100, env)).toBe(100);
        expect(landBend(87.4, fine)).toBe(87);
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
            expect(dist(end, circle!.center)).toBeCloseTo(circle!.r, 9);
        expect(arcTool.construction!(withEnds(p, "chord"), 5)).toHaveLength(1);
    });

    it("shows none once it's closed to a circle", () => {
        expect(arcTool.construction!(withEnds(arc(90), "circle"), 5)).toEqual(
            [],
        );
    });
});
