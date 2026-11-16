import { afterEach, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { QueryClient } from "@tanstack/react-query";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { readShowTiming } from "@/timeline/showTiming";
import { pageEndBeat } from "@/timeline/timelineCanvas";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import type { CanvasEditPlan } from "@/timeline/timelineCoordinateWrites";
import { performUndo } from "@/db-functions/history";
import { createLastPage, deletePages } from "@/db-functions/page";
import { moveMarchersInTarget } from "@/db-functions/timelineMoves";
import { holdFromPreviousPage } from "@/db-functions/timelineHoldFromPrevious";
import { readHeldMarks } from "@/db-functions/timelineHeldMarks";
import {
    readAllShapeRecipes,
    saveShapeRecipeInTransaction,
    type ShapeRecipeMember,
    type ShapeRecipeRecord,
} from "@/db-functions/shapeRecipes";
import { partlyHeldAt, writePlacement } from "../tool/shapePlacement";

/**
 * A box placed on page 2 and Held through page 3 (owner, 2026-11-15: a hold links counts, a shape
 * only arranges marchers), then changed on page 3 through the shape tool's write: the change goes
 * to page 2, members and recipe, and page 3 gets no copy of its own. A box only partly Held there
 * is refused, writing nothing.
 */

afterEach(() => stopTimelineResolver());

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

/** Pages 1–4, three marchers placed in a box on page 2 and Held through page 3 */
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
    // Selecting one member holds the whole box
    const held = await holdFromPreviousPage({
        db,
        pageBox: PAGE3,
        marcherIds: [ids[0]!],
    });
    expect(held.held).toEqual([...ids].sort((a, b) => a - b));
    await timelineResolverSettled();
    return { ids, members, ...saved! };
};

/** Basic's edit at page 3's flag, as `planCanvasEdit` returns it */
const PAGE3_PLAN: CanvasEditPlan = {
    ok: true,
    target: { kind: "point", beat: PAGE3.end, box: PAGE3 },
    beat: PAGE3.end,
};

/** The change `commitBox` writes on page 3, where the box is Held from page 2 */
const change = (
    { recipeId, timelineId }: Awaited<ReturnType<typeof show>>,
    params: Record<string, unknown>,
    members: readonly ShapeRecipeMember[],
) =>
    writePlacement(
        {
            recipe: { ...BOX, params: { ...BOX.params, ...params } },
            members,
            replaces: { id: recipeId, timelineId },
            setAll: true,
        },
        new QueryClient(),
        "Error editing the shape",
        PAGE3_PLAN,
    );

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

const undoSteps = async (db: DbConnection) =>
    new Set(
        (await db.select().from(schema.history_undo).all()).map(
            (r) => r.history_group,
        ),
    ).size;

const recipes = async (db: DbConnection) =>
    (await readAllShapeRecipes(db)).map((r) => ({
        id: r.id,
        timelineId: r.timelineId,
        params: r.params,
        members: r.members.map((m) => [m.marcherId, m.x, m.y]),
    }));

/** Where `id` stands at pages 2's and 3's flags */
const atPages2And3 = async (db: DbConnection, id: number) => {
    await timelineResolverSettled();
    const pages = [...(await readShowTiming(db)).pages]
        .sort((a, b) => a.order - b.order)
        .filter((p) => p.name === "2" || p.name === "3");
    return pages.map((p) => resolver().positionAt(id, pageEndBeat(p)));
};

describeDbTests("a box Held from an earlier page, changed there", (it) => {
    it("moving it moves page 2's box, members and recipe, with no copy on page 3, in one undo step", async ({
        db,
        marchersAndPages: _,
    }) => {
        const placed = await show(db);
        const before = await recipes(db);
        const steps = await undoSteps(db);
        const moved = placed.members.map((m) => ({ ...m, x: m.x + 40 }));
        expect(await change(placed, { center: "moved" }, moved)).toBe(true);
        await timelineResolverSettled();

        expect(await page3Rows(db)).toEqual([]);
        const after = await recipes(db);
        expect(after).toHaveLength(1);
        expect(after[0]!.id).toBe(placed.recipeId);
        expect(after[0]!.timelineId).toBe(placed.timelineId);
        expect(after[0]!.params).toMatchObject({ center: "moved" });
        for (const m of moved)
            expect(await atPages2And3(db, m.marcherId)).toEqual([
                [m.x, m.y],
                [m.x, m.y],
            ]);
        expect(await undoSteps(db)).toBe(steps + 1);

        expect((await performUndo(db)).success).toBe(true);
        expect(await recipes(db)).toEqual(before);
        for (const m of placed.members)
            expect(await atPages2And3(db, m.marcherId)).toEqual([
                [m.x, m.y],
                [m.x, m.y],
            ]);
    });

    it("a pivot change that moves nobody changes page 2's recipe, with no copy on page 3", async ({
        db,
        marchersAndPages: _,
    }) => {
        const placed = await show(db);
        expect(await change(placed, { pivot: "se" }, placed.members)).toBe(
            true,
        );
        await timelineResolverSettled();
        expect(await page3Rows(db)).toEqual([]);
        const after = await recipes(db);
        expect(after).toHaveLength(1);
        expect(after[0]).toMatchObject({
            id: placed.recipeId,
            timelineId: placed.timelineId,
            params: { pivot: "se" },
        });
    });

    it("partly Held, it's refused with nothing written, and the shape tool can tell before it shows the edit", async ({
        db,
        marchersAndPages: _,
    }) => {
        const placed = await show(db);
        // One member's hold taken away: page 3 is Not defined for it
        await db
            .delete(schema.timeline_held_marks)
            .where(eq(schema.timeline_held_marks.marcher_id, placed.ids[2]!));
        const marks = await readHeldMarks(db);
        expect(partlyHeldAt(placed.ids, PAGE3_PLAN, marks)).toBe(true);
        expect(partlyHeldAt(placed.ids.slice(0, 2), PAGE3_PLAN, marks)).toBe(
            false,
        );
        const before = await recipes(db);
        const rows = await db.select().from(schema.timeline_assignments).all();
        const steps = await undoSteps(db);
        const moved = placed.members.map((m) => ({ ...m, x: m.x + 40 }));
        expect(await change(placed, { center: "moved" }, moved)).toBe(false);
        expect(await recipes(db)).toEqual(before);
        expect(
            await db.select().from(schema.timeline_assignments).all(),
        ).toEqual(rows);
        expect(await undoSteps(db)).toBe(steps);
    });
});
