import { afterEach, describe, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { readShowTiming } from "@/timeline/showTiming";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import { performRedo, performUndo, transactionWithHistory } from "../history";
import {
    followPlacedBoxChanges,
    invalidatePlacedBoxes,
    placedBoxesRead,
    usePlacedBoxStore,
} from "@/shapes/placed/placedBoxStore";
import { createLastPage, deletePages } from "../page";
import { deleteMarchers } from "../marcher";
import {
    moveMarchersInTarget,
    type TimelineEditTarget,
} from "../timelineMoves";
import { mergeMoves, splitMarchersIntoNewMove } from "../timelineSplitMoves";
import { deleteTimeline } from "../timelineCommands";
import { addMarchersToTimeline } from "../timelineMembership";
import {
    readAllShapeRecipes,
    readShapeRecipes,
    saveShapeRecipeInTransaction,
    type ShapeRecipeRecord,
} from "../shapeRecipes";

/**
 * Shape recipes (ADR 0006) are saved in the same edit as the positions they place, so undo and
 * redo take both. A recipe stands at a count (revision of 2026-11-22): it lists every marcher
 * placed in it whichever move brings it there, splits and merges leave it alone, a marcher placed
 * by a new shape leaves any other shape at that count, and a recipe goes with the moves that
 * brought all its members there (the upkeep after each edit).
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
    const [a, b, c] = resolver().marcherIds();
    return { a: a!, b: b!, c: c! };
};

/** Places `ids` on page 2 at x = 100, 120, ... with `recipe`, like the Shape tool's Place */
const place = async (
    db: DbConnection,
    ids: number[],
    recipe: ShapeRecipeRecord,
    target: TimelineEditTarget = { kind: "range", ...PAGE2 },
) => {
    let saved: number | null = null;
    await moveMarchersInTarget({
        db,
        target,
        moves: ids.map((marcherId, i) => ({
            marcherId,
            x: 100 + 20 * i,
            y: 50,
        })),
        afterWrite: async (tx, beat) => {
            saved = await saveShapeRecipeInTransaction({
                tx,
                beat,
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

/** The count a placed recipe stands at, or null once it's gone */
const recipeBeat = async (db: DbConnection, recipeId: number) =>
    (
        await db
            .select({ beat: schema.timeline_shape_recipes.beat })
            .from(schema.timeline_shape_recipes)
            .where(eq(schema.timeline_shape_recipes.id, recipeId))
            .get()
    )?.beat ?? null;

/** The move marcher `id` arrives at count `beat` in */
const moveArriving = async (db: DbConnection, id: number, beat: number) => {
    const a = schema.timeline_assignments;
    const t = schema.timeline_transitions;
    const row = await db
        .select({ timelineId: t.timeline_id })
        .from(a)
        .innerJoin(t, eq(t.id, a.transition_id))
        .where(and(eq(a.marcher_id, id), eq(a.end_beat, beat)))
        .get();
    return row!.timelineId;
};

describeDbTests("Shape recipes", (it) => {
    it("are saved with the positions, at the count placed at, and undo and redo take both", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const id = await place(db, [a, b], ARC);
        expect(await recipeBeat(db, id)).toBe(PAGE2.end);
        const stored = await readShapeRecipes({
            db,
            beat: PAGE2.end,
            marcherIds: [a],
        });
        expect(stored).toEqual([
            {
                id,
                beat: PAGE2.end,
                // A new shape is its own: its key is its id
                shapeKey: id,
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
                beat: PAGE2.end,
                marcherIds: [b],
            }),
        ).toEqual(stored);
    });

    it("a new shape takes its marchers out of the older recipe at its count", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b, c } = await show(db);
        const arc = await place(db, [a, b, c], ARC);
        const line = await place(db, [b, c], LINE);
        const stored = await readShapeRecipes({
            db,
            beat: PAGE2.end,
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
            beat: PAGE2.end,
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
            afterWrite: async (tx, beat) => {
                expect(beat).toBe(0);
                await saveShapeRecipeInTransaction({
                    tx,
                    beat,
                    recipe: LINE,
                    members: [
                        { marcherId: a, slot: 0, x: 11, y: 22 },
                        { marcherId: b, slot: 1, x: 33, y: 22 },
                    ],
                });
            },
        });
        expect(
            await readShapeRecipes({ db, beat: 0, marcherIds: [a] }),
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

    it("an edited recipe keeps its id, its count and its key", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const id = await place(db, [a, b], ARC);
        const timelineId = await moveArriving(db, a, PAGE2.end);
        let replaced: number | null = null;
        await moveMarchersInTarget({
            db,
            target: { kind: "timeline", timelineId },
            moves: [
                { marcherId: a, x: 0, y: 0 },
                { marcherId: b, x: 40, y: 0 },
            ],
            afterWrite: async (tx, beat) => {
                // The move's end: the count it writes at
                expect(beat).toBe(PAGE2.end);
                replaced = await saveShapeRecipeInTransaction({
                    tx,
                    beat,
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
            beat: PAGE2.end,
            marcherIds: [a],
        });
        expect(recipe!.shapeKey).toBe(id);
        expect(recipe!.params).toEqual({ bulge: 9 });
        expect(recipe!.members.map((m) => [m.x, m.y])).toEqual([
            [0, 0],
            [40, 0],
        ]);
    });

    it("a mark of a shape carried to a later count takes the shape's key", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const id = await place(db, [a, b], ARC);
        const copy = await transactionWithHistory(db, "copy", (tx) =>
            saveShapeRecipeInTransaction({
                tx,
                beat: PAGE2.end + 8,
                recipe: ARC,
                members: [
                    { marcherId: a, slot: 0, x: 100, y: 50 },
                    { marcherId: b, slot: 1, x: 120, y: 50 },
                ],
                shapeKey: id,
            }),
        );
        const all = await readAllShapeRecipes(db);
        expect(all.map((r) => [r.id, r.beat, r.shapeKey])).toEqual([
            [id, PAGE2.end, id],
            [copy, PAGE2.end + 8, id],
        ]);
    });

    it("deleting a shape's last marcher deletes the shape, and undo brings both back", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        await place(db, [a, b], ARC);
        const before = await db
            .select()
            .from(schema.timeline_shape_recipes)
            .all();

        await deleteMarchers({ db, marcherIds: new Set([a]) });
        expect(
            await db.select().from(schema.timeline_shape_recipes).all(),
        ).toEqual(before);
        await deleteMarchers({ db, marcherIds: new Set([b]) });
        expect(
            await db.select().from(schema.timeline_shape_recipes).all(),
        ).toEqual([]);

        await performUndo(db);
        expect(
            await db.select().from(schema.timeline_shape_recipes).all(),
        ).toEqual(before);
        expect(
            (
                await db
                    .select()
                    .from(schema.timeline_shape_recipe_marchers)
                    .all()
            ).map((m) => m.marcher_id),
        ).toEqual([b]);
    });

    it("placed shapes follow undo and redo of an edit that only changed a recipe (a pivot drag)", async ({
        db,
        marchersAndPages: _,
    }) => {
        const stop = followPlacedBoxChanges();
        try {
            const { a, b } = await show(db);
            const id = await place(db, [a, b], ARC);
            const bulge = () =>
                (
                    usePlacedBoxStore
                        .getState()
                        .recipes.find((r) => r.id === id)?.params as
                        | { bulge: number }
                        | undefined
                )?.bulge;
            // The app re-reads after its own edits
            invalidatePlacedBoxes();
            await expect.poll(bulge).toBe(4);

            // No position changes, so the resolver hears of none of this
            await transactionWithHistory(db, "editRecipe", async (tx) => {
                await saveShapeRecipeInTransaction({
                    tx,
                    beat: PAGE2.end,
                    recipe: { ...ARC, params: { bulge: 9 } },
                    members: [
                        { marcherId: a, slot: 0, x: 100, y: 50 },
                        { marcherId: b, slot: 1, x: 120, y: 50 },
                    ],
                    replaces: id,
                });
            });
            invalidatePlacedBoxes();
            await expect.poll(bulge).toBe(9);
            await performUndo(db);
            await expect.poll(bulge).toBe(4);
            await performRedo(db);
            await expect.poll(bulge).toBe(9);
        } finally {
            stop();
        }
    });

    it("placed shapes are read back with their counts, nothing else needed (#514)", async ({
        db,
        marchersAndPages: _,
    }) => {
        const stop = followPlacedBoxChanges();
        try {
            const { a, b } = await show(db);
            const id = await place(db, [a, b], ARC);
            await placedBoxesRead();
            const { recipes } = usePlacedBoxStore.getState();
            expect(recipes.find((r) => r.id === id)?.beat).toBe(PAGE2.end);
        } finally {
            stop();
        }
    });

    it("lists a marcher who stands still through the count, with no move of its own there", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b, c } = await show(db);
        // c stands where it starts: page 2 writes nothing for it
        const [cx, cy] = resolver().positionAt(c, PAGE2.end);
        let id: number | null = null;
        await moveMarchersInTarget({
            db,
            target: { kind: "range", ...PAGE2 },
            moves: [
                { marcherId: a, x: 100, y: 50 },
                { marcherId: b, x: 120, y: 50 },
            ],
            afterWrite: async (tx, beat) => {
                id = await saveShapeRecipeInTransaction({
                    tx,
                    beat,
                    recipe: LINE,
                    members: [
                        { marcherId: a, slot: 0, x: 100, y: 50 },
                        { marcherId: b, slot: 1, x: 120, y: 50 },
                        { marcherId: c, slot: 2, x: cx!, y: cy! },
                    ],
                });
            },
        });
        await timelineResolverSettled();
        const [recipe] = await readShapeRecipes({
            db,
            beat: PAGE2.end,
            marcherIds: [c],
        });
        expect(recipe!.id).toBe(id);
        expect(recipe!.members.map((m) => m.marcherId)).toEqual([a, b, c]);
    });

    describe("with a move split off the page's (UI-25)", () => {
        /** a and b placed on page 2, then a split off into a move of its own over the same counts */
        const splitShow = async (db: DbConnection) => {
            const marchers = await show(db);
            const first = await place(db, [marchers.a, marchers.b], ARC);
            const pageMove = await moveArriving(db, marchers.a, PAGE2.end);
            const split = await splitMarchersIntoNewMove({
                db,
                timelineId: pageMove,
                marcherIds: [marchers.a],
            });
            await timelineResolverSettled();
            return {
                ...marchers,
                arc: first,
                pageMove,
                splitMove: split.timeline.id,
            };
        };

        /** Who recipe `id` lists, or null once it's gone */
        const membersOf = async (db: DbConnection, id: number) => {
            const [r] = (await readAllShapeRecipes(db)).filter(
                (x) => x.id === id,
            );
            return r ? r.members.map((m) => m.marcherId) : null;
        };

        it("splitting marchers off keeps them in the page's shape, at its count", async ({
            db,
            marchersAndPages: _,
        }) => {
            const { a, b, arc, splitMove } = await splitShow(db);
            expect(await moveArriving(db, a, PAGE2.end)).toBe(splitMove);
            expect(await membersOf(db, arc)).toEqual([a, b]);
            expect(await recipeBeat(db, arc)).toBe(PAGE2.end);
        });

        it("splitting every marcher off the page leaves its shape as it is, and undo too (#581)", async ({
            db,
            marchersAndPages: _,
        }) => {
            const { a, b } = await show(db);
            const arc = await place(db, [a, b], ARC);
            const pageMove = await moveArriving(db, a, PAGE2.end);
            const before = await readAllShapeRecipes(db);
            await splitMarchersIntoNewMove({
                db,
                timelineId: pageMove,
                marcherIds: [a, b],
            });
            await timelineResolverSettled();
            expect(await readAllShapeRecipes(db)).toEqual(before);
            expect(await membersOf(db, arc)).toEqual([a, b]);
            await performUndo(db);
            await timelineResolverSettled();
            expect(await readAllShapeRecipes(db)).toEqual(before);
        });

        it("a shape over marchers in different moves lists every one of them", async ({
            db,
            marchersAndPages: _,
        }) => {
            const { a, b, c, pageMove } = await splitShow(db);
            // a arrives in a move of its own; the shape is written to the page's
            const id = await place(db, [a, b, c], LINE, {
                kind: "range",
                ...PAGE2,
                timelineId: pageMove,
            });
            expect(await recipeBeat(db, id)).toBe(PAGE2.end);
            expect(await membersOf(db, id)).toEqual([a, b, c]);
        });

        it("in Basic mode too: a shape placed at the page's flag lists every marcher, whichever move it arrives in", async ({
            db,
            marchersAndPages: _,
        }) => {
            const { a, b } = await splitShow(db);
            const id = await place(db, [a, b], LINE, {
                kind: "point",
                beat: PAGE2.end,
                box: PAGE2,
            });
            expect(await recipeBeat(db, id)).toBe(PAGE2.end);
            expect(await membersOf(db, id)).toEqual([a, b]);
        });

        it("a shape placed in the split move takes its marchers out of the page's shape, at the same count, in one undo step", async ({
            db,
            marchersAndPages: _,
        }) => {
            const { a, b, c, arc, splitMove } = await splitShow(db);
            await place(db, [a, c], LINE, {
                kind: "range",
                ...PAGE2,
                timelineId: splitMove,
            });
            expect(await membersOf(db, arc)).toEqual([b]);
            await performUndo(db);
            expect(await membersOf(db, arc)).toEqual([a, b]);
        });

        it("merging the split move back keeps every shape and member, and undo too", async ({
            db,
            marchersAndPages: _,
        }) => {
            const { a, b, c, arc, pageMove, splitMove } = await splitShow(db);
            const line = await place(db, [a, c], LINE, {
                kind: "range",
                ...PAGE2,
                timelineId: splitMove,
            });
            const before = await readAllShapeRecipes(db);
            await mergeMoves({ db, sourceId: splitMove, targetId: pageMove });
            await timelineResolverSettled();
            expect(await readAllShapeRecipes(db)).toEqual(before);
            expect(await membersOf(db, arc)).toEqual([b]);
            expect(await membersOf(db, line)).toEqual([a, c]);
            // Where the shape put a is still where a stands at its count
            const member = before.find((r) => r.id === line)!.members[0]!;
            expect(resolver().positionAt(a, PAGE2.end)).toEqual([
                member.x,
                member.y,
            ]);
            await performUndo(db);
            await timelineResolverSettled();
            expect(await readAllShapeRecipes(db)).toEqual(before);
        });

        it("a shape saved at a page's flag leaves alone a shape at another count (a move that only passes over the flag)", async ({
            db,
            marchersAndPages: _,
        }) => {
            const { a } = await show(db);
            const arc = await place(db, [a], ARC);
            // An Expert move over page 2's flag, on a layer above a's page move
            const { timelineId: over } = await addMarchersToTimeline({
                db,
                range: { start: PAGE2.end - 4, end: PAGE2.end + 4 },
                marcherIds: [a],
            });
            await timelineResolverSettled();
            const theirs = await place(db, [a], LINE, {
                kind: "timeline",
                timelineId: over,
            });
            expect(await recipeBeat(db, theirs)).toBe(PAGE2.end + 4);
            await transactionWithHistory(db, "editShape", (tx) =>
                saveShapeRecipeInTransaction({
                    tx,
                    beat: PAGE2.end,
                    recipe: LINE,
                    members: [{ marcherId: a, slot: 0, x: 100, y: 50 }],
                    replaces: arc,
                }),
            );
            expect(await membersOf(db, arc)).toEqual([a]);
            expect(await membersOf(db, theirs)).toEqual([a]);
        });
    });

    describe("upkeep in place of the cascade from moves", () => {
        it("deleting the move that brought every member deletes the shape in the same undo step", async ({
            db,
            marchersAndPages: _,
        }) => {
            const { a, b } = await show(db);
            const arc = await place(db, [a, b], ARC);
            const pageMove = await moveArriving(db, a, PAGE2.end);
            const before = await readAllShapeRecipes(db);
            await deleteTimeline({ db, timelineId: pageMove });
            expect(await recipeBeat(db, arc)).toBeNull();
            await performUndo(db);
            expect(await readAllShapeRecipes(db)).toEqual(before);
        });

        it("keeps a shape while any member still arrives at its count, its other members listed", async ({
            db,
            marchersAndPages: _,
        }) => {
            const { a, b, arc, splitMove } = await (async () => {
                const marchers = await show(db);
                const first = await place(db, [marchers.a, marchers.b], ARC);
                const split = await splitMarchersIntoNewMove({
                    db,
                    timelineId: await moveArriving(db, marchers.a, PAGE2.end),
                    marcherIds: [marchers.a],
                });
                await timelineResolverSettled();
                return {
                    ...marchers,
                    arc: first,
                    splitMove: split.timeline.id,
                };
            })();
            await deleteTimeline({ db, timelineId: splitMove });
            expect(
                (await readAllShapeRecipes(db))
                    .find((r) => r.id === arc)
                    ?.members.map((m) => m.marcherId),
            ).toEqual([a, b]);
        });

        it("keeps a shape with a member standing still through its count", async ({
            db,
            marchersAndPages: _,
        }) => {
            const { a, c } = await show(db);
            const [cx, cy] = resolver().positionAt(c, PAGE2.end);
            let id: number | null = null;
            await moveMarchersInTarget({
                db,
                target: { kind: "range", ...PAGE2 },
                moves: [{ marcherId: a, x: 100, y: 50 }],
                afterWrite: async (tx, beat) => {
                    id = await saveShapeRecipeInTransaction({
                        tx,
                        beat,
                        recipe: LINE,
                        members: [
                            { marcherId: a, slot: 0, x: 100, y: 50 },
                            { marcherId: c, slot: 1, x: cx!, y: cy! },
                        ],
                    });
                },
            });
            await timelineResolverSettled();
            await deleteTimeline({
                db,
                timelineId: await moveArriving(db, a, PAGE2.end),
            });
            expect(await recipeBeat(db, id!)).toBe(PAGE2.end);
        });
    });
});
