import { afterEach, expect } from "vitest";
import { DbConnection, describeDbTests } from "@/test/base";
import { readShowTiming } from "@/timeline/showTiming";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import { performUndo } from "@/db-functions/history";
import { createLastPage, deletePages } from "@/db-functions/page";
import {
    moveMarchersInTarget,
    type TimelineEditTarget,
} from "@/db-functions/timelineMoves";
import {
    readAllShapeRecipes,
    saveShapeRecipeInTransaction,
} from "@/db-functions/shapeRecipes";
import { boxMembershipEdit } from "../placed/boxMembership";

/**
 * Placed boxes stay true to the field through coordinate edits
 * (docs/timeline/research/shapes/07-placed-boxes.md): moving every member moves the box, moving
 * some leaves holes, and an edit on a later page saves its own copy, all in the edit's undo step.
 */

afterEach(() => stopTimelineResolver());

const PAGE2 = { kind: "range", start: 9, end: 17 } as const;
const PAGE3 = { kind: "range", start: 17, end: 25 } as const;

const resolver = () => useTimelineResolverStore.getState().resolver!;

/** Pages 1–4, nobody moved yet */
const show = async (db: DbConnection) => {
    const pages = [...(await readShowTiming(db)).pages].sort(
        (a, b) => a.order - b.order,
    );
    await deletePages({
        db,
        pageIds: new Set(pages.filter((p) => p.order >= 2).map((p) => p.id)),
    });
    for (let i = 0; i < 3; i++) await createLastPage({ db, newPageCounts: 8 });
    await startTimelineResolver(db);
    return resolver().marcherIds().slice(0, 4);
};

/** A 2 × 2 box, 20 apart, its back-left marcher at (100, 40) */
const SPOTS = [
    { x: 100, y: 40 },
    { x: 120, y: 40 },
    { x: 100, y: 60 },
    { x: 120, y: 60 },
];
const BOX = {
    center: { x: 110, y: 50 },
    rotation: 0,
    files: 2,
    across: 20,
    deep: 20,
    pattern: "grid",
    shortRank: "center",
    shortRankAt: "back",
    spots: 4,
};

/** Places the box on page 2, like the Shape tool's Place */
const place = async (db: DbConnection, ids: readonly number[]) => {
    await moveMarchersInTarget({
        db,
        target: PAGE2,
        moves: ids.map((marcherId, i) => ({ marcherId, ...SPOTS[i]! })),
        afterWrite: async (tx, timelineId) => {
            await saveShapeRecipeInTransaction({
                tx,
                timelineId,
                recipe: {
                    kind: "block",
                    kindVersion: 1,
                    params: BOX,
                    orderMode: "nearest",
                    reverse: false,
                },
                members: ids.map((marcherId, i) => ({
                    marcherId,
                    slot: i,
                    ...SPOTS[i]!,
                })),
            });
        },
    });
    await timelineResolverSettled();
};

/** A coordinate edit with box membership kept, as the app's edits do */
const edit = async (
    db: DbConnection,
    target: TimelineEditTarget & { kind: "range" },
    moves: { marcherId: number; x: number; y: number }[],
) => {
    const membership = boxMembershipEdit({
        moves,
        beat: target.end,
        positionOf: (id) => {
            const [x, y] = resolver().positionAt(id, target.end);
            return { x, y };
        },
    });
    await moveMarchersInTarget({
        db,
        target,
        moves,
        afterWrite: membership.afterWrite,
    });
    await timelineResolverSettled();
    return membership.leaves;
};

describeDbTests("Placed box membership", (it) => {
    it("moving every member the same way moves the box", async ({
        db,
        marchersAndPages: _,
    }) => {
        const ids = await show(db);
        await place(db, ids);
        const [before] = await readAllShapeRecipes(db);
        const leaves = await edit(
            db,
            PAGE2,
            ids.map((marcherId, i) => ({
                marcherId,
                x: SPOTS[i]!.x + 10,
                y: SPOTS[i]!.y,
            })),
        );
        expect(leaves).toEqual([]);
        const after = await readAllShapeRecipes(db);
        expect(after).toHaveLength(1);
        expect(after[0]!.id).toBe(before!.id);
        expect(after[0]!.params).toMatchObject({ center: { x: 120, y: 50 } });
        expect(after[0]!.members.map((m) => m.x)).toEqual([110, 130, 110, 130]);
    });

    it("moving one member takes it out and leaves a hole, one undo step", async ({
        db,
        marchersAndPages: _,
    }) => {
        const ids = await show(db);
        await place(db, ids);
        const leaves = await edit(db, PAGE2, [
            { marcherId: ids[1]!, x: 300, y: 300 },
        ]);
        expect(leaves.map((l) => l.left)).toEqual([[ids[1]]]);
        const [after] = await readAllShapeRecipes(db);
        expect(after!.members.map((m) => m.marcherId)).toEqual([
            ids[0],
            ids[2],
            ids[3],
        ]);
        expect(after!.params).toMatchObject({ spots: 4 });

        await performUndo(db);
        await timelineResolverSettled();
        const [undone] = await readAllShapeRecipes(db);
        expect(undone!.members).toHaveLength(4);
        expect(resolver().positionAt(ids[1]!, PAGE2.end)).toEqual([120, 40]);
    });

    it("an edit on a later page copies the box there and leaves the earlier one", async ({
        db,
        marchersAndPages: _,
    }) => {
        const ids = await show(db);
        await place(db, ids);
        const [placed] = await readAllShapeRecipes(db);
        await edit(
            db,
            PAGE3,
            ids.map((marcherId, i) => ({
                marcherId,
                x: SPOTS[i]!.x,
                y: SPOTS[i]!.y + 20,
            })),
        );
        const after = await readAllShapeRecipes(db);
        expect(after).toHaveLength(2);
        expect(after.find((r) => r.id === placed!.id)).toEqual(placed);
        const copy = after.find((r) => r.id !== placed!.id)!;
        expect(copy.timelineId).not.toBe(placed!.timelineId);
        expect(copy.members.map((m) => m.y)).toEqual([60, 60, 80, 80]);
    });

    it("an edit on a later page that takes one member away offers no fill for a copy that kept no one", async ({
        db,
        marchersAndPages: _,
    }) => {
        const ids = await show(db);
        await place(db, ids);
        // Only the moved marcher is in page 3's move, so the copy there has none of the others
        const leaves = await edit(db, PAGE3, [
            { marcherId: ids[1]!, x: 300, y: 300 },
        ]);
        const stored = new Set(
            (await readAllShapeRecipes(db)).map((r) => r.id),
        );
        for (const leave of leaves) expect(stored).toContain(leave.recipeId);
        expect(leaves).toEqual([]);
    });

    it("an edit that touches no box writes nothing of its own", async ({
        db,
        marchersAndPages: _,
    }) => {
        const ids = await show(db);
        const leaves = await edit(db, PAGE2, [
            { marcherId: ids[0]!, x: 10, y: 10 },
        ]);
        expect(leaves).toEqual([]);
        expect(await readAllShapeRecipes(db)).toEqual([]);
    });
});
