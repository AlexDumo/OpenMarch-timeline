// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { boxShape } from "../box/boxShape";
import { boxTool } from "../box/boxTool";
import { drawBox, filesOf, ranksOf, type BoxSize } from "../box/boxGeometry";
import {
    boxesAt,
    membersHere,
    membershipAfter,
    UNGROUPED_KIND,
    movedBox,
    resplit,
    withoutMembers,
    type PlacedBox,
    type PlacedRecipe,
} from "../placed/placedBox";
import type { ToolEnv } from "../tool/toolKind";
import type { ShapeContext, XY } from "../types";

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

/** Moves 10, 20 and 30 end at counts 8, 16 and 24; `null` is the starting spots */
const countOf = (move: number | null): number =>
    move === null
        ? 0
        : ({ 10: 8, 20: 16, 30: 24 } as Record<number, number>)[move]!;

/** A placed box of `n` marchers (ids 1..n) drawn from (0,0) to `to`, at the end of move `move` */
function recipe(n: number, to: XY, move: number | null, id = 1): PlacedRecipe {
    const params = drawBox({ x: 0, y: 0 }, to, n, env)!;
    const slots = boxShape.generate(params, n, ctx);
    return {
        id,
        beat: countOf(move),
        shapeKey: id,
        kind: "block",
        kindVersion: 1,
        params: { ...params, spots: n },
        orderMode: "nearest",
        reverse: false,
        members: slots.map((s, i) => ({
            marcherId: i + 1,
            slot: i,
            x: s.x,
            y: s.y,
        })),
    };
}

const at = (r: PlacedRecipe) =>
    new Map(r.members.map((m) => [m.marcherId, { x: m.x, y: m.y }]));

describe("which placed box holds at a moment", () => {
    it("shows a box at its move's end and later, while every member stands on its spot", () => {
        const r = recipe(4, { x: 40, y: 40 }, 10);
        const positions = at(r);
        const find = (beat: number) =>
            boxesAt({
                recipes: [r],
                beat,
                positionOf: (id) => positions.get(id),
            });
        expect(find(8)).toHaveLength(1);
        expect(find(30)).toHaveLength(1);
        // Before its move ends, it isn't there yet
        expect(find(4)).toHaveLength(0);
    });

    it("keeps the box with a member standing elsewhere: its spot is open, and it's still a member (ADR 0006 §9.1)", () => {
        const r = recipe(4, { x: 40, y: 40 }, 10);
        const positions = at(r);
        positions.set(2, { x: 99, y: 99 });
        const [box, ...rest] = boxesAt({
            recipes: [r],
            beat: 12,
            positionOf: (id) => positions.get(id),
        });
        expect(rest).toHaveLength(0);
        expect(box!.recipe.members.map((m) => m.marcherId)).toEqual([
            1, 2, 3, 4,
        ]);
        expect(box!.open).toEqual([{ ...r.members[1]!, taken: false }]);
        expect(membersHere(box!).map((m) => m.marcherId)).toEqual([1, 3, 4]);
    });

    it("draws every spot open but one, and nothing once no member stands on its spot", () => {
        const r = recipe(4, { x: 40, y: 40 }, 10);
        const positions = at(r);
        const find = () =>
            boxesAt({
                recipes: [r],
                beat: 12,
                positionOf: (id) => positions.get(id),
            });
        for (const id of [1, 2, 3]) positions.set(id, { x: 99, y: 99 });
        expect(find()[0]!.open.map((o) => o.marcherId)).toEqual([1, 2, 3]);
        positions.set(4, { x: 99, y: 99 });
        expect(find()).toEqual([]);
        // A marcher the resolver doesn't know isn't on its spot either
        expect(
            boxesAt({ recipes: [r], beat: 12, positionOf: () => undefined }),
        ).toEqual([]);
    });

    it("shows a spot whose marcher a later shape took as empty, and leaves it out of the members", () => {
        const early = recipe(4, { x: 40, y: 40 }, 10, 1);
        // A later shape takes marcher 1 only, somewhere else
        const late: PlacedRecipe = {
            ...recipe(4, { x: 40, y: 40 }, 20, 2),
            members: [{ marcherId: 1, slot: 0, x: 200, y: 200 }],
            params: { ...early.params, spots: 1 },
        };
        const positions = at(early);
        positions.set(1, { x: 200, y: 200 });
        const found = boxesAt({
            recipes: [early, late],
            beat: 20,
            positionOf: (id) => positions.get(id),
        });
        const earlyBox = found.find((b) => b.recipe.id === 1)!;
        expect(earlyBox.recipe.members.map((m) => m.marcherId)).toEqual([
            2, 3, 4,
        ]);
        expect(earlyBox.open).toEqual([{ ...early.members[0]!, taken: true }]);
        expect(earlyBox.spots).toBe(4);
        // The later one claims it even while it's off its spot there: still empty in the earlier
        positions.set(1, { x: 0, y: 900 });
        const again = boxesAt({
            recipes: [early, late],
            beat: 20,
            positionOf: (id) => positions.get(id),
        });
        expect(again.map((b) => b.recipe.id)).toEqual([1]);
        expect(again[0]!.open[0]!.taken).toBe(true);
    });

    it("takes the latest box when an earlier one still matches", () => {
        const early = recipe(4, { x: 40, y: 40 }, 10, 1);
        const late = { ...recipe(4, { x: 40, y: 40 }, 20, 2) };
        const positions = at(late);
        const found = boxesAt({
            recipes: [early, late],
            beat: 20,
            positionOf: (id) => positions.get(id),
        });
        expect(found.map((b) => b.recipe.id)).toEqual([2]);
        expect(found[0]!.endBeat).toBe(16);
    });

    it("counts a box's spots, not its members, so a hole stays a hole", () => {
        const r = withoutMembers(recipe(4, { x: 40, y: 40 }, null), [3]);
        const positions = at(r);
        const [box] = boxesAt({
            recipes: [r],
            beat: 0,
            positionOf: (id) => positions.get(id),
        });
        expect(box!.spots).toBe(4);
        expect(box!.recipe.members).toHaveLength(3);
    });

    it("skips recipes of a kind it can't read", () => {
        const line = { ...recipe(4, { x: 40, y: 40 }, 10), kind: "line" };
        const positions = at(line);
        expect(
            boxesAt({
                recipes: [line],
                beat: 20,
                positionOf: (id) => positions.get(id),
            }),
        ).toEqual([]);
    });
});

