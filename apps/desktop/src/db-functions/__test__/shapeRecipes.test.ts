import { afterEach, expect } from "vitest";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { readShowTiming } from "@/timeline/convert/writePageConversion";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import { performRedo, performUndo } from "../history";
import { createLastPage, deletePages } from "../page";
import { moveMarchersInTarget } from "../timelineMoves";
import {
    readShapeRecipes,
    saveShapeRecipeInTransaction,
    type ShapeRecipeRecord,
} from "../shapeRecipes";

keepFixturesInPageMode(
    "its tests trim the show, write timeline rows and set the flag themselves",
);

/**
 * Shape recipes (ADR 0004) are saved in the same edit as the positions they place, so undo and
 * redo take both, and a marcher placed by a new shape leaves the move's older recipe.
 */

afterEach(() => stopTimelineResolver());

const PAGE2 = { start: 9, end: 17 };
const ARC: ShapeRecipeRecord = {
    kind: "arc",
    kindVersion: 1,
    params: { bulge: 4 },
    orderMode: "keep",
    reverse: false,
};
const LINE: ShapeRecipeRecord = { ...ARC, kind: "line", params: {} };

const resolver = () => useTimelineResolverStore.getState().resolver!;

const setTimelineFlag = async (db: DbConnection) => {
    await db.delete(schema.workspace_settings);
    await db.insert(schema.workspace_settings).values({
        id: 1,
        json_data: JSON.stringify({ timelineMode: true }),
    });
};

/** Pages 1–4 in timeline mode, nobody moved yet */
const show = async (db: DbConnection) => {
    const pages = [...(await readShowTiming(db)).pages].sort(
        (a, b) => a.order - b.order,
    );
    await deletePages({
        db,
        pageIds: new Set(pages.filter((p) => p.order >= 2).map((p) => p.id)),
    });
    for (let i = 0; i < 3; i++) await createLastPage({ db, newPageCounts: 8 });
    await setTimelineFlag(db);
    await startTimelineResolver(db);
    const [a, b, c] = resolver().marcherIds();
    return { a: a!, b: b!, c: c! };
};

/** Places `ids` on page 2 at x = 100, 120, ... with `recipe`, like the Shape tool's Place */
const place = async (
    db: DbConnection,
    ids: number[],
    recipe: ShapeRecipeRecord,
) => {
    let saved: number | null = null;
    await moveMarchersInTarget({
        db,
        target: { kind: "range", ...PAGE2 },
        moves: ids.map((marcherId, i) => ({
            marcherId,
            x: 100 + 20 * i,
            y: 50,
        })),
        afterWrite: async (tx, timelineId) => {
            saved = await saveShapeRecipeInTransaction({
                tx,
                timelineId,
                recipe,
                members: ids.map((marcherId, i) => ({
                    marcherId,
                    slot: i,
                    x: 100 + 20 * i,
                    y: 50,
                })),
            });
        },
    });
    await timelineResolverSettled();
    return saved!;
};

const page2Timeline = async (db: DbConnection) =>
    (
        await db
            .select({ id: schema.timelines.id })
            .from(schema.timelines)
            .all()
    ).map((r) => r.id)[0]!;

describeDbTests("Shape recipes", (it) => {
    it("are saved with the positions, and undo and redo take both", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const id = await place(db, [a, b], ARC);
        const timelineId = await page2Timeline(db);
        const stored = await readShapeRecipes({
            db,
            timelineId,
            marcherIds: [a],
        });
        expect(stored).toEqual([
            {
                id,
                timelineId,
                ...ARC,
                members: [
                    { marcherId: a, slot: 0, x: 100, y: 50 },
                    { marcherId: b, slot: 1, x: 120, y: 50 },
                ],
            },
        ]);

        await performUndo(db);
        await timelineResolverSettled();
        expect(
            await db.select().from(schema.timeline_shape_recipes).all(),
        ).toEqual([]);
        expect(
            await db.select().from(schema.timeline_shape_recipe_marchers).all(),
        ).toEqual([]);

        await performRedo(db);
        await timelineResolverSettled();
        expect(
            await readShapeRecipes({
                db,
                timelineId: await page2Timeline(db),
                marcherIds: [b],
            }),
        ).toEqual(stored);
    });

    it("a new shape takes its marchers out of the move's older recipe", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b, c } = await show(db);
        const arc = await place(db, [a, b, c], ARC);
        const line = await place(db, [b, c], LINE);
        const timelineId = await page2Timeline(db);
        const stored = await readShapeRecipes({
            db,
            timelineId,
            marcherIds: [a, b, c],
        });
        expect(
            stored.map((r) => [
                r.id,
                r.kind,
                r.members.map((m) => m.marcherId),
            ]),
        ).toEqual([
            [arc, "arc", [a]],
            [line, "line", [b, c]],
        ]);

        // Placing the last one elsewhere empties the arc, which goes
        await place(db, [a], LINE);
        const after = await readShapeRecipes({
            db,
            timelineId,
            marcherIds: [a, b, c],
        });
        expect(after.some((r) => r.id === arc)).toBe(false);
    });

    it("at Home, too: one undo takes back the homes and the recipe", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const homesBefore = await db
            .select({ id: schema.marchers.id, x: schema.marchers.home_x })
            .from(schema.marchers)
            .all();
        await moveMarchersInTarget({
            db,
            target: { kind: "home" },
            moves: [
                { marcherId: a, x: 11, y: 22 },
                { marcherId: b, x: 33, y: 22 },
            ],
            afterWrite: async (tx, timelineId) => {
                expect(timelineId).toBeNull();
                await saveShapeRecipeInTransaction({
                    tx,
                    timelineId,
                    recipe: LINE,
                    members: [
                        { marcherId: a, slot: 0, x: 11, y: 22 },
                        { marcherId: b, slot: 1, x: 33, y: 22 },
                    ],
                });
            },
        });
        expect(
            await readShapeRecipes({ db, timelineId: null, marcherIds: [a] }),
        ).toHaveLength(1);
        await performUndo(db);
        expect(
            await db
                .select({ id: schema.marchers.id, x: schema.marchers.home_x })
                .from(schema.marchers)
                .all(),
        ).toEqual(homesBefore);
        expect(
            await db.select().from(schema.timeline_shape_recipes).all(),
        ).toEqual([]);
    });

    it("an edited recipe keeps its id", async ({ db, marchersAndPages: _ }) => {
        const { a, b } = await show(db);
        const id = await place(db, [a, b], ARC);
        const timelineId = await page2Timeline(db);
        let replaced: number | null = null;
        await moveMarchersInTarget({
            db,
            target: { kind: "timeline", timelineId },
            moves: [
                { marcherId: a, x: 0, y: 0 },
                { marcherId: b, x: 40, y: 0 },
            ],
            afterWrite: async (tx, written) => {
                replaced = await saveShapeRecipeInTransaction({
                    tx,
                    timelineId: written,
                    recipe: { ...ARC, params: { bulge: 9 } },
                    members: [
                        { marcherId: a, slot: 0, x: 0, y: 0 },
                        { marcherId: b, slot: 1, x: 40, y: 0 },
                    ],
                    replaces: id,
                });
            },
        });
        expect(replaced).toBe(id);
        const [recipe] = await readShapeRecipes({
            db,
            timelineId,
            marcherIds: [a],
        });
        expect(recipe!.params).toEqual({ bulge: 9 });
        expect(recipe!.members.map((m) => [m.x, m.y])).toEqual([
            [0, 0],
            [40, 0],
        ]);
    });
});
