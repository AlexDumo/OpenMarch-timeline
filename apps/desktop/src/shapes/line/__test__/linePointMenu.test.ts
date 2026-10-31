import { describe, expect, it } from "vitest";
import { lineTool } from "../lineTool";
import {
    cornerOffInterval,
    holdsMarcher,
    isLineParams,
    lineSegments,
    lineSpots,
    setPointMarcher,
    SMOOTH,
    withInterval,
    type LineParams,
    type LinePoint,
} from "../lineGeometry";
import { openLive, pickLive } from "../../placed/liveBox";
import { filesDistribution } from "../../distribute/distribution";
import {
    boxesAt,
    type PlacedBox,
    type PlacedRecipe,
} from "../../placed/placedBox";
import { placementOf } from "../../tool/shapePlacement";
import type { ToolEnv, ToolMenuItem } from "../../tool/toolKind";
import {
    edit,
    openTool,
    pickMenu,
    undo,
    type ToolState,
} from "../../tool/toolMachine";
import type { ShapeContext, XY } from "../../types";

/**
 * A Line's point and segment menus, and the per-point marcher override (#569): a point can hold a
 * marcher whatever the corners switch says, or keep the spacing even through it, in Fit, Keep
 * interval, Measured and closed lines. The menus are driven through the shape session and a placed
 * Line with the real Line kind.
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

const corner = (x: number, y: number, more?: Partial<LinePoint>) => ({
    x,
    y,
    tension: 0,
    ...more,
});
/** An L, 40 along then 40 down: its corner is point 1 */
const L = (more: Partial<LineParams> = {}): LineParams => ({
    points: [corner(0, 0), corner(40, 0), corner(40, 40)],
    spacing: { mode: "fit" },
    ...more,
});
/** A closed square, 40 a side, from its top-left corner */
const square = (more: Partial<LineParams> = {}): LineParams => ({
    points: [corner(0, 0), corner(40, 0), corner(40, 40), corner(0, 40)],
    closed: true,
    spacing: { mode: "fit" },
    ...more,
});
/** `p` with point `index` holding a marcher always (true) or kept even through (false) */
const marcherAt = (p: LineParams, index: number, marcher: boolean) =>
    setPointMarcher(p, 8, index, marcher, {});

const spots = (p: LineParams, n: number) =>
    lineSpots(p, n).map(({ x, y }) => ({ x, y }));
const near = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
const hasSpotOn = (p: LineParams, n: number, at: XY) =>
    spots(p, n).some((s) => near(s, at));
const expectSame = (a: readonly XY[], b: readonly XY[]) => {
    expect(a).toHaveLength(b.length);
    a.forEach((s, i) => {
        expect(s.x).toBeCloseTo(b[i]!.x, 6);
        expect(s.y).toBeCloseTo(b[i]!.y, 6);
    });
};

/** The open shape tool with `params` drawn for `n` marchers */
function opened(params: LineParams, n: number): ToolState {
    return edit(openTool(lineTool, marchers(n)), params, ctx);
}
const paramsOf = (t: ToolState) => t.params as LineParams;
const menuOf = (p: LineParams, key: string) =>
    lineTool.menu!.sections(p, 4, key) ?? [];
const itemsOf = (p: LineParams, key: string): ToolMenuItem[] =>
    menuOf(p, key).flatMap((s) => s.items);
const item = (p: LineParams, key: string, value: string) =>
    itemsOf(p, key).find((i) => i.value === value);

