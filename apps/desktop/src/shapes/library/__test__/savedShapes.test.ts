import { describe, expect, it } from "vitest";
import { boxTool } from "../../box/boxTool";
import { filesOf, ranksOf, type BoxParams } from "../../box/boxGeometry";
import {
    savedShapeOf,
    savedShapeRows,
    savedToolKind,
    suggestedName,
    intervalsOf,
} from "../savedShapes";
import { placementOf } from "../../tool/shapePlacement";
import { shapeSteps, startingParams } from "../../command/shapeSteps";
import type { AnyToolKind, ToolEnv } from "../../tool/toolKind";
import {
    edit,
    openTool,
    pointerMove,
    press,
    release,
    switchKind,
    type ToolState,
} from "../../tool/toolMachine";
import type { ShapeContext, XY } from "../../types";
import { rowTool, type RowParams } from "../../__test__/fakeRowKind";

/**
 * Saved shapes (#353): saving keeps a shape's kind and intervals, not its size or count, so a
 * saved shape applied to another selection lays out that many spots the saved distance apart.
 * Driven through the shape session with the box and a fake kind.
 */

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
const marchers = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        at: { x: 300 + i * 7, y: 300 },
        drillRank: i,
    }));

function drawn(kind: AnyToolKind, n: number, from: XY, to: XY): ToolState {
    let t = openTool(kind, marchers(n));
    t = press(t, from, env());
    t = pointerMove(t, to, env());
    return release(t, ctx);
}

/** A box of 6 drawn 2 steps apart, then widened to 3 across and 1½ deep in the chip */
function wideBox(): ToolState {
    const t = drawn(boxTool, 6, { x: 0, y: 0 }, { x: 40, y: 20 });
    const [, across, deep] = boxTool.params;
    let params = across!.type(t.params, 6, "3", env())!;
    params = deep!.type(params, 6, "1.5", env())!;
    return edit(t, params, ctx);
}

const SAVED = { id: "s1", name: "Wide box" };

describe("saving a shape", () => {
    it("keeps the kind and its intervals in steps, not its size or count", () => {
        const t = wideBox();
        const saved = savedShapeOf(t.kind, t.params, t.spots, STEP, SAVED);
        expect(saved).toEqual({
            id: "s1",
            name: "Wide box",
            kind: boxTool.shape.id,
            kindVersion: boxTool.shape.version,
            intervals: { across: 3, deep: 1.5 },
        });
    });

    it("works for a kind the host doesn't know", () => {
        const t = drawn(rowTool, 5, { x: 0, y: 0 }, { x: 60, y: 0 });
        const saved = savedShapeOf(t.kind, t.params, t.spots, STEP, SAVED);
        expect(saved.kind).toBe(rowTool.shape.id);
        expect(saved.intervals).toEqual({
            gap: (t.params as RowParams).gap / STEP,
        });
    });

    it("offers the kind and its spacing as the name", () => {
        const t = wideBox();
        expect(suggestedName(t.kind, t.params, t.spots, STEP)).toBe(
            "Box 3 × 1½ apart",
        );
    });

    it("saving a shape opened from a saved one names the basic kind", () => {
        const kind = savedToolKind(rowTool, {
            ...SAVED,
            kind: rowTool.shape.id,
            kindVersion: 1,
            intervals: { gap: 3 },
        });
        const t = drawn(kind, 4, { x: 0, y: 0 }, { x: 50, y: 0 });
        const again = savedShapeOf(t.kind, t.params, t.spots, STEP, {
            id: "s2",
            name: "Again",
        });
        expect(again.kind).toBe(rowTool.shape.id);
        expect(again.intervals).toEqual({ gap: 3 });
    });
});

