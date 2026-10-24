import { describe, expect, it } from "vitest";
import { boxTool } from "../box/boxTool";
import { boxDistribution, type BoxParams } from "../box/boxGeometry";
import type { Fraction, LayoutFamily } from "../distribute/distribution";
import {
    layoutRowsOf,
    staggerOf,
    withLayout,
    withMode,
    withStagger,
} from "../distribute/modes";
import { boxesAt, type PlacedRecipe } from "../placed/placedBox";
import { placementOf } from "../tool/shapePlacement";
import type { ToolEnv } from "../tool/toolKind";
import {
    edit,
    openTool,
    pointerMove,
    press,
    release,
    slotsOf,
    undo,
    type ToolState,
} from "../tool/toolMachine";
import type { ShapeContext, Slot } from "../types";

/**
 * The stagger offset in the shape session (#388): it moves each rank across, is one undo step,
 * is stored as the fraction given and comes back from a recipe exactly, and only Full and Short
 * back take it.
 */

const STEP = 10;
const half = STEP / 2;
const snapHalf = (v: number) => Math.round(v / half) * half;
const env: ToolEnv = {
    stepPx: STEP,
    snap: true,
    shift: false,
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

/** 24 marchers drawn wider than deep: Short back 6 × 4, no short rank */
function drawn(n = 24): ToolState {
    let t = openTool(boxTool, marchers(n));
    t = press(t, { x: 0, y: 0 }, env);
    t = pointerMove(t, { x: 100, y: 60 }, env);
    return release(t, ctx);
}

const stagger = (t: ToolState, s: Fraction) =>
    edit(t, withStagger(boxTool, t.params, t.spots, s, env), ctx);

/** Each rank's leftmost x, front (largest y) first */
function rankStarts(slots: readonly Slot[]): number[] {
    const by = new Map<number, number>();
    for (const s of slots) by.set(s.y, Math.min(by.get(s.y) ?? Infinity, s.x));
    return [...by.entries()].sort((a, b) => b[0] - a[0]).map(([, x]) => x);
}

const pickFamily = (t: ToolState, family: LayoutFamily) => {
    const row = layoutRowsOf(boxTool, t.spots).find(
        (r) => r.family === family,
    )!;
    return edit(
        t,
        withLayout(boxTool, t.params, t.spots, row.versions[0]!.layout, env),
        ctx,
    );
};

describe("the stagger offset", () => {
    it("moves rank r by r × ⅓ of the interval, wrapped to ±½, toward the right going back", () => {
        const t = drawn();
        const across = (t.params as BoxParams).across;
        const straight = rankStarts(slotsOf(t, ctx));
        const leaned = rankStarts(slotsOf(stagger(t, [1, 3]), ctx));
        // Ranks 0..3 move 0, ⅓, −⅓ (⅔ wrapped), 0
        expect(leaned.map((x, r) => (x - straight[r]!) / across)).toEqual([
            0,
            expect.closeTo(1 / 3, 9),
            expect.closeTo(-1 / 3, 9),
            0,
        ]);
    });

    it("moves the ranks left for a negative offset", () => {
        const t = drawn();
        const across = (t.params as BoxParams).across;
        const straight = rankStarts(slotsOf(t, ctx));
        const leaned = rankStarts(slotsOf(stagger(t, [-1, 2]), ctx));
        expect(leaned.map((x, r) => (x - straight[r]!) / across)).toEqual([
            0, -0.5, 0, -0.5,
        ]);
    });

    it("is stored as the fraction given, one undo step", () => {
        const t = drawn();
        const s = stagger(t, [1, 3]);
        expect(boxDistribution(s.params as BoxParams)).toMatchObject({
            stagger: [1, 3],
        });
        expect(staggerOf(boxTool, s.params, 24)).toEqual([1, 3]);
        expect(undo(s).params).toBe(t.params);
        expect(slotsOf(s, ctx)).toHaveLength(24);
    });

    it("round-trips through the recipe as [p, q]", () => {
        const t = stagger(drawn(), [-1, 6]);
        const placement = placementOf(t, ctx)!;
        const recipe: PlacedRecipe = {
            ...placement.recipe,
            id: 1,
            timelineId: 10,
            members: placement.members,
            params: JSON.parse(JSON.stringify(placement.recipe.params)),
        };
        expect(
            (recipe.params as { distribution: { stagger: unknown } })
                .distribution.stagger,
        ).toEqual([-1, 6]);
        const at = new Map(placement.members.map((m) => [m.marcherId, m]));
        const [box] = boxesAt({
            recipes: [recipe],
            endBeatOf: () => 8,
            beat: 8,
            positionOf: (id) => at.get(id),
        });
        expect(staggerOf(boxTool, box!.params, 24)).toEqual([-1, 6]);
        expect(boxTool.shape.generate(box!.params, 24, ctx)).toEqual(
            slotsOf(t, ctx),
        );
    });

    it("is offered for Full and Short back, not for Stagger, Rounded or Notched, nor outside Files", () => {
        // 24 marchers make every layout
        const t = drawn(24);
        expect(staggerOf(boxTool, pickFamily(t, "full").params, 24)).toEqual([
            0, 1,
        ]);
        for (const family of ["stagger", "rounded", "notched"] as const) {
            const p = pickFamily(t, family).params;
            expect(staggerOf(boxTool, p, 24)).toBeNull();
            expect(withStagger(boxTool, p, 24, [1, 3], env)).toBe(p);
        }
        const outline = withMode(boxTool, t.params, 24, "outline", env);
        expect(staggerOf(boxTool, outline, 24)).toBeNull();
    });

    it("keeps the offset through a layout change and back", () => {
        const t = stagger(drawn(), [1, 4]);
        const notched = pickFamily(t, "notched");
        expect(staggerOf(boxTool, notched.params, 24)).toBeNull();
        expect(
            staggerOf(boxTool, pickFamily(notched, "full").params, 24),
        ).toEqual([1, 4]);
    });
});
