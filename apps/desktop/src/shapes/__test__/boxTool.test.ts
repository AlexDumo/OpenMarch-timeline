import { describe, expect, it } from "vitest";
import { blockKind } from "../kinds/block";
import {
    changeFiles,
    drawBox,
    filesOf,
    footprintOf,
    ranksOf,
    splitFor,
    stretchBox,
    type BoxParams,
} from "../box/boxGeometry";
import { boxTool } from "../box/boxTool";
import {
    cancelGesture,
    edit,
    openTool,
    pointerMove,
    press,
    release,
    targetsOf,
    undo,
    redo,
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
const onGrid = (p: XY) =>
    Math.abs(p.x - snapHalf(p.x)) < 1e-9 &&
    Math.abs(p.y - snapHalf(p.y)) < 1e-9;
const marchers = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        at: { x: 300 + i * 7, y: 300 },
        drillRank: i,
    }));

describe("drawing a box", () => {
    it("splits the marchers into near-square cells", () => {
        // 16 marchers in a square: 4 by 4
        const box = drawBox({ x: 0, y: 0 }, { x: 80, y: 80 }, 16, env())!;
        expect(filesOf(box)).toBe(4);
        expect(ranksOf(box, 16)).toBe(4);
        expect(box.across).toBe(20);
        expect(box.deep).toBe(20);
        // A wide box: more files than ranks
        const wide = drawBox({ x: 0, y: 0 }, { x: 160, y: 40 }, 16, env())!;
        expect(filesOf(wide)).toBe(8);
        expect(ranksOf(wide, 16)).toBe(2);
    });

    it("rounds intervals to half steps, never under half a step", () => {
        const box = drawBox({ x: 0, y: 0 }, { x: 87, y: 83 }, 16, env())!;
        expect(box.across % half).toBe(0);
        expect(box.deep % half).toBe(0);
        const tiny = drawBox({ x: 0, y: 0 }, { x: 6, y: 6 }, 16, env())!;
        expect(tiny.across).toBe(half);
        expect(tiny.deep).toBe(half);
    });

    it("puts every full-rank marcher on the half-step grid", () => {
        const box = drawBox({ x: 1.3, y: 2.2 }, { x: 93, y: 71 }, 12, env())!;
        const slots = blockKind.generate(box, 12, ctx);
        expect(slots.every(onGrid)).toBe(true);
    });

    it("reads the rectangle as the footprint: marchers half an interval inside", () => {
        const box = drawBox({ x: 0, y: 0 }, { x: 40, y: 40 }, 4, env())!;
        const f = footprintOf(box, 4);
        expect(f).toEqual({ left: 0, top: 0, right: 40, bottom: 40 });
        const slots = blockKind.generate(box, 4, ctx);
        expect(slots.map((s) => [s.x, s.y])).toEqual([
            [10, 10],
            [30, 10],
            [10, 30],
            [30, 30],
        ]);
    });

    it("puts a short rank at the back, centered", () => {
        // 5 marchers, 2 files: 3 ranks, the back one short
        const box = drawBox({ x: 0, y: 0 }, { x: 40, y: 60 }, 5, env())!;
        expect(filesOf(box)).toBe(2);
        const slots = blockKind.generate(box, 5, ctx);
        const back = Math.min(...slots.map((s) => s.y));
        const backRank = slots.filter((s) => s.y === back);
        expect(backRank).toHaveLength(1);
        expect(backRank[0]!.x).toBe(box.center.x);
    });

    it("draws the same box whichever corner the drag starts from", () => {
        const a = drawBox({ x: 0, y: 0 }, { x: 80, y: 60 }, 12, env())!;
        const b = drawBox({ x: 80, y: 60 }, { x: 0, y: 0 }, 12, env())!;
        expect(footprintOf(b, 12)).toEqual(footprintOf(a, 12));
    });

    it("Shift makes the intervals equal", () => {
        const box = drawBox(
            { x: 0, y: 0 },
            { x: 120, y: 40 },
            4,
            env({ shift: true }),
        )!;
        expect(box.across).toBe(box.deep);
    });

    it("Alt doesn't round", () => {
        const box = drawBox(
            { x: 0, y: 0 },
            { x: 83, y: 83 },
            16,
            env({ snap: false }),
        )!;
        expect(box.across).toBeCloseTo(83 / 4);
    });

    it("keeps the file count until another fits clearly better", () => {
        // 12 marchers in a square: 3 files (4 ranks) and 4 files (3 ranks) fit equally well
        expect(splitFor(105, 100, 12)).toBe(4);
        // A little wider, 4 fits better, but not by enough to leave 3
        expect(splitFor(105, 100, 12, 3)).toBe(3);
        // Wider still, it changes
        expect(splitFor(120, 100, 12, 3)).toBe(4);
    });

    it("is too short under half a step", () => {
        expect(drawBox({ x: 0, y: 0 }, { x: 2, y: 1 }, 4, env())).toBe(
            undefined,
        );
    });
});

