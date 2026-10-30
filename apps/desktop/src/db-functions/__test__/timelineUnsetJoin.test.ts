import { expect } from "vitest";
import { asc, eq, getTableName } from "drizzle-orm";
import { createResolver, type Resolver } from "@openmarch/core";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/test/convertPages";
import { readTimelineTables } from "@/timeline/timelineRows";
import { performRedo, performUndo, transactionWithHistory } from "../history";
import { createTimelineShapesInTransaction } from "../timelineShapes";
import {
    setTimelineTransitionDestinationInTransaction,
    updateTimelineTransitionsInTransaction,
} from "../timelineTransitionsInTransaction";
import { saveShapeRecipeInTransaction } from "../shapeRecipes";
import { splitTimelineAtBeat } from "../timelineSplitAtBeat";
import { splitMarchersIntoNewMove } from "../timelineSplitMoves";
import { unsetMarchersAt } from "../timelineUnset";

keepFixturesInPageMode("its tests convert the show themselves");

/**
 * **Remove keyframe joins the halves after a split** (holds decision 14, #470): on the converted
 * `marchersAndPages` show (pages 1 to 6 of 8 counts, so page 2's box is `[9, 17)` and page 3's
 * `[17, 25)`), Split at playhead at count 13 and Remove keyframe there with the whole move
 * selected walks the marchers along the original path at even speed again, instead of standing
 * still until 13 and then going at double speed (#362 Repro, question 14).
 */

const TABLES = [
    schema.timelines,
    schema.timeline_shapes,
    schema.timeline_transitions,
    schema.timeline_assignments,
    schema.timeline_slot_destinations,
    schema.timeline_kept_assignments,
    schema.timeline_shape_recipes,
    schema.timeline_shape_recipe_marchers,
];

const dataOf = async (db: DbConnection) => {
    const out: Record<string, unknown[]> = {};
    for (const table of TABLES)
        out[getTableName(table)] = await db.select().from(table).all();
    return out;
};

const resolverOf = async (db: DbConnection): Promise<Resolver> =>
    createResolver((await readTimelineTables(db)).snapshot);

/** Each marcher's step length on each count of `[start, end)`. */
const stepsOf = (
    r: Resolver,
    marcherIds: readonly number[],
    { start, end }: { start: number; end: number },
) =>
    new Map(
        marcherIds.map((id) => [
            id,
            Array.from({ length: end - start }, (_, i) => {
                const [x0, y0] = r.positionAt(id, start + i);
                const [x1, y1] = r.positionAt(id, start + i + 1);
                return Math.hypot(x1 - x0, y1 - y0);
            }),
        ]),
    );

const expectSameSteps = (
    a: ReturnType<typeof stepsOf>,
    b: ReturnType<typeof stepsOf>,
) => {
    expect([...b.keys()]).toEqual([...a.keys()]);
    for (const [id, steps] of a)
        steps.forEach((step, i) => expect(b.get(id)![i]).toBeCloseTo(step, 6));
};

/** Page 2's own timeline, over [9, 17), its one transition and its members. */
const page2 = async (db: DbConnection) => {
    const timeline = (await db
        .select()
        .from(schema.timelines)
        .where(eq(schema.timelines.start_beat, 9))
        .get())!;
    expect(timeline.end_beat).toBe(17);
    const transition = (await db
        .select()
        .from(schema.timeline_transitions)
        .where(eq(schema.timeline_transitions.timeline_id, timeline.id))
        .get())!;
    const members = (
        await db
            .select({ id: schema.timeline_assignments.marcher_id })
            .from(schema.timeline_assignments)
            .where(eq(schema.timeline_assignments.transition_id, transition.id))
            .all()
    )
        .map((r) => r.id)
        .sort((a, b) => a - b);
    return { timeline, transition, members };
};

const timelineRange = async (db: DbConnection, id: number) =>
    await db
        .select({
            start: schema.timelines.start_beat,
            end: schema.timelines.end_beat,
        })
        .from(schema.timelines)
        .where(eq(schema.timelines.id, id))
        .get();

const rowsOfMarcher = (db: DbConnection, marcherId: number) =>
    db
        .select()
        .from(schema.timeline_assignments)
        .where(eq(schema.timeline_assignments.marcher_id, marcherId))
        .orderBy(asc(schema.timeline_assignments.start_beat))
        .all();

