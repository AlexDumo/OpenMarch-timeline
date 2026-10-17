import { describe, expect, it } from "vitest";
import { blockKind } from "../kinds/block";
import {
    boxFrame,
    drawBox,
    filesOf,
    insideBox,
    ranksOf,
    stretchBox,
    type BoxParams,
} from "../box/boxGeometry";
import { boxTool } from "../box/boxTool";
import {
    DEGREE,
    flipFrame,
    pivotPoint,
    resizeCursor,
    rotateFrame,
    rotationDegrees,
    snapRotation,
    type ShapeFrame,
} from "../frame/frame";
import {
    dragShape,
    frameControls,
    shapeTargetAt,
    startShapeGesture,
} from "../frame/gestures";
import {
    flipBox,
    scrubSize,
    scrubSpacing,
    turnBy,
    withRanks,
    withSpacing,
} from "../editor/boxEdits";
import { parseSize, parseSteps, scrubValue } from "../editor/scrub";
import {
    edit,
    openTool,
    pointerMove,
    press,
    release,
    setOrder,
    targetsOf,
} from "../tool/toolMachine";
import type { ToolEnv } from "../tool/toolKind";
import type { ShapeContext, XY } from "../types";

const STEP = 10;
const half = STEP / 2;
const snapHalf = (v: number) => Math.round(v / half) * half;
const env = (over: Partial<ToolEnv> = {}): ToolEnv => ({
    stepPx: STEP,
    snap: true,
    shift: false,
    gridSnap: (p) => ({ x: snapHalf(p.x), y: snapHalf(p.y) }),
    hitRadius: 3,
    ...over,
});
const ctx: ShapeContext = { stepPx: STEP, snapPoint: (p) => p };
const close = (a: XY, b: XY) =>
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6);

const frame = (over: Partial<ShapeFrame> = {}): ShapeFrame => ({
    center: { x: 100, y: 100 },
    halfWidth: 20,
    halfDepth: 10,
    rotation: 0,
    flipX: false,
    flipY: false,
    ...over,
});

/** A 4 × 2 box, 10 apart, its back-left marcher at 0, 0 */
const box4x2 = (): BoxParams =>
    drawBox({ x: 0, y: 0 }, { x: 30, y: 10 }, 8, env())!;

describe("the shape frame", () => {
    it("turns around a pivot, which stays put", () => {
        const f = frame();
        const pivot = pivotPoint(f, "nw");
        const turned = rotateFrame(f, 90 * DEGREE, pivot);
        close(pivotPoint(turned, "nw"), pivot);
        // Around the center, the center stays
        close(rotateFrame(f, 1, f.center).center, f.center);
    });

    it("flips about a pivot on the field's axes", () => {
        const f = frame();
        // About the center: nothing moves but the mirror
        const c = flipFrame(f, "across", "c");
        close(c.center, f.center);
        expect(c.flipX).toBe(true);
        // About the west edge: the shape lands on the other side of it
        const w = flipFrame(f, "across", "w");
        close(w.center, { x: 60, y: 100 });
        // A turned frame flips on the field, side 1 and side 2 swapping: turned the other way
        const turned = flipFrame(
            frame({ rotation: 30 * DEGREE }),
            "across",
            "c",
        );
        expect(rotationDegrees(turned.rotation)).toBe(330);
        expect(turned.flipX).toBe(true);
    });

    it("snaps rotation to whole degrees, 15° with Shift, and not with Alt", () => {
        expect(
            rotationDegrees(
                snapRotation(33.4 * DEGREE, { shift: false, snap: true }),
            ),
        ).toBe(33);
        expect(
            rotationDegrees(
                snapRotation(33.4 * DEGREE, { shift: true, snap: true }),
            ),
        ).toBe(30);
        expect(
            rotationDegrees(
                snapRotation(33.4 * DEGREE, { shift: false, snap: false }),
            ),
        ).toBe(33.4);
        expect(snapRotation(-0.1 * DEGREE, { shift: false, snap: true })).toBe(
            0,
        );
        expect(rotationDegrees(-90 * DEGREE)).toBe(270);
    });

    it("turns resize cursors with the shape", () => {
        expect(resizeCursor({ rotation: 0 }, { x: 1, y: 0 })).toBe("ew-resize");
        expect(resizeCursor({ rotation: 90 * DEGREE }, { x: 1, y: 0 })).toBe(
            "ns-resize",
        );
        expect(resizeCursor({ rotation: 45 * DEGREE }, { x: 1, y: 0 })).toBe(
            "nwse-resize",
        );
    });
});