describe("ungrouped marchers", () => {
    /** Marks the members of `r` ungrouped at the end of move `move` */
    const ungrouped = (r: PlacedRecipe, move: number): PlacedRecipe => ({
        ...r,
        id: 99,
        beat: countOf(move),
        kind: UNGROUPED_KIND,
        params: {},
    });

    it("ends a box held from an earlier move where it was ungrouped, and shows nothing for it", () => {
        const r = recipe(4, { x: 40, y: 40 }, 10);
        const positions = at(r);
        const find = (beat: number) =>
            boxesAt({
                recipes: [r, ungrouped(r, 20)],
                beat,
                positionOf: (id) => positions.get(id),
            });
        expect(find(8).map((b) => b.recipe.id)).toEqual([1]);
        expect(find(12).map((b) => b.recipe.id)).toEqual([1]);
        expect(find(16)).toEqual([]);
        expect(find(40)).toEqual([]);
    });

    it("keeps them ungrouped even if they come back to the box's spots", () => {
        const r = recipe(4, { x: 40, y: 40 }, 10);
        const positions = at(r);
        // Ungrouped where they stood after moving away; now back on the box's spots
        const moved = {
            ...ungrouped(r, 20),
            members: r.members.map((m) => ({ ...m, x: m.x + 50 })),
        };
        expect(
            boxesAt({
                recipes: [r, moved],
                beat: 24,
                positionOf: (id) => positions.get(id),
            }),
        ).toEqual([]);
    });

    it("keeps the members a later shape didn't take, so an older shape over them stays hidden", () => {
        const early = recipe(4, { x: 40, y: 40 }, 10, 1);
        const positions = at(early);
        /** A shape of `early`'s members `ids`, where they stand, at the end of move `move` */
        const over = (id: number, move: number, ids: number[]) => ({
            ...early,
            id,
            beat: countOf(move),
            members: early.members.filter((m) => ids.includes(m.marcherId)),
            params: { ...(early.params as object), spots: ids.length },
        });
        const found = boxesAt({
            recipes: [
                early,
                over(3, 10, [3, 4]),
                ungrouped(early, 20),
                over(2, 30, [1, 2]),
            ],
            beat: 24,
            positionOf: (id) => positions.get(id),
        });
        // The later shape takes 1 and 2; the mark still holds 3 and 4 against the older pair
        expect(found.map((b) => b.recipe.id)).toEqual([2]);
    });

    it("lets a shape placed later take them again", () => {
        const early = recipe(4, { x: 40, y: 40 }, 10, 1);
        const late = recipe(4, { x: 40, y: 40 }, 30, 2);
        const positions = at(late);
        expect(
            boxesAt({
                recipes: [early, ungrouped(early, 20), late],
                beat: 24,
                positionOf: (id) => positions.get(id),
            }).map((b) => b.recipe.id),
        ).toEqual([2]);
    });
});