describe("a point's marcher override (#569)", () => {
    it("is stored only when set, and read back by this build", () => {
        expect(L().points.some((q) => "marcher" in q)).toBe(false);
        const out = marcherAt(L(), 1, false);
        expect(out.points[1]).toEqual(corner(40, 0, { marcher: false }));
        expect(isLineParams(out)).toBe(true);
        expect(isLineParams(marcherAt(L(), 1, true))).toBe(true);
        // As the line again drops the field
        const back = setPointMarcher(out, 8, 1, undefined, {});
        expect("marcher" in back.points[1]!).toBe(false);
    });

    it("refuses a marcher that isn't true or false, and point fields it doesn't know", () => {
        const bad = (q: object) =>
            isLineParams({ ...L(), points: [corner(0, 0), q, corner(40, 40)] });
        expect(bad(corner(40, 0, { marcher: "yes" as never }))).toBe(false);
        expect(bad({ ...corner(40, 0), weight: 2 })).toBe(false);
        expect(bad(corner(40, 0))).toBe(true);
    });

    it("keeps the spacing even through a corner with every corner holding a marcher", () => {
        // 4 marchers on an L of 80: a marcher on the corner, else every 26⅔ round it
        expect(hasSpotOn(L(), 4, { x: 40, y: 0 })).toBe(true);
        const even = marcherAt(L(), 1, false);
        expect(holdsMarcher(even, 1)).toBe(false);
        expect(hasSpotOn(even, 4, { x: 40, y: 0 })).toBe(false);
        expectSame(spots(even, 4), spots(L({ corners: false }), 4));
    });

    it("puts a marcher on a corner with the corners switch off", () => {
        const off = L({ corners: false });
        expect(hasSpotOn(off, 4, { x: 40, y: 0 })).toBe(false);
        const always = marcherAt(off, 1, true);
        expect(holdsMarcher(always, 1)).toBe(true);
        expectSame(spots(always, 4), spots(L(), 4));
    });

    it("puts a marcher on a smooth point that asks for one", () => {
        const curve: LineParams = {
            points: [
                corner(0, 0),
                corner(40, 30, { tension: SMOOTH }),
                corner(80, 0),
            ],
            spacing: { mode: "fit" },
        };
        expect(hasSpotOn(curve, 4, { x: 40, y: 30 })).toBe(false);
        expect(hasSpotOn(marcherAt(curve, 1, true), 4, { x: 40, y: 30 })).toBe(
            true,
        );
    });

    it("ignores the override on the path, which runs past every point", () => {
        const path = L({
            spacing: {
                mode: "path",
                groups: [{ interval: 20 }],
                anchor: "start",
            },
        });
        expectSame(spots(marcherAt(path, 1, true), 4), spots(path, 4));
        expectSame(
            spots(marcherAt({ ...path, corners: true }, 1, false), 4),
            spots(path, 4),
        );
    });

    it("lets a closed line's corner opt out of holding a marcher", () => {
        const sq = square();
        const p2 = { x: 40, y: 40 };
        expect(hasSpotOn(sq, 6, p2)).toBe(true);
        const out = marcherAt(sq, 2, false);
        expect(hasSpotOn(out, 6, p2)).toBe(false);
        for (const at of [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 0, y: 40 },
        ])
            expect(hasSpotOn(out, 6, at)).toBe(true);
        expect(spots(out, 6)).toHaveLength(6);
    });

    it("lets a closed line's corner opt in with the switch off", () => {
        // 5 round 160 with the switch off: every 32 from the first point, none on the third
        const off = square({ corners: false });
        const p2 = { x: 40, y: 40 };
        expect(hasSpotOn(off, 5, p2)).toBe(false);
        const out = marcherAt(off, 2, true);
        expect(hasSpotOn(out, 5, p2)).toBe(true);
        expect(spots(out, 5)).toHaveLength(5);
    });

    it("holds a marcher on a point of a line measured side to side, its stretches even that way", () => {
        const zig: LineParams = {
            points: [corner(0, 0), corner(30, 20), corner(80, 0)],
            spacing: { mode: "fit" },
            measured: "x",
            corners: false,
        };
        // Every 20 side to side: none on the point at 30
        expect(hasSpotOn(zig, 5, { x: 30, y: 20 })).toBe(false);
        const out = marcherAt(zig, 1, true);
        const xs = spots(out, 5).map((s) => s.x);
        expect(hasSpotOn(out, 5, { x: 30, y: 20 })).toBe(true);
        // Each stretch's gaps even side to side
        const at = xs.indexOf(30);
        const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
        for (const run of [gaps.slice(0, at), gaps.slice(at)])
            run.forEach((g) => expect(g).toBeCloseTo(run[0]!, 6));
        // And opting out with the switch on is the switch off
        const on = { ...zig, corners: true };
        expectSame(spots(marcherAt(on, 1, false), 5), spots(zig, 5));
    });

    it("sizes a Keep interval line so a point that opts in is a whole number of intervals along", () => {
        const off: LineParams = {
            points: [corner(0, 0), corner(40, 0), corner(40, 45)],
            spacing: { mode: "fit" },
            corners: false,
        };
        const n = 10;
        const kept = withInterval(off, n, 10, {});
        const out = setPointMarcher(kept, n, 1, true, {});
        const lengths = lineSegments(out).map((s) =>
            Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y),
        );
        for (const l of lengths)
            expect(Math.abs(l / 10 - Math.round(l / 10))).toBeLessThan(1e-6);
        expect(hasSpotOn(out, n, out.points[1]!)).toBe(true);
        expect(cornerOffInterval(out, n)).toBe(false);
    });
});