describe("applying a saved shape to another selection", () => {
    const saved = () => savedShapeOf(boxTool, wideBox().params, 6, STEP, SAVED);

    it("keeps its intervals and fits the new count", () => {
        const kind = savedToolKind(boxTool, saved());
        for (const n of [4, 12, 15]) {
            const t = drawn(kind, n, { x: 0, y: 0 }, { x: 80, y: 40 });
            const p = t.params as BoxParams;
            expect(filesOf(p) * ranksOf(p, n)).toBeGreaterThanOrEqual(n);
            expect(intervalsOf(boxTool, p, n, STEP)).toEqual({
                across: 3,
                deep: 1.5,
            });
            // The placed recipe is an ordinary box: it reopens without the saved shape
            expect(placementOf(t, ctx)?.recipe.kind).toBe(boxTool.shape.id);
            expect(placementOf(t, ctx)?.members).toHaveLength(n);
        }
    });

    it("keeps the corner the drag started from", () => {
        const kind = savedToolKind(boxTool, saved());
        const t = drawn(kind, 8, { x: 0, y: 0 }, { x: 70, y: 30 });
        const frame = boxTool.frameOf(t.params, 8);
        expect(frame.center.x - frame.halfWidth).toBeCloseTo(0);
        expect(frame.center.y - frame.halfDepth).toBeCloseTo(0);
    });

    it("turns an open shape into it keeping the frame's center", () => {
        const kind = savedToolKind(boxTool, saved());
        const open = drawn(boxTool, 9, { x: 0, y: 0 }, { x: 40, y: 40 });
        const switched = switchKind(open, kind, ctx, env());
        expect(switched.kind).toBe(kind);
        expect(intervalsOf(boxTool, switched.params, 9, STEP)).toEqual({
            across: 3,
            deep: 1.5,
        });
        expect(boxTool.frameOf(switched.params, 9).center).toEqual(
            boxTool.frameOf(open.params, 9).center,
        );
    });

    it("works for a kind the host doesn't know", () => {
        const kind = savedToolKind(rowTool, {
            ...SAVED,
            kind: rowTool.shape.id,
            kindVersion: 1,
            intervals: { gap: 2.5 },
        });
        const t = drawn(kind, 7, { x: 0, y: 0 }, { x: 100, y: 0 });
        expect((t.params as RowParams).gap).toBe(25);
    });

    it("starts the command bar's steps from the saved intervals", () => {
        const kind = savedToolKind(boxTool, saved());
        const starts = marchers(10).map((m) => m.at);
        const base = startingParams(kind, starts, 10, env());
        expect(intervalsOf(boxTool, base, 10, STEP)).toEqual({
            across: 3,
            deep: 1.5,
        });
        const { steps } = shapeSteps(kind, base, 10, env(), []);
        expect(steps.map((s) => [s.param.key, s.initial])).toEqual([
            ["size", expect.any(String)],
            ["across", "3"],
            ["deep", "1½"],
            ["layout", expect.any(String)],
        ]);
    });

    it("is the same kind each time, so pickers can tell it's armed", () => {
        expect(savedToolKind(boxTool, saved())).toBe(
            savedToolKind(boxTool, saved()),
        );
    });
});

describe("the library's Saved group", () => {
    const tools = [{ kind: boxTool, action: "shapeBlock" as const }];
    const shape = (id: string, name: string) => ({
        id,
        name,
        kind: boxTool.shape.id,
        kindVersion: 1,
        intervals: { across: 2, deep: 2 },
    });

    it("lists the user's saved shapes, then those only the open show has", () => {
        const rows = savedShapeRows(
            [shape("a", "Mine")],
            [shape("a", "Mine"), shape("b", "From the show")],
            tools,
        );
        expect(
            rows.map((r) => [r.id, r.label, r.note, r.saved?.inLibrary]),
        ).toEqual([
            ["a", "Mine", "Box · 2 apart", true],
            ["b", "From the show", "Box · 2 apart · this show only", false],
        ]);
        expect(rows.every((r) => r.group === "saved")).toBe(true);
    });

    it("leaves out a saved shape of a kind this app doesn't have", () => {
        expect(
            savedShapeRows(
                [{ ...shape("a", "Arc"), kind: "arc-from-later" }],
                [],
                tools,
            ),
        ).toEqual([]);
    });
});
