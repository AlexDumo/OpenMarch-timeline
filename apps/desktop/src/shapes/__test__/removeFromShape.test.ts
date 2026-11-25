import { afterEach, describe, expect, it as plainIt } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { describeDbTests } from "@/test/base";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import type { CanvasEditPlan } from "@/timeline/timelineCoordinateWrites";
import { performRedo, performUndo } from "@/db-functions/history";
import { readAllShapeRecipes } from "@/db-functions/shapeRecipes";
import { boxTool } from "../box/boxTool";
import { groupTool } from "../group/groupTool";
import type { GroupParams } from "../group/groupGeometry";
import { boxesAt, type PlacedBox } from "../placed/placedBox";
import {
    removedFromShape,
    writeRemoveFromShape,
} from "../placed/removeFromShape";
import { placementOf, writePlacement } from "../tool/shapePlacement";
import type { ToolEnv } from "../tool/toolKind";
import { openTool, pointerMove, press, release } from "../tool/toolMachine";
import type { ShapeContext } from "../types";

/**
 * Remove from shape (ADR 0006 revision of 2026-11-22, §9.1): a member whose spot is open is taken
 * out with its spot, the shape deals its spots again for the members left, and the whole edit is
 * one undo step. On the `marchersAndPages` show page 1's box is `[1, 9)`.
 */

afterEach(() => stopTimelineResolver());

const STEP = 10;
const env: ToolEnv = {
    stepPx: STEP,
    snap: false,
    constrain: false,
    gridSnap: (p) => p,
    hitRadius: 3,
};
const ctx: ShapeContext = { stepPx: STEP, snapPoint: (p) => p };
const PAGE1: CanvasEditPlan = {
    ok: true,
    target: { kind: "range", start: 1, end: 9 },
    beat: 9,
};
const FAR = { x: 900, y: 900 };

const resolver = () => useTimelineResolverStore.getState().resolver!;
const at = (id: number, beat: number) => {
    const [x, y] = resolver().positionAt(id, beat);
    return { x, y };
};

describeDbTests("Remove from shape", (it) => {
    it("takes an open spot's member and its spot out, deals the rest again, and undoes in one step", async ({
        db,
        marchersAndPages: _,
    }) => {
        await startTimelineResolver(db);
        const ids = resolver().marcherIds().slice(0, 4);
        expect(ids).toHaveLength(4);

        // A 4-marcher box placed on page 1
        let tool = openTool(
            boxTool,
            ids.map((id, i) => ({ id, at: at(id, 1), drillRank: i })),
        );
        tool = press(tool, { x: 100, y: 100 }, env);
        tool = pointerMove(tool, { x: 160, y: 160 }, env);
        tool = release(tool, ctx);
        const placement = placementOf(tool, ctx)!;
        expect(
            await writePlacement(placement, new QueryClient(), "err", PAGE1),
        ).toBe(true);
        await timelineResolverSettled();

        const [stored] = await readAllShapeRecipes(db);
        expect(stored!.members).toHaveLength(4);
        const away = ids[3]!;
        const awayAt = at(away, 9);
        // The fourth member stands elsewhere at the count: its spot is open
        const [box] = boxesAt({
            recipes: [stored!],
            beat: 9,
            positionOf: (id) => (id === away ? FAR : at(id, 9)),
        });
        expect(box!.open.map((o) => o.marcherId)).toEqual([away]);
        const before = {
            recipes: await readAllShapeRecipes(db),
            spots: ids.map((id) => at(id, 9)),
        };

        // Nothing to remove for a member on its spot
        expect(removedFromShape(box!, [ids[0]!], env, ctx)).toBeNull();
        const out = removedFromShape(box!, [away], env, ctx)!;
        expect(out.spots).toBe(3);
        expect(out.members.map((m) => m.marcherId).sort()).toEqual(
            ids.slice(0, 3).sort(),
        );

        expect(
            await writeRemoveFromShape({
                box: box!,
                marcherIds: [away],
                env,
                ctx,
                queryClient: new QueryClient(),
                plan: PAGE1,
            }),
        ).toBe(true);
        await timelineResolverSettled();

        const after = await readAllShapeRecipes(db);
        expect(after).toHaveLength(1);
        expect(after[0]!.id).toBe(stored!.id);
        expect(after[0]!.members.map((m) => m.marcherId).sort()).toEqual(
            ids.slice(0, 3).sort(),
        );
        expect((after[0]!.params as { spots: number }).spots).toBe(3);
        // The members left stand on their new spots; the removed one wasn't moved
        for (const m of after[0]!.members) {
            expect(at(m.marcherId, 9).x).toBeCloseTo(m.x, 6);
            expect(at(m.marcherId, 9).y).toBeCloseTo(m.y, 6);
        }
        expect(at(away, 9)).toEqual(awayAt);
        const afterSpots = ids.map((id) => at(id, 9));

        // One undo puts the shape and its members back as they were
        const undo = await performUndo(db);
        expect(undo.success, undo.error?.message).toBe(true);
        await timelineResolverSettled();
        expect(await readAllShapeRecipes(db)).toEqual(before.recipes);
        expect(ids.map((id) => at(id, 9))).toEqual(before.spots);

        // And redo does it again
        const redo = await performRedo(db);
        expect(redo.success, redo.error?.message).toBe(true);
        await timelineResolverSettled();
        expect(await readAllShapeRecipes(db)).toEqual(after);
        expect(ids.map((id) => at(id, 9))).toEqual(afterSpots);
    });
});

describe("Remove from shape on a group", () => {
    plainIt(
        "drops the spot from the group, its frame fitted to the spots kept, which stay put",
        () => {
            // A 2 × 2 group; its bottom-right member (slot 3) is away
            const params: GroupParams = {
                center: { x: 620, y: 320 },
                rotation: 0,
                points: [
                    { x: -20, y: -20 },
                    { x: 20, y: -20 },
                    { x: -20, y: 20 },
                    { x: 20, y: 20 },
                ],
            };
            const members = groupTool.shape
                .generate(params, 4, ctx)
                .map((p, slot) => ({
                    marcherId: slot + 1,
                    slot,
                    x: p.x,
                    y: p.y,
                }));
            const box: PlacedBox = {
                recipe: {
                    id: 1,
                    beat: 17,
                    shapeKey: 1,
                    kind: "group",
                    kindVersion: 1,
                    params: { ...params, spots: 4 },
                    orderMode: "nearest",
                    reverse: false,
                    members,
                },
                kind: groupTool,
                params,
                spots: 4,
                endBeat: 17,
                open: [{ ...members[3]!, taken: false }],
            };
            const out = removedFromShape(box, [4], env, ctx)!;
            const kept = out.params as unknown as GroupParams;
            expect(out.spots).toBe(3);
            expect(kept.points).toHaveLength(3);
            // Its frame is the three spots' bounds: the same, since they still span both ways
            expect(groupTool.frameOf(kept, 3).halfWidth).toBe(20);
            for (const m of out.members) {
                const was = members.find((w) => w.marcherId === m.marcherId)!;
                expect(m.x).toBeCloseTo(was.x, 9);
                expect(m.y).toBeCloseTo(was.y, 9);
            }
        },
    );
});
