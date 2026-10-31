import { afterEach, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { QueryClient } from "@tanstack/react-query";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { readShowTiming } from "@/timeline/showTiming";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import { useBasicLocksStore } from "@/timeline/basicLocks";
import type { PageBox } from "@/stores/TimelineSelectionStore";
import type { CanvasEditPlan } from "@/timeline/timelineCoordinateWrites";
import { performUndo } from "@/db-functions/history";
import { createLastPage, deletePages } from "@/db-functions/page";
import { moveMarchersInTarget } from "@/db-functions/timelineMoves";
import {
    readAllShapeRecipes,
    saveShapeRecipeInTransaction,
    type ShapeRecipeMember,
    type ShapeRecipeRecord,
} from "@/db-functions/shapeRecipes";
import { writePlacement } from "../tool/shapePlacement";

/**
 * A box placed on one page and only carried onto the next (its marchers stand still there), then
 * edited on that later page with nobody moving: a pivot change (#492, #499; the fallback is #501). `commitBox` asks for
 * `setAll` there, so the later page gets its own copy and the earlier page keeps its pivot; but
 * when Basic locks some of the members on the later page, a copy without them would drop them
 * from the shape, so the change falls back to the shared recipe.
 */

afterEach(() => {
    stopTimelineResolver();
    useBasicLocksStore.setState({ boxes: [], locked: new Map() });
});

const PAGE2 = { start: 9, end: 17 };
const PAGE3 = { start: 17, end: 25 };
const BOX: ShapeRecipeRecord = {
    kind: "box",
    kindVersion: 1,
    params: { pivot: "nw", spots: 3 },
    orderMode: "nearest",
    reverse: false,
};

const resolver = () => useTimelineResolverStore.getState().resolver!;

/** Pages 1–4 with three marchers placed in a box on page 2, the only page they move on */
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
    const ids = resolver().marcherIds().slice(0, 3);
    const members: ShapeRecipeMember[] = ids.map((marcherId, i) => ({
        marcherId,
        slot: i,
        x: 100 + 20 * i,
        y: 50,
    }));
    let saved: { recipeId: number; timelineId: number | null } | undefined;
    await moveMarchersInTarget({
        db,
        target: { kind: "range", ...PAGE2 },
        moves: members.map(({ marcherId, x, y }) => ({ marcherId, x, y })),
        afterWrite: async (tx, timelineId) => {
            const recipeId = await saveShapeRecipeInTransaction({
                tx,
                timelineId,
                recipe: BOX,
                members,
            });
            saved = { recipeId, timelineId };
        },
    });
    await timelineResolverSettled();
    return { ids, members, ...saved! };
};

/** Basic's edit at page 3's flag, as `planCanvasEdit` returns it */
const PAGE3_PLAN: CanvasEditPlan = {
    ok: true,
    target: { kind: "point", beat: PAGE3.end, box: PAGE3 },
    beat: PAGE3.end,
};

/** The pivot change `commitBox` writes on page 3: nobody moves, the earlier page's recipe replaced */
const changePivot = (
    { members, recipeId, timelineId }: Awaited<ReturnType<typeof show>>,
    pivot: string,
) =>
    writePlacement(
        {
            recipe: { ...BOX, params: { ...BOX.params, pivot } },
            members,
            replaces: { id: recipeId, timelineId },
            setAll: true,
        },
        new QueryClient(),
        "Error editing the shape",
        PAGE3_PLAN,
    );

/** Rows over page 3 (the later page's own copy would write one per member) */
const page3Rows = (db: DbConnection) =>
    db
        .select()
        .from(schema.timeline_assignments)
        .where(
            and(
                eq(schema.timeline_assignments.start_beat, PAGE3.start),
                eq(schema.timeline_assignments.end_beat, PAGE3.end),
            ),
        )
        .all();

const rowCount = async (db: DbConnection) =>
    (await db.select().from(schema.timeline_assignments).all()).length;

const undoSteps = async (db: DbConnection) =>
    new Set(
        (await db.select().from(schema.history_undo).all()).map(
            (r) => r.history_group,
        ),
    ).size;

const pivots = async (db: DbConnection) =>
    (await readAllShapeRecipes(db)).map((r) => ({
        id: r.id,
        timelineId: r.timelineId,
        pivot: (r.params as { pivot: string }).pivot,
    }));

describeDbTests("a pivot change on a page a box is carried onto", (it) => {
    it("gives that page its own copy, and the earlier page keeps its pivot", async ({
        db,
        marchersAndPages: _,
    }) => {
        const placed = await show(db);
        const steps = await undoSteps(db);
        expect(await changePivot(placed, "se")).toBe(true);
        await timelineResolverSettled();

        expect((await page3Rows(db)).map((r) => r.marcher_id).sort()).toEqual(
            [...placed.ids].sort(),
        );
        const after = await pivots(db);
        expect(after).toHaveLength(2);
        expect(after.find((r) => r.id === placed.recipeId)).toEqual({
            id: placed.recipeId,
            timelineId: placed.timelineId,
            pivot: "nw",
        });
        const copy = after.find((r) => r.id !== placed.recipeId);
        expect(copy?.pivot).toBe("se");
        expect(copy?.timelineId).not.toBe(placed.timelineId);
        expect(await undoSteps(db)).toBe(steps + 1);
    });

    it("with some members locked there (Basic), sets no one and changes the shared pivot, in one undo step", async ({
        db,
        marchersAndPages: _,
    }) => {
        const placed = await show(db);
        // Stands in for a real lock (an Expert move of that marcher across page 3's flag): the
        // write only reads the store
        useBasicLocksStore.setState({
            boxes: [PAGE3 as PageBox],
            locked: new Map([
                [0, new Map([[placed.ids[0]!, "crossesFlag" as const]])],
            ]),
        });
        const steps = await undoSteps(db);
        const rows = await rowCount(db);
        expect(await changePivot(placed, "se")).toBe(true);
        await timelineResolverSettled();

        expect(await page3Rows(db)).toEqual([]);
        expect(await rowCount(db)).toBe(rows);
        expect(await pivots(db)).toEqual([
            {
                id: placed.recipeId,
                timelineId: placed.timelineId,
                pivot: "se",
            },
        ]);
        expect(await undoSteps(db)).toBe(steps + 1);

        await performUndo(db);
        expect(await pivots(db)).toEqual([
            {
                id: placed.recipeId,
                timelineId: placed.timelineId,
                pivot: "nw",
            },
        ]);
    });
});
