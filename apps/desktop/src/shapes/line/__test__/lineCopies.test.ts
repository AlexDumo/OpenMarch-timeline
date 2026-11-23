import { describe, expect, it } from "vitest";
import { lineTool, lineToolBase } from "../lineTool";
import { copyOffsets } from "../lineCopies";
import { arcTool } from "../../arc/arcTool";
import { isLineParams, type LineParams } from "../lineGeometry";
import { boxesAt, type PlacedRecipe } from "../../placed/placedBox";
import { placementOf } from "../../tool/shapePlacement";
import type { ToolEnv } from "../../tool/toolKind";
import {
    edit,
    openTool,
    pointerMove,
    press,
    release,
    slotsOf,
    type ToolState,
} from "../../tool/toolMachine";
import type { ShapeContext, XY } from "../../types";

/**
 * Copies of a line (spec #1190, step 1 #1191): rows behind and in front, each the drawn line slid
 * toward a sideline, laid out from the drawn line's own spots
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

function drawn(n: number, from: XY, to: XY): ToolState {
    let t = openTool(lineTool, marchers(n));
    t = press(t, from, env);
    t = pointerMove(t, to, env);
    return release(t, ctx);
}

const param = (key: string) =>
    lineTool.copies!.params.find((p) => p.key === key)!;
const typedCopies = (t: ToolState, key: string, text: string) =>
    edit(t, param(key).type(t.params, t.spots, text, env), ctx);
const paramsOf = (t: ToolState) => t.params as LineParams;
const spotsOf = (t: ToolState) => slotsOf(t, ctx).map(({ x, y }) => ({ x, y }));
const ys = (spots: readonly XY[]) => [...new Set(spots.map((s) => s.y))];

/** 9 marchers on a 80-unit line from (100, 200), then `behind` and `front` rows */
function withRows(n: number, behind: number, front: number) {
    let t = drawn(n, { x: 100, y: 200 }, { x: 180, y: 200 });
    t = typedCopies(t, "copiesBehind", String(behind));
    if (front > 0) t = typedCopies(t, "copiesFront", String(front));
    return t;
}

describe("copies of a line", () => {
    it("lay out as before with none", () => {
        const t = drawn(6, { x: 100, y: 200 }, { x: 180, y: 200 });
        expect(paramsOf(t).copies).toBeUndefined();
        expect(spotsOf(t)).toEqual(
            lineToolBase.shape
                .generate(t.params, 6, ctx)
                .map(({ x, y }) => ({ x, y })),
        );
        expect(lineTool.copies!.summary(t.params, 6)).toBeNull();
    });

    it("start 2 steps apart, the rows slid toward the back sideline", () => {
        const t = withRows(9, 2, 0);
        expect(paramsOf(t).copies).toEqual({
            behind: 2,
            front: 0,
            apart: 2 * STEP,
        });
        // Three rows of 3, front to back: the drawn line, then 2 and 4 steps behind it (−y)
        const spots = spotsOf(t);
        expect(spots).toHaveLength(9);
        expect(ys(spots)).toEqual([200, 180, 160]);
        const row = spots.slice(0, 3).map((s) => s.x);
        expect(spots.slice(3, 6).map((s) => s.x)).toEqual(row);
        expect(lineTool.copies!.summary(t.params, 9)).toBe("2 behind");
    });

    it("put rows in front toward the front sideline, front row first", () => {
        const t = withRows(9, 1, 1);
        expect(ys(spotsOf(t))).toEqual([220, 200, 180]);
        expect(lineTool.copies!.summary(t.params, 9)).toBe(
            "1 behind · 1 in front",
        );
        expect(lineTool.copyOutlines!(t.params, 9)).toHaveLength(2);
    });

    it("leave the back row short when the count doesn't divide, its spots empty", () => {
        // 26 marchers in 3 rows: 9, 9 and 8
        const t = withRows(26, 1, 1);
        const spots = spotsOf(t);
        expect(spots).toHaveLength(26);
        expect(spots.filter((s) => s.y === 180)).toHaveLength(8);
        const empty = lineTool.emptySpots!(t.params, 26);
        expect(empty).toHaveLength(1);
        expect(empty[0]!.y).toBe(180);
    });

    it("give the drawn line its own count, so its interval reads the row", () => {
        const t = withRows(9, 2, 0);
        // 3 a row on 8 steps: 4 steps apart, as the line alone with 3 would be
        const interval = lineTool.params.find((p) => p.key === "interval")!;
        expect(interval.display(t.params, 9, STEP)).toBe(
            lineToolBase.params
                .find((p) => p.key === "interval")!
                .display(t.params, 3, STEP),
        );
    });

    it("follow the drawn line when an end is dragged", () => {
        let t = withRows(9, 1, 0);
        const end = lineTool
            .handles(t.params, t.spots)
            .find((h) => h.key === "p1")!.at;
        t = press(t, end, env);
        t = pointerMove(t, { x: 200, y: 200 }, env);
        t = release(t, ctx);
        expect(paramsOf(t).copies?.behind).toBe(1);
        const spots = spotsOf(t);
        expect(Math.max(...spots.map((s) => s.x))).toBeGreaterThan(180);
        expect(spots.filter((s) => s.y === 180).map((s) => s.x)).toEqual(
            // 9 in 2 rows: 5 and 4, the back row short at the far end
            spots
                .filter((s) => s.y === 200)
                .map((s) => s.x)
                .slice(0, 4),
        );
    });

    it("grab the shape by a copy's row", () => {
        const t = withRows(9, 1, 0);
        expect(lineTool.contains(t.params, 9, { x: 140, y: 180 }, env)).toBe(
            true,
        );
        expect(lineTool.contains(t.params, 9, { x: 140, y: 150 }, env)).toBe(
            false,
        );
    });

    it("change their spacing in steps", () => {
        let t = withRows(9, 1, 0);
        t = typedCopies(t, "copiesApart", "3");
        expect(ys(spotsOf(t))).toEqual([200, 170]);
        expect(param("copiesApart").display(t.params, 9, STEP)).toBe("3");
    });

    it("go away at zero either way, or with Remove copies", () => {
        let t = withRows(9, 1, 0);
        t = typedCopies(t, "copiesBehind", "0");
        expect(paramsOf(t).copies).toBeUndefined();
        t = withRows(9, 2, 0);
        t = edit(t, lineTool.copies!.clear(t.params), ctx);
        expect(paramsOf(t).copies).toBeUndefined();
        expect(spotsOf(t)).toHaveLength(9);
        expect(ys(spotsOf(t))).toEqual([200]);
    });

    it("step one at a time, never below none", () => {
        const t = drawn(9, { x: 100, y: 200 }, { x: 180, y: 200 });
        const behind = param("copiesBehind");
        expect(behind.stepper!.by(t.params, 9, -1, env)).toBeNull();
        const one = behind.stepper!.by(t.params, 9, 1, env)!;
        expect(one.copies).toEqual({ behind: 1, front: 0, apart: 2 * STEP });
    });
});