describe("a turned box", () => {
    const turned = (degrees: number) =>
        turnBy(box4x2(), 8, degrees, "c", env());

    it("stays the same box: same count, spacing and center", () => {
        const b = box4x2();
        const t = turned(30);
        expect(filesOf(t)).toBe(4);
        expect(ranksOf(t, 8)).toBe(2);
        expect(t.across).toBe(b.across);
        close(t.center, b.center);
        expect(rotationDegrees(t.rotation)).toBe(30);
    });

    it("lands on the grid again at a quarter turn", () => {
        const spots = blockKind.generate(turned(90), 8, ctx);
        for (const s of spots) {
            expect(s.x).toBeCloseTo(snapHalf(s.x), 6);
            expect(s.y).toBeCloseTo(snapHalf(s.y), 6);
        }
    });

    it("stretches along its own axes, the opposite side staying put", () => {
        const t = turned(90);
        const f = boxFrame(t, 8);
        // Turned a quarter, its east handle points down the field
        const east = { x: f.center.x, y: f.center.y + f.halfWidth };
        const fixed = { x: f.center.x, y: f.center.y - f.halfWidth };
        const s = stretchBox(t, 8, "e", { x: east.x, y: east.y + 30 }, env());
        const sf = boxFrame(s, 8);
        expect(s.across).toBe(20);
        close({ x: sf.center.x, y: sf.center.y - sf.halfWidth }, fixed);
    });

    it("is grabbed inside its own outline, not its field-square bounds", () => {
        const t = turned(45);
        expect(insideBox(t, 8, t.center)).toBe(true);
        // A corner of the unturned box is outside the turned one
        expect(insideBox(t, 8, { x: -5, y: -5 })).toBe(false);
    });
});

describe("frame gestures", () => {
    it("the knob above the back edge turns the box around the pivot", () => {
        const b = box4x2();
        const e = env();
        const { knob } = frameControls(boxTool, b, 8, e);
        expect(shapeTargetAt(boxTool, b, 8, knob, e)).toEqual({
            type: "rotate",
            from: "knob",
        });
        const g = startShapeGesture(boxTool, b, 8, knob, e)!;
        // Drag the knob a quarter turn clockwise around the center
        const r = Math.hypot(knob.x - b.center.x, knob.y - b.center.y);
        const turned = dragShape(
            boxTool,
            8,
            g,
            { x: b.center.x + r, y: b.center.y },
            e,
        ) as BoxParams;
        expect(rotationDegrees(turned.rotation)).toBe(90);
    });

    it("just outside a corner turns it too, and the middle is the center dot", () => {
        const b = box4x2();
        const e = env();
        expect(shapeTargetAt(boxTool, b, 8, { x: -4, y: -4 }, e)).toEqual({
            type: "rotate",
            from: "corner",
        });
        expect(shapeTargetAt(boxTool, b, 8, b.center, e)).toEqual({
            type: "center",
        });
        expect(shapeTargetAt(boxTool, b, 8, { x: 200, y: 200 }, e)).toBe(null);
    });

    it("the center dot moves the box in half steps", () => {
        const b = box4x2();
        const g = startShapeGesture(boxTool, b, 8, b.center, env())!;
        const moved = dragShape(
            boxTool,
            8,
            g,
            { x: b.center.x + 12, y: b.center.y + 3 },
            env(),
        ) as BoxParams;
        expect(moved.center.x - b.center.x).toBe(10);
        expect(moved.center.y - b.center.y).toBe(5);
    });
});

const marchers = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        at: { x: 300 + i * 7, y: 300 },
        drillRank: i,
    }));

/** The tool with a 4 × 2 box drawn and released for 8 marchers */
function drawnTool() {
    let t = openTool(boxTool, marchers(8));
    t = press(t, { x: 0, y: 0 }, env());
    t = pointerMove(t, { x: 30, y: 10 }, env());
    return release(t, ctx);
}