const PAGE2 = { start: 9, end: 17 };

describeDbTests(
    "Remove keyframe joins the halves after a split (#470)",
    (it) => {
        it("question 14: after Split at playhead, removing the split with the whole move selected walks evenly again", async ({
            db,
            marchersAndPages: _,
        }) => {
            await convertPagesToTimeline(db);
            const { timeline, members } = await page2(db);
            const even = stepsOf(await resolverOf(db), members, PAGE2);
            // Somebody walks on page 2, or the test shows nothing
            expect([...even.values()].some((s) => s[0]! > 1)).toBe(true);

            const split = await splitTimelineAtBeat({
                db,
                timelineId: timeline.id,
                beat: 13,
            });
            const result = await unsetMarchersAt({
                db,
                beat: 13,
                marcherIds: members,
            });

            expect(result.unset).toEqual(members);
            expect(result.joined).toEqual(members);
            // The step lengths across the page are what they were before the split: even
            expectSameSteps(
                even,
                stepsOf(await resolverOf(db), members, PAGE2),
            );
            // The move after the split runs over the whole page again; the half before is gone
            expect(await timelineRange(db, timeline.id)).toEqual(PAGE2);
            expect(await timelineRange(db, split.before.id)).toBeUndefined();
        });

        it("question 14 as reproduced: a move split off a page's, split at the playhead, then removed", async ({
            db,
            marchersAndPages: _,
        }) => {
            await convertPagesToTimeline(db);
            const { timeline: page, members } = await page2(db);
            const chosen = members.slice(0, 2);
            const off = await splitMarchersIntoNewMove({
                db,
                timelineId: page.id,
                marcherIds: chosen,
            });
            const even = stepsOf(await resolverOf(db), members, PAGE2);
            await splitTimelineAtBeat({
                db,
                timelineId: off.timeline.id,
                beat: 13,
            });

            const result = await unsetMarchersAt({
                db,
                beat: 13,
                marcherIds: chosen,
            });

            expect(result.joined).toEqual(chosen);
            expectSameSteps(
                even,
                stepsOf(await resolverOf(db), members, PAGE2),
            );
            expect(await timelineRange(db, off.timeline.id)).toEqual(PAGE2);
        });

        it("is one undo step: undo restores the split, redo the join", async ({
            db,
            marchersAndPages: _,
        }) => {
            await convertPagesToTimeline(db);
            const { timeline, members } = await page2(db);
            await splitTimelineAtBeat({
                db,
                timelineId: timeline.id,
                beat: 13,
            });
            const splitData = await dataOf(db);

            await unsetMarchersAt({ db, beat: 13, marcherIds: members });
            const joinedData = await dataOf(db);

            await performUndo(db);
            expect(await dataOf(db)).toEqual(splitData);
            await performRedo(db);
            expect(await dataOf(db)).toEqual(joinedData);
        });

        it("does not join at a page flag: Remove behaves as before there", async ({
            db,
            marchersAndPages: _,
        }) => {
            await convertPagesToTimeline(db);
            const { members } = await page2(db);
            const page3 = (await db
                .select()
                .from(schema.timelines)
                .where(eq(schema.timelines.start_beat, 17))
                .get())!;

            const result = await unsetMarchersAt({
                db,
                beat: 17,
                marcherIds: members,
            });

            expect(result.unset).toEqual(members);
            expect(result.joined).toEqual([]);
            // Page 3's move still starts on its flag
            expect(await timelineRange(db, page3.id)).toEqual({
                start: 17,
                end: 25,
            });
        });

        it("does not join for part of the move's marchers (that is #471): they stand still, then walk", async ({
            db,
            marchersAndPages: _,
        }) => {
            await convertPagesToTimeline(db);
            const { timeline, members } = await page2(db);
            await splitTimelineAtBeat({
                db,
                timelineId: timeline.id,
                beat: 13,
            });
            const one = members[0]!;

            const result = await unsetMarchersAt({
                db,
                beat: 13,
                marcherIds: [one],
            });

            expect(result.unset).toEqual([one]);
            expect(result.joined).toEqual([]);
            expect(await timelineRange(db, timeline.id)).toEqual({
                start: 13,
                end: 17,
            });
            const rows = await rowsOfMarcher(db, one);
            expect(
                rows.some((r) => r.start_beat === 13 && r.end_beat === 17),
            ).toBe(true);
        });

        it("a follow-the-leader move joins with its members still in it, and plays as before the split", async ({
            db,
            marchersAndPages: _,
        }) => {
            await convertPagesToTimeline(db);
            const { timeline, transition, members } = await page2(db);
            await transactionWithHistory(db, "ftl", async (tx) => {
                const [shape] = await createTimelineShapesInTransaction({
                    tx,
                    newShapes: [
                        {
                            kind: "line",
                            geometry: {
                                points: [
                                    [100, 300],
                                    [900, 340],
                                ],
                            },
                        },
                    ],
                });
                await setTimelineTransitionDestinationInTransaction({
                    tx,
                    transitionId: transition.id,
                    destination: { kind: "shape", shapeId: shape!.id },
                });
                await updateTimelineTransitionsInTransaction({
                    tx,
                    modifiedTransitions: [
                        {
                            id: transition.id,
                            pathStyle: "follow_the_leader",
                            pathParams: { waypoints: [] },
                        },
                    ],
                });
            });
            const r0 = await resolverOf(db);
            await splitTimelineAtBeat({
                db,
                timelineId: timeline.id,
                beat: 13,
            });

            const result = await unsetMarchersAt({
                db,
                beat: 13,
                marcherIds: members,
            });

            // Joining keeps everyone in the move it was in, so nobody is skipped
            expect(result.joined).toEqual(members);
            const r1 = await resolverOf(db);
            for (const id of members)
                for (let beat = 9; beat <= 17; beat += 0.5) {
                    const [x0, y0] = r0.positionAt(id, beat);
                    const [x1, y1] = r1.positionAt(id, beat);
                    expect(x1).toBeCloseTo(x0, 6);
                    expect(y1).toBeCloseTo(y0, 6);
                }
            expect(
                await db
                    .select()
                    .from(schema.timeline_transitions)
                    .where(eq(schema.timeline_transitions.id, transition.id))
                    .get(),
            ).toMatchObject({
                path_style: "follow_the_leader",
                start_beat: 9,
                end_beat: 17,
            });
        });

        it("a shape recipe of the move after the split stays with it, members and all", async ({
            db,
            marchersAndPages: _,
        }) => {
            await convertPagesToTimeline(db);
            const { timeline, members } = await page2(db);
            await splitTimelineAtBeat({
                db,
                timelineId: timeline.id,
                beat: 13,
            });
            const recipeId = await transactionWithHistory(
                db,
                "recipe",
                async (tx) => {
                    // The recipe tables aren't in the undo history on their own; a named move is
                    await tx
                        .update(schema.timelines)
                        .set({ name: "Shape move" })
                        .where(eq(schema.timelines.id, timeline.id));
                    return await saveShapeRecipeInTransaction({
                        tx,
                        timelineId: timeline.id,
                        recipe: {
                            kind: "line",
                            kindVersion: 1,
                            params: {},
                            orderMode: "keep",
                            reverse: false,
                        },
                        members: members.map((marcherId, i) => ({
                            marcherId,
                            slot: i,
                            x: 100 + 20 * i,
                            y: 50,
                        })),
                    });
                },
            );

            const result = await unsetMarchersAt({
                db,
                beat: 13,
                marcherIds: members,
            });

            expect(result.joined).toEqual(members);
            const recipe = await db
                .select()
                .from(schema.timeline_shape_recipes)
                .where(eq(schema.timeline_shape_recipes.id, recipeId))
                .get();
            expect(recipe?.timeline_id).toBe(timeline.id);
            const recipeMembers = (
                await db
                    .select({
                        id: schema.timeline_shape_recipe_marchers.marcher_id,
                    })
                    .from(schema.timeline_shape_recipe_marchers)
                    .where(
                        eq(
                            schema.timeline_shape_recipe_marchers.recipe_id,
                            recipeId,
                        ),
                    )
                    .all()
            )
                .map((r) => r.id)
                .sort((a, b) => a - b);
            expect(recipeMembers).toEqual(members);
        });
    },
);