describe("a line's copies stored", () => {
    it("are read back by this build, and only as an open line's", () => {
        const t = withRows(9, 1, 1);
        expect(isLineParams(t.params)).toBe(true);
        expect(isLineParams({ ...paramsOf(t), closed: true })).toBe(false);
        expect(
            isLineParams({
                ...paramsOf(t),
                copies: { ...paramsOf(t).copies, diagonal: 1 },
            }),
        ).toBe(false);
        expect(
            isLineParams({
                ...paramsOf(t),
                copies: { behind: 0, front: 0, apart: 20 },
            }),
        ).toBe(false);
    });

    it("are placed with the line and reopen with it", () => {
        const t = withRows(9, 1, 1);
        const placement = placementOf(t, ctx)!;
        expect(placement.recipe.params).toMatchObject({
            copies: { behind: 1, front: 1, apart: 20 },
        });
        const recipe: PlacedRecipe = {
            ...placement.recipe,
            id: 1,
            timelineId: 10,
            members: placement.members,
            params: JSON.parse(JSON.stringify(placement.recipe.params)),
        };
        const at = new Map(recipe.members.map((m) => [m.marcherId, m]));
        const [placed] = boxesAt({
            recipes: [recipe],
            endBeatOf: () => 8,
            beat: 8,
            positionOf: (id) => at.get(id),
        });
        expect(placed?.kind).toBe(lineTool);
        expect((placed?.params as LineParams).copies).toEqual({
            behind: 1,
            front: 1,
            apart: 20,
        });
        expect(placed?.spots).toBe(9);
    });
});

describe("copies of an arc", () => {
    it("slide the whole arc back", () => {
        let t = openTool(arcTool, marchers(6));
        t = press(t, { x: 100, y: 200 }, env);
        t = pointerMove(t, { x: 180, y: 200 }, env);
        t = release(t, ctx);
        const one = slotsOf(t, ctx).map(({ x, y }) => ({ x, y }));
        t = edit(
            t,
            param("copiesBehind").type(t.params, t.spots, "1", env),
            ctx,
        );
        expect(paramsOf(t).copies?.behind).toBe(1);
        const both = slotsOf(t, ctx);
        expect(both).toHaveLength(6);
        // 3 a row: the back row is the front row 2 steps back
        const row = arcTool.shape
            .generate(paramsOf(t), 6, ctx)
            .slice(0, 3)
            .map(({ x, y }) => ({ x, y: y - 2 * STEP }));
        both.slice(3).forEach((s, i) => {
            expect(s.x).toBeCloseTo(row[i]!.x, 6);
            expect(s.y).toBeCloseTo(row[i]!.y, 6);
        });
        expect(one).toHaveLength(6);
    });
});

