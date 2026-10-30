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
import { unsetMarchersAt } from "../timelineUnset";

keepFixturesInPageMode("its tests convert the show themselves");

/**
 * **Joining after a split for part of a group** (holds R4, #471): on the converted
 * `marchersAndPages` show (page 2's box is `[9, 17)`), Split at playhead at count 13, then Remove
 * keyframe there with only some of the move's marchers selected. Those marchers are taken out of
 * both halves into a move of their own, which joins (#470), so they walk evenly again; the others
 * keep both halves. Shape and follow-the-leader members can't be taken out: they keep the plain
 * Remove, and the result names them.
 */

const TABLES = [
    schema.timelines,
    schema.timeline_shapes,
    schema.timeline_transitions,
    schema.timeline_assignments,
    schema.timeline_slot_destinations,
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

const PAGE2 = { start: 9, end: 17 };

/** Each marcher's step length on each count of page 2. */
const stepsOf = (r: Resolver, marcherIds: readonly number[]) =>
    new Map(
        marcherIds.map((id) => [
            id,
            Array.from({ length: PAGE2.end - PAGE2.start }, (_, i) => {
                const [x0, y0] = r.positionAt(id, PAGE2.start + i);
                const [x1, y1] = r.positionAt(id, PAGE2.start + i + 1);
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
        steps.forEach((step, i) =>
            expect(
                b.get(id)![i],
                `marcher ${id}, count ${PAGE2.start + i}`,
            ).toBeCloseTo(step, 6),
        );
};

/** Page 2's own timeline, its one transition and its members, ascending. */
const page2 = async (db: DbConnection) => {
    const timeline = (await db
        .select()
        .from(schema.timelines)
        .where(eq(schema.timelines.start_beat, 9))
        .get())!;
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

/** `marcherId`'s rows over page 2, as `[start, end]`, in order. */
const rowsOnPage2 = async (db: DbConnection, marcherId: number) =>
    (
        await db
            .select()
            .from(schema.timeline_assignments)
            .where(eq(schema.timeline_assignments.marcher_id, marcherId))
            .orderBy(asc(schema.timeline_assignments.start_beat))
            .all()
    )
        .filter((r) => r.start_beat < PAGE2.end && r.end_beat > PAGE2.start)
        .map((r) => [r.start_beat, r.end_beat]);

const timelineRange = async (db: DbConnection, id: number) =>
    await db
        .select({
            start: schema.timelines.start_beat,
            end: schema.timelines.end_beat,
        })
        .from(schema.timelines)
        .where(eq(schema.timelines.id, id))
        .get();

/** Page 2 split at the playhead, count 13, with its steps before and after the split. */
const splitPage2 = async (db: DbConnection) => {
    await convertPagesToTimeline(db);
    const { timeline, transition, members } = await page2(db);
    expect(members.length).toBeGreaterThanOrEqual(3);
    const even = stepsOf(await resolverOf(db), members);
    // Somebody walks on page 2, or the test shows nothing
    expect([...even.values()].some((s) => s[0]! > 1)).toBe(true);
    const split = await splitTimelineAtBeat({
        db,
        timelineId: timeline.id,
        beat: 13,
    });
    const halves = stepsOf(await resolverOf(db), members);
    return { after: timeline, transition, members, split, even, halves };
};

describeDbTests(
    "Remove keyframe joins part of a group after a split (#471)",
    (it) => {
        it("one of the move's marchers selected: it walks one even move, the others keep both halves", async ({
            db,
            marchersAndPages: _,
        }) => {
            const { after, members, split, even, halves } =
                await splitPage2(db);
            const [one, ...others] = members as [number, ...number[]];

            const result = await unsetMarchersAt({
                db,
                beat: 13,
                marcherIds: [one],
            });

            expect(result.unset).toEqual([one]);
            expect(result.joined).toEqual([one]);
            expect(result.notJoined).toEqual([]);
            expect(result.skipped).toBeUndefined();
            const r = await resolverOf(db);
            expectSameSteps(
                new Map([[one, even.get(one)!]]),
                stepsOf(r, [one]),
            );
            expectSameSteps(
                new Map(others.map((id) => [id, halves.get(id)!])),
                stepsOf(r, others),
            );
            expect(await rowsOnPage2(db, one)).toEqual([[9, 17]]);
            for (const id of others)
                expect(await rowsOnPage2(db, id)).toEqual([
                    [9, 13],
                    [13, 17],
                ]);
            // Both halves are still there for the others
            expect(await timelineRange(db, split.before.id)).toEqual({
                start: 9,
                end: 13,
            });
            expect(await timelineRange(db, after.id)).toEqual({
                start: 13,
                end: 17,
            });
        });

        it("is one undo step: undo restores the split for everyone, redo the join", async ({
            db,
            marchersAndPages: _,
        }) => {
            const { members } = await splitPage2(db);
            const splitData = await dataOf(db);

            await unsetMarchersAt({ db, beat: 13, marcherIds: [members[0]!] });
            const joinedData = await dataOf(db);
            expect(joinedData).not.toEqual(splitData);

            const undo = await performUndo(db);
            expect(undo.success, undo.error?.message).toBe(true);
            expect(await dataOf(db)).toEqual(splitData);
            await performRedo(db);
            expect(await dataOf(db)).toEqual(joinedData);
        });

        it("a shape member keeps the plain Remove and is named; the other selected marcher joins", async ({
            db,
            marchersAndPages: _,
        }) => {
            const { after, members, even } = await splitPage2(db);
            const [shaped, free] = members as [number, number];
            // The half after the split keeps the shape recipe (#363) of one marcher
            await transactionWithHistory(db, "recipe", async (tx) => {
                // The recipe tables aren't in the undo history on their own; a named move is
                await tx
                    .update(schema.timelines)
                    .set({ name: "Shape move" })
                    .where(eq(schema.timelines.id, after.id));
                await saveShapeRecipeInTransaction({
                    tx,
                    timelineId: after.id,
                    recipe: {
                        kind: "line",
                        kindVersion: 1,
                        params: {},
                        orderMode: "keep",
                        reverse: false,
                    },
                    members: [{ marcherId: shaped, slot: 0, x: 100, y: 50 }],
                });
            });
            const r0 = await resolverOf(db);

            const result = await unsetMarchersAt({
                db,
                beat: 13,
                marcherIds: [shaped, free],
            });

            expect(result.unset).toEqual([shaped, free]);
            expect(result.joined).toEqual([free]);
            expect(result.skipped?.refusal).toBe("inShapeOrFollowTheLeader");
            expect(result.skipped?.marcherIds).toEqual([shaped]);
            expect(result.skipped?.message).toMatch(/is in a shape/);
            expectSameSteps(
                new Map([[free, even.get(free)!]]),
                stepsOf(await resolverOf(db), [free]),
            );
            // Today's Remove: the shape member stands where count 9 left it until 13, then walks its
            // half after the split, still in the shape's move
            const r1 = await resolverOf(db);
            for (let beat = 9; beat <= 13; beat++)
                expect(r1.positionAt(shaped, beat)).toEqual(
                    r0.positionAt(shaped, 9),
                );
            expect(r1.positionAt(shaped, 17)).toEqual(
                r0.positionAt(shaped, 17),
            );
            expect(await rowsOnPage2(db, shaped)).toEqual([[13, 17]]);
            expect(await timelineRange(db, after.id)).toEqual({
                start: 13,
                end: 17,
            });
        });

        it("a follow-the-leader member keeps the plain Remove and is named", async ({
            db,
            marchersAndPages: _,
        }) => {
            const { members, transition } = await splitPage2(db);
            const one = members[0]!;
            // The half after the split (its transition stayed with it) walks follow-the-leader
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

            const result = await unsetMarchersAt({
                db,
                beat: 13,
                marcherIds: [one],
            });

            expect(result.unset).toEqual([one]);
            expect(result.joined).toEqual([]);
            expect(result.skipped?.marcherIds).toEqual([one]);
            expect(result.skipped?.message).toMatch(/follows the leader/);
            expect(await rowsOnPage2(db, one)).toEqual([[13, 17]]);
        });
    },
);