describe("what moving marchers does to a box", () => {
    const box = (): PlacedBox => {
        const r = recipe(4, { x: 40, y: 40 }, 10);
        const p = r.params as PlacedBox["params"];
        return {
            recipe: r,
            kind: boxTool,
            params: p,
            spots: 4,
            endBeat: 8,
            open: [],
        };
    };

    it("nothing when no member moves off its spot", () => {
        expect(membershipAfter(box(), new Map([[9, { x: 1, y: 1 }]]))).toEqual({
            type: "none",
        });
    });

    it("moves the box when every member moves the same way", () => {
        const b = box();
        const moved = new Map(
            b.recipe.members.map((m) => [
                m.marcherId,
                { x: m.x + 5, y: m.y - 10 },
            ]),
        );
        expect(membershipAfter(b, moved)).toEqual({
            type: "move",
            delta: { x: 5, y: -10 },
        });
        const out = movedBox(b, { x: 5, y: -10 });
        expect(out.params.center).toEqual({
            x: b.params.center.x + 5,
            y: b.params.center.y - 10,
        });
        expect(out.members[0]).toMatchObject({
            x: b.recipe.members[0]!.x + 5,
            y: b.recipe.members[0]!.y - 10,
        });
    });

    it("moves the box, its open spots with it, when every member on its spot moves the same way", () => {
        const b = box();
        const away: PlacedBox = {
            ...b,
            open: [{ ...b.recipe.members[3]!, taken: false }],
        };
        const moved = new Map(
            away.recipe.members
                .slice(0, 3)
                .map((m) => [m.marcherId, { x: m.x + 5, y: m.y }]),
        );
        expect(membershipAfter(away, moved)).toEqual({
            type: "move",
            delta: { x: 5, y: 0 },
        });
        const out = movedBox(away, { x: 5, y: 0 });
        expect(out.members[3]).toMatchObject({
            x: b.recipe.members[3]!.x + 5,
        });
    });

    it("lets the moved members leave when only some move, or not all the same way", () => {
        const b = box();
        expect(membershipAfter(b, new Map([[2, { x: 99, y: 0 }]]))).toEqual({
            type: "leave",
            left: [2],
        });
        const uneven = new Map(
            b.recipe.members.map((m, i) => [
                m.marcherId,
                { x: m.x + (i === 0 ? 5 : 10), y: m.y },
            ]),
        );
        expect(membershipAfter(b, uneven)).toEqual({
            type: "leave",
            left: [1, 2, 3, 4],
        });
    });
});

describe("filling a hole", () => {
    // 5 × 4 = 20; one leaves
    const r = recipe(20, { x: 80, y: 60 }, 10);
    const params = r.params as PlacedBox["params"];
    const left = withoutMembers(r, [7]);
    const remaining = left.members.map((m) => ({
        id: m.marcherId,
        at: { x: m.x, y: m.y },
        drillRank: m.marcherId,
    }));

    it("re-split splits the remaining marchers again inside the same edges", () => {
        const out = resplit(params, 20, remaining, env, ctx);
        expect(out.members).toHaveLength(19);
        expect(out.spots).toBe(19);
        expect(filesOf(out.params) * ranksOf(out.params, 19)).toBeGreaterThan(
            0,
        );
        const xs = out.members.map((m) => m.x);
        expect(Math.min(...xs)).toBe(0);
    });
});

describe("a box recipe edited by hand (B4)", () => {
    it("counts its files as one when the stored count isn't a number", () => {
        for (const files of [NaN, Infinity, "4", null])
            expect(filesOf({ files } as unknown as BoxSize)).toBe(1);
        expect(filesOf({ files: 3.4 } as BoxSize)).toBe(3);
    });

    it.each([
        ["files", "four"],
        ["files", Infinity],
        ["across", "20"],
        ["across", -10],
        ["deep", null],
    ])(
        "isn't shown when its %s is %s, as a kind it can't draw isn't",
        (key, value) => {
            const r = recipe(4, { x: 40, y: 40 }, 10);
            const broken = {
                ...r,
                params: { ...(r.params as object), [key]: value },
            };
            const show = (rec: PlacedRecipe) =>
                boxesAt({
                    recipes: [rec],
                    beat: 8,
                    positionOf: (id) => at(r).get(id),
                });
            expect(show(r)).toHaveLength(1);
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            try {
                expect(show(broken)).toEqual([]);
                expect(warn).toHaveBeenCalledWith(
                    expect.stringContaining(`shape ${r.id}`),
                );
            } finally {
                warn.mockRestore();
            }
        },
    );
});
