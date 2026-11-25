import { describe, expect, it } from "vitest";
import { lineTool } from "../lineTool";
import type { LineParams } from "../lineGeometry";
import { liveTargets } from "../../placed/liveBox";
import {
    boxesAt,
    type PlacedBox,
    type PlacedRecipe,
} from "../../placed/placedBox";
import { withPlacedOrder } from "../../placed/placedOrder";
import type { ToolEnv } from "../../tool/toolKind";
import {
    clearPins,
    openTool,
    orderRefusal,
    pinPairs,
    pointerMove,
    press,
    release,
    setOrder,
    swapMarchers,
    takeHandOrder,
    targetsOf,
    undo,
    type ToolState,
} from "../../tool/toolMachine";
import {
    crossings,
    halvesFlipped,
    orderChoiceOf,
    orderFields,
    withPins,
    type AssignMarcher,
    type OrderChoice,
} from "../../assign";
import type { ShapeContext, XY } from "../../types";

/**
 * Who goes where's options, picking by hand and Swap (09-who-goes-where.md), driven through the
 * shape session with the real Line kind
 */

const STEP = 10;
const half = STEP / 2;
const snapHalf = (v: number) => Math.round(v / half) * half;
const env: ToolEnv = {
    stepPx: STEP,
    snap: true,
    constrain: false,
    gridSnap: (p) => ({ x: snapHalf(p.x), y: snapHalf(p.y) }),
    hitRadius: 3,
};
const ctx: ShapeContext = { stepPx: STEP, snapPoint: (p) => p };

/** A placed Line of `ids` along `y`, its first spot at the left */
function placedLine(id: number, ids: number[], y: number, x0 = 100): PlacedBox {
    const params: LineParams = {
        points: [
            { x: x0, y, tension: 0 },
            { x: x0 + 20 * (ids.length - 1), y, tension: 0 },
        ],
        spacing: { mode: "fit" },
    };
    const slots = lineTool.shape.generate(params, ids.length, ctx);
    const recipe: PlacedRecipe = {
        id,
        timelineId: 10,
        kind: "line",
        kindVersion: 2,
        params: { ...params, spots: ids.length },
        orderMode: "nearest",
        reverse: false,
        members: ids.map((marcherId, slot) => ({
            marcherId,
            slot,
            x: slots[slot]!.x,
            y: slots[slot]!.y,
        })),
    };
    const at = new Map(recipe.members.map((m) => [m.marcherId, m]));
    return boxesAt({
        recipes: [recipe],
        endBeatOf: () => 8,
        beat: 8,
        positionOf: (mid) => at.get(mid),
    })[0]!;
}

/** The marchers where `boxes` put them (or off to the side), in `ids` order */
function standing(
    boxes: readonly PlacedBox[],
    ids: number[],
    sections: Record<number, string> = {},
): AssignMarcher[] {
    const at = new Map(
        boxes.flatMap((b) => b.recipe.members.map((m) => [m.marcherId, m])),
    );
    return ids.map(
        (id, i): AssignMarcher => ({
            id,
            at: { x: at.get(id)?.x ?? 400 + 7 * id, y: at.get(id)?.y ?? 400 },
            drillRank: i,
            ...(sections[id] ? { section: sections[id] } : {}),
        }),
    );
}

/** A Line drawn from `from` to `to` on `marchers`: its first spot is at `from` */
function drawn(marchers: readonly AssignMarcher[], from: XY, to: XY) {
    let t = openTool(lineTool, marchers);
    t = press(t, from, env);
    t = pointerMove(t, to, env);
    return release(t, ctx);
}

/** Marcher ids in the order of the spots they take, first spot to last */
function alongShape(t: ToolState): number[] {
    return [...targetsOf(t, ctx)]
        .sort((a, b) => a.slot - b.slot)
        .map((x) => x.id);
}

const picked = (t: ToolState, choice: OrderChoice) =>
    alongShape(setOrder(t, choice, ctx));

describe("who goes where's options", () => {
    const six = [1, 2, 3, 4, 5, 6];
    const line = placedLine(1, six, 100);
    const open = () =>
        drawn(
            withPlacedOrder(standing([line], six), [line]),
            { x: 100, y: 300 },
            { x: 200, y: 300 },
        );

    it("Inside out sends the middle of the line to the ends of the shape", () => {
        expect(picked(open(), "keep")).toEqual([1, 2, 3, 4, 5, 6]);
        expect(picked(open(), "inside")).toEqual([3, 2, 1, 6, 5, 4]);
    });

    it("flips each half and keeps an odd middle", () => {
        expect(halvesFlipped([1, 2, 3, 4, 5])).toEqual([2, 1, 3, 5, 4]);
        expect(halvesFlipped([1, 2])).toEqual([1, 2]);
    });

    it("Zipper merges two lines taking turns, and is offered only for two lines", () => {
        const a = placedLine(1, [1, 2, 3], 100);
        const b = placedLine(2, [4, 5, 6], 140);
        const marchers = withPlacedOrder(standing([a, b], six), [a, b]);
        expect(marchers.map((m) => m.lane)).toEqual([0, 0, 0, 1, 1, 1]);
        const t = drawn(marchers, { x: 100, y: 300 }, { x: 200, y: 300 });
        // Two lines open on Least travel, as before
        expect(t.order).toBe("nearest");
        expect(orderRefusal(t.marchers, "zipper")).toBeNull();
        expect(orderRefusal(t.marchers, "keep")).toBe("twoLines");
        expect(picked(t, "zipper")).toEqual([1, 4, 2, 5, 3, 6]);
        expect(orderRefusal(open().marchers, "zipper")).toBe("notTwoLines");
    });

    it("Within sections keeps each section on a run of spots, and needs two sections", () => {
        const sections = { 1: "T", 2: "M", 3: "T", 4: "M", 5: "T", 6: "M" };
        const t = drawn(
            standing([], six, sections),
            { x: 100, y: 300 },
            { x: 200, y: 300 },
        );
        const order = picked(t, "sections");
        const runs = order.map((id) => sections[id as keyof typeof sections]);
        expect(runs.slice(0, 3).every((s) => s === runs[0])).toBe(true);
        expect(runs.slice(3).every((s) => s === runs[3])).toBe(true);
        expect(runs[0]).not.toBe(runs[3]);
        expect(orderRefusal(open().marchers, "sections")).toBe("oneSection");
    });

    it("stores the new options as their own order mode, and reads anything unknown as Least travel", () => {
        for (const choice of ["inside", "zipper", "sections"] as const) {
            const { orderMode, reverse } = orderFields(choice);
            expect(orderMode).toBe(choice);
            expect(orderChoiceOf(orderMode, reverse)).toBe(choice);
        }
        expect(orderChoiceOf("drill", false)).toBe("nearest");
    });

    it("keeps a placed shape's members on their spots when it's laid out again with a new option saved", () => {
        const placed = placedLine(3, six, 100);
        const saved = {
            ...placed,
            recipe: { ...placed.recipe, orderMode: "inside" },
        } as PlacedBox;
        const moved = liveTargets(saved, saved.params, ctx, true);
        expect(moved.members.map((m) => m.slot)).toEqual(
            placed.recipe.members.map((m) => m.slot),
        );
    });
});