describe("a Line's point menu (#569)", () => {
    it("offers corner or smooth, the marcher answers, delete, and the double-click beside the switch", () => {
        const menu = menuOf(L(), "p1");
        expect(menu.map((s) => s.items.map((i) => i.value))).toEqual([
            ["corner", "smooth"],
            ["marcher-line", "marcher-always", "marcher-even"],
            ["delete"],
        ]);
        expect(menu[1]!.label).toBe("Marcher on this point");
        expect(item(L(), "p1", "corner")).toMatchObject({
            checked: true,
            doubleClick: false,
        });
        expect(item(L(), "p1", "smooth")).toMatchObject({
            checked: false,
            doubleClick: true,
        });
        expect(item(L(), "p1", "marcher-line")?.checked).toBe(true);
        const even = marcherAt(L(), 1, false);
        expect(item(even, "p1", "marcher-even")?.checked).toBe(true);
        expect(item(even, "p1", "marcher-line")?.checked).toBe(false);
    });

    it("offers Roundness only on a smooth point", () => {
        const smooth = {
            ...L(),
            points: L().points.map((q, i) =>
                i === 1 ? { ...q, tension: SMOOTH } : q,
            ),
        };
        expect(item(smooth, "p1", "roundness")).toBeDefined();
        expect(item(L(), "p1", "roundness")).toBeUndefined();
    });

    it("leaves the marcher answers off an open line's ends, and offers Close line there", () => {
        const values = itemsOf(L(), "p0").map((i) => i.value);
        expect(values).not.toContain("marcher-line");
        expect(values).toContain("close");
        expect(item(L(), "p2", "close")?.disabled).toBeUndefined();
        expect(itemsOf(L(), "p1").map((i) => i.value)).not.toContain("close");
    });

    it("greys out Delete point at the fewest points, and Close line under three", () => {
        const two: LineParams = {
            points: [corner(0, 0), corner(40, 0)],
            spacing: { mode: "fit" },
        };
        expect(item(two, "p0", "delete")?.disabled).toBeTruthy();
        expect(item(two, "p0", "close")?.disabled).toBeTruthy();
        expect(item(square(), "p0", "delete")?.disabled).toBeUndefined();
        const triangle = { ...square(), points: square().points.slice(0, 3) };
        expect(item(triangle, "p0", "delete")?.disabled).toBeTruthy();
    });

    it("greys out the marcher answers on the path and on a filled line", () => {
        const path = L({
            spacing: {
                mode: "path",
                groups: [{ interval: 20 }],
                anchor: "start",
            },
        });
        expect(item(path, "p1", "marcher-always")?.disabled).toBeTruthy();
        expect(lineTool.menu!.pick(path, 4, "p1", "marcher-always", env)).toBe(
            null,
        );
        const filled = square({ distribution: filesDistribution(2) });
        expect(item(filled, "p1", "marcher-always")?.disabled).toBeTruthy();
    });

    it("offers Open here on a closed line's points, not Close line", () => {
        const values = itemsOf(square(), "p2").map((i) => i.value);
        expect(values).toContain("open");
        expect(values).not.toContain("close");
        expect(values).toContain("marcher-line");
    });

    it("turns a point smooth and selects it, as one undo step", () => {
        let t = opened(L(), 4);
        const past = t.past.length;
        t = pickMenu(t, "p1", "smooth", ctx, env);
        expect(paramsOf(t).points[1]!.tension).toBe(SMOOTH);
        expect(t.selected).toBe("p1");
        expect(t.past).toHaveLength(past + 1);
        t = pickMenu(t, "p1", "corner", ctx, env);
        expect(paramsOf(t).points[1]!.tension).toBe(0);
    });

    it("selects a smooth point for Roundness, changing nothing", () => {
        const smooth = {
            ...L(),
            points: L().points.map((q, i) =>
                i === 1 ? { ...q, tension: SMOOTH } : q,
            ),
        };
        let t = opened(smooth, 4);
        const past = t.past.length;
        t = pickMenu(t, "p1", "roundness", ctx, env);
        expect(t.selected).toBe("p1");
        expect(t.params).toBe(smooth);
        expect(t.past).toHaveLength(past);
    });

    it("keeps the spacing even through a point, undone in one step", () => {
        let t = opened(L(), 4);
        t = pickMenu(t, "p1", "marcher-even", ctx, env);
        expect(paramsOf(t).points[1]!.marcher).toBe(false);
        t = pickMenu(t, "p1", "marcher-line", ctx, env);
        expect("marcher" in paramsOf(t).points[1]!).toBe(false);
        t = undo(t);
        expect(paramsOf(t).points[1]!.marcher).toBe(false);
    });

    it("deletes a point, never under the fewest, clearing the selection", () => {
        let t = opened(L(), 4);
        t = pickMenu(t, "p1", "smooth", ctx, env);
        t = pickMenu(t, "p1", "delete", ctx, env);
        expect(paramsOf(t).points).toEqual([corner(0, 0), corner(40, 40)]);
        expect(t.selected).toBeNull();
        const was = t.params;
        t = pickMenu(t, "p0", "delete", ctx, env);
        expect(t.params).toBe(was);
    });

    it("closes an open line from an end, and opens a closed one at a point", () => {
        let t = opened(L(), 4);
        t = pickMenu(t, "p2", "close", ctx, env);
        expect(paramsOf(t).closed).toBe(true);
        let s = opened(marcherAt(square(), 2, true), 6);
        s = pickMenu(s, "p2", "open", ctx, env);
        const open = paramsOf(s);
        expect(open.closed).toBeUndefined();
        expect(open.points.map(({ x, y }) => ({ x, y }))).toEqual([
            { x: 40, y: 40 },
            { x: 0, y: 40 },
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 40 },
        ]);
        // Its new ends hold a marcher anyway: they say nothing of their own
        expect("marcher" in open.points[0]!).toBe(false);
        expect(isLineParams(open)).toBe(true);
    });
});