describe("editing a box", () => {
    const box = drawBox({ x: 0, y: 0 }, { x: 80, y: 80 }, 16, env())!;

    it("a corner stretches both intervals and keeps files, ranks and the opposite corner", () => {
        const out = stretchBox(box, 16, "se", { x: 120, y: 100 }, env());
        expect(filesOf(out)).toBe(4);
        expect(ranksOf(out, 16)).toBe(4);
        expect(out.across).toBe(30);
        expect(out.deep).toBe(25);
        // The fixed corner stays put, give or take the quarter step that puts marchers on the
        // grid when an interval is an odd number of half steps
        const f = footprintOf(out, 16);
        expect(Math.abs(f.left)).toBeLessThanOrEqual(half / 2);
        expect(Math.abs(f.top)).toBeLessThanOrEqual(half / 2);
    });

    it("a side stretches only its own axis", () => {
        const out = stretchBox(box, 16, "e", { x: 120, y: 999 }, env());
        expect(out.across).toBe(30);
        expect(out.deep).toBe(box.deep);
        const f = footprintOf(out, 16);
        expect([f.left, f.top, f.bottom]).toEqual([0, 0, 80]);
    });

    it("the file count changes around the center, keeping the intervals", () => {
        const out = changeFiles(box, 16, 1, env());
        expect(filesOf(out)).toBe(5);
        expect(out.across).toBe(box.across);
        expect(out.deep).toBe(box.deep);
        // Within a quarter step of the old center: its marchers snap to the grid
        expect(Math.abs(out.center.x - box.center.x)).toBeLessThanOrEqual(
            half / 2,
        );
        expect(Math.abs(out.center.y - box.center.y)).toBeLessThanOrEqual(
            half / 2,
        );
        expect(changeFiles(box, 16, -99, env()).files).toBe(1);
        expect(changeFiles(box, 16, 99, env()).files).toBe(16);
    });
});

describe("the tool's state machine", () => {
    const n = 16;
    const start = () => openTool(boxTool, marchers(n));
    const drawn = () => {
        let s = press(start(), { x: 0, y: 0 }, env());
        s = pointerMove(s, { x: 80, y: 80 }, env());
        return release(s, ctx);
    };

    it("a drag on empty field draws a box, assigned on release", () => {
        let s = press(start(), { x: 0, y: 0 }, env());
        expect(s.gesture?.type).toBe("draw");
        s = pointerMove(s, { x: 80, y: 80 }, env());
        // Nobody is assigned while drawing
        expect(s.assignment).toBe(null);
        s = release(s, ctx);
        expect(s.gesture).toBe(null);
        expect(s.assignment).toHaveLength(n);
        expect(new Set(s.assignment).size).toBe(n);
        expect(targetsOf(s, ctx)).toHaveLength(n);
        expect(s.past).toHaveLength(1);
    });

    it("holds who goes where during a gesture", () => {
        const s = drawn();
        let g = press(s, { x: 40, y: 40 }, env());
        expect(g.gesture?.type).toBe("move");
        g = pointerMove(g, { x: 200, y: 40 }, env());
        expect(g.assignment).toBe(s.assignment);
        g = release(g, ctx);
        expect(g.past).toHaveLength(2);
    });

    it("a press on a handle drags it", () => {
        const s = drawn();
        const g = press(s, { x: 81, y: 81 }, env());
        expect(g.gesture).toMatchObject({ type: "handle", key: "se" });
    });

    it("a drag outside the box replaces it, one undo step back", () => {
        const s = drawn();
        let g = press(s, { x: 200, y: 200 }, env());
        expect(g.gesture?.type).toBe("draw");
        g = release(pointerMove(g, { x: 300, y: 260 }, env()), ctx);
        expect(
            Math.abs(footprintOf(g.params as BoxParams, n).left - 200),
        ).toBeLessThanOrEqual(half / 2);
        const back = undo(g);
        expect(back.params).toBe(s.params);
        expect(redo(back).params).toBe(g.params);
    });

    it("a click without a drag changes nothing and leaves nothing to undo", () => {
        const s = drawn();
        const g = release(press(s, { x: 200, y: 200 }, env()), ctx);
        expect(g.params).toBe(s.params);
        expect(g.past).toHaveLength(s.past.length);
    });

    it("Escape during a gesture puts everything back", () => {
        const s = drawn();
        const g = pointerMove(
            press(s, { x: 81, y: 81 }, env()),
            { x: 200, y: 200 },
            env(),
        );
        expect(cancelGesture(g)).toMatchObject({
            params: s.params,
            assignment: s.assignment,
            gesture: null,
        });
    });

    it("an edit from the readout is one undo step", () => {
        const s = drawn();
        const more = edit(
            s,
            changeFiles(s.params as BoxParams, n, 1, env()),
            ctx,
        );
        expect(filesOf(more.params as BoxParams)).toBe(5);
        expect(undo(more).params).toBe(s.params);
    });
});