describe("copies to the side (#1192)", () => {
    /** 80 wide from x 100, so a column is 80 + gap from the next */
    const line = (n: number) =>
        drawn(n, { x: 100, y: 200 }, { x: 180, y: 200 });

    it("stand the line's width plus 2 steps apart, left first", () => {
        let t = line(9);
        t = typedCopies(t, "copiesLeft", "1");
        t = typedCopies(t, "copiesRight", "1");
        expect(paramsOf(t).copies).toMatchObject({
            left: 1,
            right: 1,
            gap: 2 * STEP,
        });
        expect(copyOffsets(paramsOf(t))).toEqual([
            { x: -100, y: 0 },
            { x: 0, y: 0 },
            { x: 100, y: 0 },
        ]);
        const spots = spotsOf(t);
        expect(spots).toHaveLength(9);
        expect(Math.min(...spots.map((s) => s.x))).toBe(0);
        expect(Math.max(...spots.map((s) => s.x))).toBe(280);
        expect(lineTool.copies!.summary(t.params, 9)).toBe("1 left · 1 right");
    });

    it("follow the line's length as it's reshaped", () => {
        let t = typedCopies(line(6), "copiesRight", "1");
        t = edit(
            t,
            lineTool
                .copies!.params.find((p) => p.key === "copiesGap")!
                .type(t.params, t.spots, "0", env),
            ctx,
        );
        expect(copyOffsets(paramsOf(t))[1]).toEqual({ x: 80, y: 0 });
        const longer: LineParams = {
            ...paramsOf(t),
            points: [paramsOf(t).points[0]!, { x: 220, y: 200, tension: 0 }],
        };
        expect(copyOffsets(longer)[1]).toEqual({ x: 120, y: 0 });
    });

    it("make a grid with rows, front row first", () => {
        let t = typedCopies(line(12), "copiesBehind", "1");
        t = typedCopies(t, "copiesRight", "1");
        expect(copyOffsets(paramsOf(t))).toEqual([
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 0, y: -20 },
            { x: 100, y: -20 },
        ]);
        expect(slotsOf(t, ctx)).toHaveLength(12);
    });

    it("stagger each row further right than the one in front", () => {
        let t = typedCopies(line(9), "copiesBehind", "1");
        t = typedCopies(t, "copiesFront", "1");
        t = typedCopies(t, "copiesStagger", "1");
        expect(copyOffsets(paramsOf(t))).toEqual([
            { x: -10, y: 20 },
            { x: 0, y: 0 },
            { x: 10, y: -20 },
        ]);
        t = typedCopies(t, "copiesStagger", "-½");
        expect(copyOffsets(paramsOf(t))[2]).toEqual({ x: -5, y: -20 });
        expect(param("copiesStagger").display(t.params, 9, STEP)).toBe("−½");
    });

    it("go the field's way, or the line's own as turned", () => {
        const t = typedCopies(line(6), "copiesBehind", "1");
        const turned: LineParams = { ...paramsOf(t), turn: 90 };
        // The field's way: behind is toward the back sideline whatever the turn
        expect(copyOffsets(turned)[1]).toEqual({ x: 0, y: -20 });
        const shape = lineTool.copies!.direction!.pick(turned, "shape");
        expect(lineTool.copies!.direction!.current(shape)).toBe("shape");
        // Turned a quarter clockwise, its front faces stage left, so behind is to the right
        const [, behind] = copyOffsets(shape);
        expect(behind!.x).toBeCloseTo(20, 9);
        expect(behind!.y).toBeCloseTo(0, 9);
        expect(
            lineTool.copies!.direction!.pick(shape, "field").copies?.direction,
        ).toBeUndefined();
        expect(isLineParams(shape)).toBe(true);
    });

    it("hide the row numbers without rows and the gap without columns", () => {
        const t = typedCopies(line(6), "copiesRight", "1");
        const shown = lineTool
            .copies!.params.filter((p) => p.shown?.(t.params, 6) ?? true)
            .map((p) => p.key);
        expect(shown).toEqual([
            "copiesBehind",
            "copiesFront",
            "copiesLeft",
            "copiesRight",
            "copiesGap",
        ]);
    });
});