describe("an order set by hand", () => {
    it("opens Keep order on marchers with no placed Line, in the order set", () => {
        const ids = [1, 2, 3, 4, 5];
        let t = drawn(
            standing([], ids),
            { x: 100, y: 300 },
            { x: 200, y: 300 },
        );
        expect(t.order).toBe("nearest");
        expect(orderRefusal(t.marchers, "keep")).toBe("noOrder");
        t = takeHandOrder(t, [3, 1, 5, 2, 4], ctx);
        expect(t.order).toBe("keep");
        expect(orderRefusal(t.marchers, "keep")).toBeNull();
        expect(alongShape(t)).toEqual([3, 1, 5, 2, 4]);
    });

    it("leaves marchers from a placed Line, or another set of marchers, alone", () => {
        const line = placedLine(1, [1, 2, 3], 100);
        const t = drawn(
            withPlacedOrder(standing([line], [1, 2, 3]), [line]),
            { x: 100, y: 300 },
            { x: 200, y: 300 },
        );
        expect(takeHandOrder(t, [3, 2, 1], ctx)).toBe(t);
        const loose = drawn(
            standing([], [1, 2, 3]),
            { x: 100, y: 300 },
            { x: 200, y: 300 },
        );
        expect(takeHandOrder(loose, [1, 2], ctx)).toBe(loose);
    });
});

describe("picking by hand and Swap", () => {
    const ids = [1, 2, 3, 4, 5];
    const line = placedLine(1, ids, 100);
    const open = () =>
        drawn(
            withPlacedOrder(standing([line], ids), [line]),
            { x: 100, y: 300 },
            { x: 200, y: 300 },
        );

    it("puts a picked marcher on its spot, and the one bumped on the spot left", () => {
        const t = open();
        expect(alongShape(t)).toEqual([1, 2, 3, 4, 5]);
        const next = pinPairs(t, [[0, 4]], ctx);
        expect(alongShape(next)).toEqual([5, 2, 3, 4, 1]);
        expect(next.pins).toEqual([[0, 4]]);
        expect(alongShape(undo(next))).toEqual([1, 2, 3, 4, 5]);
    });

    it("lets later picks win over earlier ones", () => {
        const after = withPins(
            [0, 1, 2],
            [
                [0, 2],
                [1, 2],
            ],
            [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 20, y: 0 },
            ],
            [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 20, y: 0 },
            ],
        );
        expect(after.assignment[1]).toBe(2);
        expect(new Set(after.assignment).size).toBe(3);
    });

    it("trades two marchers' spots with Swap, as one undo step", () => {
        const t = swapMarchers(open(), 0, 2, ctx);
        expect(alongShape(t)).toEqual([3, 2, 1, 4, 5]);
        expect(alongShape(undo(t))).toEqual([1, 2, 3, 4, 5]);
    });

    it("keeps hand picks when another option is picked, until they're cleared", () => {
        let t = pinPairs(open(), [[0, 4]], ctx);
        t = setOrder(t, "reverse", ctx);
        expect(alongShape(t).at(-1)).toBe(1);
        t = clearPins(t, ctx);
        expect(t.pins).toBeUndefined();
        expect(alongShape(t)).toEqual([5, 4, 3, 2, 1]);
    });

    it("drops hand picks when a new shape is drawn", () => {
        let t = pinPairs(open(), [[0, 4]], ctx);
        t = press(t, { x: 100, y: 500 }, env);
        t = pointerMove(t, { x: 200, y: 500 }, env);
        t = release(t, ctx);
        expect(t.pins).toBeUndefined();
    });
});

describe("the readout", () => {
    it("counts walks that cross", () => {
        expect(
            crossings([
                { from: { x: 0, y: 0 }, to: { x: 10, y: 10 } },
                { from: { x: 10, y: 0 }, to: { x: 0, y: 10 } },
                { from: { x: 20, y: 0 }, to: { x: 20, y: 10 } },
            ]),
        ).toBe(1);
    });
});