describe("who goes where, held through turns and flips", () => {
    it("a turn keeps each marcher on their own spot, turned with the form", () => {
        const t = drawnTool();
        const before = targetsOf(t, ctx);
        const turned = edit(
            t,
            turnBy(t.params as BoxParams, 8, 180, "c", env()),
            ctx,
        );
        const after = targetsOf(turned, ctx);
        expect(after.map((a) => a.slot)).toEqual(before.map((b) => b.slot));
        // Half a turn about the center: each marcher's spot mirrors through it
        const c = (t.params as BoxParams).center;
        after.forEach((a, i) =>
            close(a.to, {
                x: 2 * c.x - before[i]!.to.x,
                y: 2 * c.y - before[i]!.to.y,
            }),
        );
    });

    it("a flip mirrors the form: who was on the left is on the right", () => {
        const t = drawnTool();
        const before = targetsOf(t, ctx);
        const flipped = edit(
            t,
            flipBox(t.params as BoxParams, 8, "across", "c", env()),
            ctx,
        );
        const after = targetsOf(flipped, ctx);
        const c = (t.params as BoxParams).center;
        after.forEach((a, i) => {
            expect(a.to.x).toBeCloseTo(2 * c.x - before[i]!.to.x, 6);
            expect(a.to.y).toBeCloseTo(before[i]!.to.y, 6);
        });
    });

    it("a turned box flips side to side on the field, each spot to its mirror image", () => {
        let t = drawnTool();
        t = edit(t, turnBy(t.params as BoxParams, 8, 30, "c", env()), ctx);
        const before = targetsOf(t, ctx);
        const c = (t.params as BoxParams).center;
        const flipped = targetsOf(
            edit(
                t,
                flipBox(t.params as BoxParams, 8, "across", "c", env()),
                ctx,
            ),
            ctx,
        );
        flipped.forEach((a, i) => {
            expect(a.to.x).toBeCloseTo(2 * c.x - before[i]!.to.x, 6);
            expect(a.to.y).toBeCloseTo(before[i]!.to.y, 6);
        });
    });

    it("a stretch or move keeps spots; a new count across works it out again", () => {
        const t = drawnTool();
        const slots = targetsOf(t, ctx).map((x) => x.slot);
        const wider = edit(
            t,
            withSpacing(t.params as BoxParams, "across", 2, 8, env()),
            ctx,
        );
        expect(targetsOf(wider, ctx).map((x) => x.slot)).toEqual(slots);
        const twoDeep = edit(
            t,
            withRanks(t.params as BoxParams, 8, 4, env()),
            ctx,
        );
        expect(filesOf(twoDeep.params as BoxParams)).toBe(2);
        expect(twoDeep.assignment).not.toBe(t.assignment);
    });

    it("drill order lays them out again, as one undo step", () => {
        const t = drawnTool();
        const drill = setOrder(t, "drill", ctx);
        expect(drill.order).toBe("drill");
        expect(drill.past.length).toBe(t.past.length + 1);
    });
});

describe("the floating editor's numbers", () => {
    it("spacing drags half a step per 8 px, tenths with Alt, from where it started", () => {
        const b = box4x2();
        expect(scrubSpacing(b, "across", 16, 0, 8, env()).across).toBe(20);
        // Up for more front to back
        expect(scrubSpacing(b, "deep", 0, -8, 8, env()).deep).toBe(15);
        expect(
            scrubSpacing(b, "across", 8, 0, 8, env({ snap: false })).across,
        ).toBeCloseTo(11);
        // Back where it started: unchanged, not rounded
        const odd = { ...b, across: 12.3 };
        expect(scrubSpacing(odd, "across", 3, 0, 8, env())).toBe(odd);
        // Never under half a step
        expect(scrubSpacing(b, "across", -400, 0, 8, env()).across).toBe(5);
    });

    it("the ratio lock moves the other spacing, both on half steps", () => {
        const b = { ...box4x2(), deep: 20 };
        const locked = withSpacing(
            b,
            "across",
            1.5,
            8,
            env({ ratioLocked: true }),
        );
        expect(locked.across).toBe(15);
        expect(locked.deep).toBe(30);
        // 4.5 apart makes 5.14 exactly; on half steps it's 5
        const odd = { ...b, across: 35, deep: 40 };
        const r = withSpacing(
            odd,
            "across",
            4.5,
            8,
            env({ ratioLocked: true }),
        );
        expect(r.deep).toBe(50);
    });

    it("the size drags sideways for across, up or down for deep", () => {
        const b = box4x2();
        expect(filesOf(scrubSize(b, "x", 32, 0, 8, env()))).toBe(6);
        // Up for one more rank: 8 in 3 deep is 3 across
        expect(filesOf(scrubSize(b, "y", 0, -16, 8, env()))).toBe(3);
        // 13 in 2 deep is 7 across
        expect(
            filesOf(
                withRanks(
                    drawBox({ x: 0, y: 0 }, { x: 60, y: 10 }, 13, env())!,
                    13,
                    2,
                    env(),
                ),
            ),
        ).toBe(7);
    });

    it("reads typed steps and sizes", () => {
        expect(parseSteps("2½")).toBe(2.5);
        expect(parseSteps("2 1/2")).toBe(2.5);
        expect(parseSteps("½")).toBe(0.5);
        expect(parseSteps("3 steps")).toBe(3);
        expect(parseSteps("0")).toBe(null);
        expect(parseSteps("abc")).toBe(null);
        expect(parseSize("6 × 2")).toEqual({ across: 6, deep: 2 });
        expect(parseSize("6x2")).toEqual({ across: 6, deep: 2 });
        expect(parseSize("6")).toEqual({ across: 6 });
        expect(parseSize("x")).toBe(null);
        expect(scrubValue(4, 0, -20, { axis: "y", px: 8, step: 1 })).toBe(6);
    });
});