describe("a Line's segment menu (#569)", () => {
    it("adds a point in the segment's middle and selects it", () => {
        let t = opened(L(), 4);
        expect(itemsOf(L(), "m0").map((i) => i.value)).toEqual([
            "add",
            "straight",
            "curved",
        ]);
        t = pickMenu(t, "m0", "add", ctx, env);
        expect(paramsOf(t).points).toHaveLength(4);
        expect(paramsOf(t).points[1]).toMatchObject({ x: 20, y: 0 });
        expect(t.selected).toBe("p1");
    });

    it("curves a straight segment and straightens it again", () => {
        expect(item(L(), "m0", "straight")?.checked).toBe(true);
        let t = opened(L(), 4);
        t = pickMenu(t, "m0", "curved", ctx, env);
        expect(lineSegments(paramsOf(t))[0]!.type).toBe("cubic");
        expect(item(paramsOf(t), "m0", "curved")?.checked).toBe(true);
        t = pickMenu(t, "m0", "straight", ctx, env);
        expect(lineSegments(paramsOf(t))[0]!.type).toBe("line");
    });

    it("greys out Curved where the line runs straight through", () => {
        const two: LineParams = {
            points: [corner(0, 0), corner(40, 0)],
            spacing: { mode: "fit" },
        };
        expect(item(two, "m0", "curved")?.disabled).toBeTruthy();
    });
});

describe("the menu on a placed Line (#569)", () => {
    const N = 4;
    function placed(params: LineParams): PlacedBox<LineParams> {
        const placement = placementOf(opened(params, N), ctx)!;
        const recipe: PlacedRecipe = {
            ...placement.recipe,
            id: 1,
            timelineId: 10,
            members: placement.members,
            params: JSON.parse(JSON.stringify(placement.recipe.params)),
        };
        const at = new Map(recipe.members.map((m) => [m.marcherId, m]));
        const [box] = boxesAt({
            recipes: [recipe],
            endBeatOf: () => 8,
            beat: 8,
            positionOf: (id) => at.get(id),
        });
        return box as PlacedBox<LineParams>;
    }

    it("saves a point's override, read back as stored", () => {
        const box = placed(L());
        const out = pickLive(openLive(box), "p1", "marcher-even", env);
        expect(out.changed).toBe(true);
        const after = out.live.params as LineParams;
        expect(after.points[1]!.marcher).toBe(false);
        expect(placed(after).params.points[1]!.marcher).toBe(false);
    });

    it("selects the point Smooth turns, and saves nothing for Roundness", () => {
        const box = placed(L());
        const smooth = pickLive(openLive(box), "p1", "smooth", env);
        expect(smooth.changed).toBe(true);
        expect(smooth.live.selected).toBe("p1");
        const turned = placed(smooth.live.params as LineParams);
        const round = pickLive(openLive(turned), "p1", "roundness", env);
        expect(round.changed).toBe(false);
        expect(round.live.selected).toBe("p1");
    });
});
