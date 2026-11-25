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
import { performUndo, transactionWithHistory } from "@/db-functions/history";
import { holdFromPreviousPage } from "@/db-functions/timelineHoldFromPrevious";
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
    let saved: { recipeId: number; beat: number } | undefined;
    await moveMarchersInTarget({
        db,
        target: { kind: "range", ...PAGE2 },
        moves: members.map(({ marcherId, x, y }) => ({ marcherId, x, y })),
        afterWrite: async (tx, beat) => {
            const recipeId = await saveShapeRecipeInTransaction({
                tx,
                beat,
                recipe: BOX,
                members,
            });
            saved = { recipeId, beat };
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
    { members, recipeId, beat }: Awaited<ReturnType<typeof show>>,
    pivot: string,
) =>
    writePlacement(
        {
            recipe: { ...BOX, params: { ...BOX.params, pivot } },
            members,
            replaces: { id: recipeId, beat, shapeKey: recipeId },
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
        beat: r.beat,
        shapeKey: r.shapeKey,
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
            beat: placed.beat,
            shapeKey: placed.recipeId,
            pivot: "nw",
        });
        const copy = after.find((r) => r.id !== placed.recipeId);
        expect(copy?.pivot).toBe("se");
        // At page 3's count, a mark of the same shape
        expect(copy?.beat).toBe(PAGE3.end);
        expect(copy?.shapeKey).toBe(placed.recipeId);
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
                beat: placed.beat,
                shapeKey: placed.recipeId,
                pivot: "se",
            },
        ]);
        expect(await undoSteps(db)).toBe(steps + 1);

        await performUndo(db);
        expect(await pivots(db)).toEqual([
            {
                id: placed.recipeId,
                beat: placed.beat,
                shapeKey: placed.recipeId,
                pivot: "nw",
            },
        ]);
    });
});

describeDbTests(
    "a shape edited on a later page with only Held members",
    (it) => {
        /**
         * Two marchers moved on page 1 and Held through pages 2 and 3, and a box listing them at page
         * 2's flag (17), as 0030 stores a recipe placed there: on page 3 nobody arrives, they stand still
         * through it from their hold
         */
        const heldShow = async (db: DbConnection) => {
            const pages = [...(await readShowTiming(db)).pages].sort(
                (x, y) => x.order - y.order,
            );
            await deletePages({
                db,
                pageIds: new Set(
                    pages.filter((p) => p.order >= 2).map((p) => p.id),
                ),
            });
            for (let i = 0; i < 3; i++)
                await createLastPage({ db, newPageCounts: 8 });
            await startTimelineResolver(db);
            const [a, b] = resolver().marcherIds() as [number, number];
            const members: ShapeRecipeMember[] = [
                { marcherId: a, slot: 0, x: 100, y: 50 },
                { marcherId: b, slot: 1, x: 120, y: 50 },
            ];
            await moveMarchersInTarget({
                db,
                target: { kind: "range", start: 1, end: 9 },
                moves: members.map(({ marcherId, x, y }) => ({
                    marcherId,
                    x,
                    y,
                })),
            });
            await timelineResolverSettled();
            for (const pageBox of [PAGE2, PAGE3])
                expect(
                    (
                        await holdFromPreviousPage({
                            db,
                            pageBox,
                            marcherIds: [a, b],
                        })
                    ).held,
                ).toHaveLength(2);
            const recipeId = await transactionWithHistory(db, "place", (tx) =>
                saveShapeRecipeInTransaction({
                    tx,
                    beat: PAGE2.end,
                    recipe: BOX,
                    members,
                }),
            );
            await timelineResolverSettled();
            return { a, b, members, recipeId };
        };

        it("moves the shape where they're held from, positions and recipe in one undo step", async ({
            db,
            marchersAndPages: _,
        }) => {
            const { a, b, members, recipeId } = await heldShow(db);
            const before = await readAllShapeRecipes(db);
            const steps = await undoSteps(db);
            const moved = members.map((m) => ({ ...m, y: m.y + 20 }));
            expect(
                await writePlacement(
                    {
                        recipe: BOX,
                        members: moved,
                        replaces: {
                            id: recipeId,
                            beat: PAGE2.end,
                            shapeKey: recipeId,
                        },
                        setAll: true,
                    },
                    new QueryClient(),
                    "Error editing the shape",
                    PAGE3_PLAN,
                ),
            ).toBe(true);
            await timelineResolverSettled();

            // The whole hold moved: they stand on the new spots at the shape's count and on page 3
            for (const beat of [PAGE2.end, PAGE3.end])
                expect(
                    [a, b].map((id) => resolver().positionAt(id, beat)),
                ).toEqual([
                    [100, 70],
                    [120, 70],
                ]);
            // The shape's own recipe changed, at its own count; no copy on page 3
            const after = await readAllShapeRecipes(db);
            expect(after.map((r) => [r.id, r.beat])).toEqual([
                [recipeId, PAGE2.end],
            ]);
            expect(after[0]!.members.map((m) => m.y)).toEqual([70, 70]);
            expect(await undoSteps(db)).toBe(steps + 1);

            // One undo puts both back
            await performUndo(db);
            await timelineResolverSettled();
            expect(await readAllShapeRecipes(db)).toEqual(before);
            expect(
                [a, b].map((id) => resolver().positionAt(id, PAGE3.end)),
            ).toEqual([
                [100, 50],
                [120, 50],
            ]);
        });
    },
);
