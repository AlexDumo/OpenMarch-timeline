import { expect } from "vitest";
import { and, asc, eq, getTableName, gt, inArray, lt } from "drizzle-orm";
import { createResolver, type Resolver, type XY } from "@openmarch/core";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/test/convertPages";
import { readTimelineTables } from "@/timeline/timelineRows";
import { loadTimelineFixture } from "@/timeline/fixtures/loadTimelineFixture";
import { GOLDEN_FIXTURES } from "@/timeline/fixtures/goldenFixtures";
import { performUndo, transactionWithHistory } from "../history";
import {
    createTimelinesInTransaction,
    deleteTimelinesInTransaction,
    timelinesWithRange,
} from "../timelines";
import { createTimelineTransitionsInTransaction } from "../timelineTransitionsInTransaction";
import { createTimelineAssignmentsInTransaction } from "../timelineAssignments";
import { saveShapeRecipeInTransaction } from "../shapeRecipes";
import { moveMarchersInRangeInTransaction } from "../timelineMoves";
import {
    cutMoveAtBeatInTransaction,
    planRemovalFromRange,
    removeMarchersFromMoveForRangeInTransaction,
    skippedRefusal,
    takeMarchersIntoOwnMoveInTransaction,
    takeMarchersOutOfRangeInTransaction,
} from "../timelineMoveCuts";
import type { BeatRange } from "../timelineMembership";

keepFixturesInPageMode("its tests convert the show themselves");

/**
 * The holds' shared move operations (`timelineMoveCuts`): cut a move in time at a count, and remove
 * marchers from a move for a range of counts. On the converted `marchersAndPages` show, page N's
 * box is `[8N − 7, 8N + 1)` (page 2's is `[9, 17)`), each page move one timeline with one shared
 * shapeless direct transition.
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

/** Each of `ids`' position at every half beat from 0 to `end`. */
const track = (r: Resolver, ids: readonly number[], end: number): XY[][] =>
    ids.map((id) =>
        Array.from({ length: 2 * end + 1 }, (_, i) => r.positionAt(id, i / 2)),
    );

const expectClose = (a: XY[][], b: XY[][]) => {
    expect(b.length).toBe(a.length);
    a.forEach((row, m) =>
        row.forEach((p, i) => {
            expect(
                Math.abs(p[0] - b[m]![i]![0]),
                `m${m} @${i / 2}`,
            ).toBeLessThan(1e-6);
            expect(
                Math.abs(p[1] - b[m]![i]![1]),
                `m${m} @${i / 2}`,
            ).toBeLessThan(1e-6);
        }),
    );
};

const timelinesSorted = (db: DbConnection) =>
    db
        .select()
        .from(schema.timelines)
        .orderBy(asc(schema.timelines.start_beat), asc(schema.timelines.id))
        .all();

/** `marcherIds`' rows over any beat of `range`. */
const rowsOver = (
    db: DbConnection,
    marcherIds: readonly number[],
    range: BeatRange,
) =>
    db
        .select()
        .from(schema.timeline_assignments)
        .where(
            and(
                inArray(schema.timeline_assignments.marcher_id, [
                    ...marcherIds,
                ]),
                lt(schema.timeline_assignments.start_beat, range.end),
                gt(schema.timeline_assignments.end_beat, range.start),
            ),
        )
        .all();

const PAGE2 = { start: 9, end: 17 };

/** The page move over page 2's box. */
const page2Move = async (db: DbConnection) =>
    (await db
        .select()
        .from(schema.timelines)
        .where(
            and(
                eq(schema.timelines.start_beat, PAGE2.start),
                eq(schema.timelines.end_beat, PAGE2.end),
            ),
        )
        .orderBy(asc(schema.timelines.id))
        .get())!;

/**
 * One shared move over `[1, 25)` (pages 1 to 3) on layer 1, its one shapeless direct transition
 * holding `marcherIds` in order, each heading for a spot of its own.
 */
const longSharedMove = async (db: DbConnection, marcherIds: number[]) =>
    transactionWithHistory(db, "long move", async (tx) => {
        const [t] = await createTimelinesInTransaction({
            tx,
            newTimelines: [{ name: "Long", startBeat: 1, endBeat: 25 }],
        });
        const [made] = await createTimelineTransitionsInTransaction({
            tx,
            newTransitions: [
                {
                    timelineId: t!.id,
                    slotCount: marcherIds.length,
                    destination: {
                        kind: "individual",
                        points: marcherIds.map(
                            (_, i) => [300 + 40 * i, 200] as XY,
                        ),
                    },
                },
            ],
        });
        await createTimelineAssignmentsInTransaction({
            tx,
            newAssignments: marcherIds.map((marcherId, i) => ({
                marcherId,
                transitionId: made!.id,
                slotIndex: i,
                startBeat: 1,
                endBeat: 25,
                layer: 1,
            })),
        });
        return t!;
    });

/** Deletes every timeline row, so marchers hold on their homes and no page has a move. */
const clearTimelines = (db: DbConnection) =>
    transactionWithHistory(db, "clear", async (tx) => {
        const ids = (
            await tx.select({ id: schema.timelines.id }).from(schema.timelines)
        ).map((r) => r.id);
        await deleteTimelinesInTransaction({ tx, timelineIds: new Set(ids) });
    });

/** A move over `range` named `name`, one transition taking `marcherIds` to spots of their own. */
const moveOver = async (
    db: DbConnection,
    range: BeatRange,
    marcherIds: number[],
    name: string | null,
) =>
    transactionWithHistory(db, "move", async (tx) => {
        const [t] = await createTimelinesInTransaction({
            tx,
            newTimelines: [
                { name, startBeat: range.start, endBeat: range.end },
            ],
        });
        const [made] = await createTimelineTransitionsInTransaction({
            tx,
            newTransitions: [
                {
                    timelineId: t!.id,
                    slotCount: marcherIds.length,
                    destination: {
                        kind: "individual",
                        points: marcherIds.map(
                            (_, i) => [100 + 30 * i, 80 + range.end] as XY,
                        ),
                    },
                },
            ],
        });
        await createTimelineAssignmentsInTransaction({
            tx,
            newAssignments: marcherIds.map((marcherId, i) => ({
                marcherId,
                transitionId: made!.id,
                slotIndex: i,
                startBeat: range.start,
                endBeat: range.end,
                layer: 0,
            })),
        });
        return t!;
    });

/** The marchers with a row in move `timelineId`, ascending. */
const membersOf = async (db: DbConnection, timelineId: number) =>
    (
        await db
            .select({ id: schema.timeline_assignments.marcher_id })
            .from(schema.timeline_assignments)
            .innerJoin(
                schema.timeline_transitions,
                eq(
                    schema.timeline_transitions.id,
                    schema.timeline_assignments.transition_id,
                ),
            )
            .where(eq(schema.timeline_transitions.timeline_id, timelineId))
            .all()
    )
        .map((r) => r.id)
        .sort((x, y) => x - y);

const golden = (name: string) =>
    GOLDEN_FIXTURES.find((g) => g.name === name)!.build();

describeDbTests("cut a move in time at a count", (it) => {
    it("mid-move (golden G1): two moves meeting at the count, every position unchanged", async ({
        db,
        marchersAndPages: _,
    }) => {
        const loaded = await loadTimelineFixture(db, golden("G1"));
        const m = loaded.marchers.get(1)!;
        const timelineId = loaded.timelines.get(1)!;
        const before = track(await resolverOf(db), [m], 16);

        const cut = await transactionWithHistory(db, "cut", (tx) =>
            cutMoveAtBeatInTransaction({ tx, timelineId, beat: 5 }),
        );

        expect(cut).not.toBeNull();
        expect(cut!.after.id).toBe(timelineId);
        expect([cut!.before.start_beat, cut!.before.end_beat]).toEqual([0, 5]);
        expect([cut!.after.start_beat, cut!.after.end_beat]).toEqual([5, 16]);
        expectClose(before, track(await resolverOf(db), [m], 16));
    });

    it("at a page flag that already has the page's move: the new part shares the box, numbered", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        // G2's move over [0, 16) with a steal over [8, 16); cut it at page 2's flag, beat 9
        const loaded = await loadTimelineFixture(db, golden("G2"));
        const m = loaded.marchers.get(1)!;
        const timelineId = loaded.timelines.get(1)!;
        const pageMove = await page2Move(db);
        const before = track(await resolverOf(db), [m], 20);

        const cut = await transactionWithHistory(db, "cut", (tx) =>
            cutMoveAtBeatInTransaction({ tx, timelineId, beat: 9 }),
        );

        expect([cut!.before.start_beat, cut!.before.end_beat]).toEqual([0, 9]);
        expect(cut!.before.name).toMatch(/^Move \d+$/);
        expect([cut!.after.start_beat, cut!.after.end_beat]).toEqual([9, 16]);
        expectClose(before, track(await resolverOf(db), [m], 20));
        // The page's own move is untouched, and still the oldest over its box
        expect(await page2Move(db)).toEqual(pageMove);
    });

    it("needs no cut at the move's own ends, or where nobody moves on one side: nothing is written", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        // G5: the marcher only joins the move [0, 16) at beat 8
        const loaded = await loadTimelineFixture(db, golden("G5"));
        const timelineId = loaded.timelines.get(1)!;
        const before = await dataOf(db);

        for (const beat of [0, 16, 20, 4])
            expect(
                await db.transaction((tx) =>
                    cutMoveAtBeatInTransaction({ tx, timelineId, beat }),
                ),
                `beat ${beat}`,
            ).toBeNull();
        expect(await dataOf(db)).toEqual(before);
    });
});

describeDbTests("cut: which part keeps the move's id", (it) => {
    it("the part after would take over a newer page move: the part before keeps the id and name; the transitions after and the shape recipe go with the part after", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        await clearTimelines(db);
        const [a, b, c] = (await resolverOf(db)).marcherIds();
        const long = await moveOver(
            db,
            { start: 9, end: 25 },
            [a!, b!],
            "Long",
        );
        await db.transaction((tx) =>
            saveShapeRecipeInTransaction({
                tx,
                timelineId: long.id,
                recipe: {
                    kind: "line",
                    kindVersion: 1,
                    params: {},
                    orderMode: "slot",
                    reverse: false,
                },
                members: [{ marcherId: a!, slot: 0, x: 100, y: 105 }],
            }),
        );
        const page3 = await moveOver(db, { start: 17, end: 25 }, [c!], null);
        const before = track(await resolverOf(db), [a!, b!, c!], 25);

        const cut = (await transactionWithHistory(db, "cut", (tx) =>
            cutMoveAtBeatInTransaction({ tx, timelineId: long.id, beat: 17 }),
        ))!;

        expect(cut.before.id).toBe(long.id);
        expect(cut.before.name).toBe("Long");
        expect([cut.before.start_beat, cut.before.end_beat]).toEqual([9, 17]);
        expect(cut.after.id).toBeGreaterThan(page3.id);
        expect(cut.after.name).toMatch(/^Move \d+$/);
        expect([cut.after.start_beat, cut.after.end_beat]).toEqual([17, 25]);
        const overPage3 = await db.transaction((tx) =>
            timelinesWithRange(tx, { start: 17, end: 25 }),
        );
        expect(overPage3.map((l) => l.id)).toEqual([page3.id, cut.after.id]);
        const recipes = await db
            .select()
            .from(schema.timeline_shape_recipes)
            .all();
        expect(recipes.map((r) => r.timeline_id)).toEqual([cut.after.id]);
        expectClose(before, track(await resolverOf(db), [a!, b!, c!], 25));
    });

    it("both parts would take over a newer page move: neither keeps the id, and the original goes", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        await clearTimelines(db);
        const [a, b, c, d] = (await resolverOf(db)).marcherIds();
        const long = await moveOver(
            db,
            { start: 9, end: 25 },
            [a!, b!],
            "Long",
        );
        const page2 = await moveOver(db, PAGE2, [c!], null);
        const page3 = await moveOver(db, { start: 17, end: 25 }, [d!], null);
        const ids = [a!, b!, c!, d!];
        const before = track(await resolverOf(db), ids, 25);

        const cut = (await transactionWithHistory(db, "cut", (tx) =>
            cutMoveAtBeatInTransaction({ tx, timelineId: long.id, beat: 17 }),
        ))!;

        expect(cut.before.id).toBeGreaterThan(page3.id);
        expect(cut.after.id).toBeGreaterThan(page3.id);
        expect(
            await db
                .select()
                .from(schema.timelines)
                .where(eq(schema.timelines.id, long.id))
                .get(),
        ).toBeUndefined();
        for (const [range, own] of [
            [PAGE2, page2],
            [{ start: 17, end: 25 }, page3],
        ] as const)
            expect(
                (
                    await db.transaction((tx) => timelinesWithRange(tx, range))
                )[0]!.id,
            ).toBe(own.id);
        expectClose(before, track(await resolverOf(db), ids, 25));
    });
});

describeDbTests("remove marchers from a move for a range of counts", (it) => {
    it("the preview writes nothing and says what the removal then does; the removal returns the piece they left", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const [a, b, c] = (await resolverOf(db)).marcherIds();
        const long = await longSharedMove(db, [a!, b!, c!]);
        const before = await dataOf(db);

        const plan = await db.transaction((tx) =>
            planRemovalFromRange({ tx, marcherIds: [a!, c!], range: PAGE2 }),
        );

        expect(await dataOf(db)).toEqual(before);
        const leaving = [a!, c!].sort((x, y) => x - y);
        const pageMove = await page2Move(db);
        expect(plan).toEqual({
            removed: leaving,
            skipped: [],
            moves: [
                // The page's own move over exactly the range needs no cut
                { timelineId: pageMove.id, removed: leaving, cuts: [] },
                {
                    timelineId: long.id,
                    removed: leaving,
                    cuts: [
                        { timelineId: long.id, beat: 9, idStaysWith: "after" },
                        { timelineId: long.id, beat: 17, idStaysWith: "after" },
                    ],
                },
            ],
        });

        const result = await transactionWithHistory(db, "take out", (tx) =>
            takeMarchersOutOfRangeInTransaction({
                tx,
                marcherIds: [a!, c!],
                range: PAGE2,
            }),
        );

        expect(result.removed).toEqual(plan.removed);
        expect(result.cuts.map((cut) => cut.before.end_beat)).toEqual([9, 17]);
        expect(result.pieces).toEqual([
            { timelineId: pageMove.id, pieceId: pageMove.id, deleted: false },
            {
                timelineId: long.id,
                pieceId: result.cuts[1]!.before.id,
                deleted: false,
            },
        ]);
        const piece = (await db
            .select()
            .from(schema.timelines)
            .where(eq(schema.timelines.id, result.pieces[1]!.pieceId))
            .get())!;
        expect([piece.start_beat, piece.end_beat]).toEqual([
            PAGE2.start,
            PAGE2.end,
        ]);
    });

    it("a range inside a shared move: cut at both ends, the marcher leaves the middle, the others keep their motion", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const all = (await resolverOf(db)).marcherIds();
        const [a, b, c] = all;
        const long = await longSharedMove(db, [a!, b!, c!]);
        const r0 = await resolverOf(db);
        const before = track(r0, all, 30);
        const bAt9 = r0.positionAt(b!, 9);
        const bAt25 = r0.positionAt(b!, 25);

        const result = await transactionWithHistory(db, "remove", (tx) =>
            removeMarchersFromMoveForRangeInTransaction({
                tx,
                timelineId: long.id,
                marcherIds: [b!],
                range: PAGE2,
            }),
        );

        expect(result.removed).toEqual([b]);
        expect(result.skipped).toEqual([]);
        expect(
            result.cuts.map((c) => [c.before.start_beat, c.before.end_beat]),
        ).toEqual([
            [1, 9],
            [9, 17],
        ]);
        // Three parts; the original keeps its id as the last
        const parts = (await timelinesSorted(db)).filter((t) =>
            [long.id, ...result.cuts.map((c) => c.before.id)].includes(t.id),
        );
        expect(parts.map((t) => [t.start_beat, t.end_beat])).toEqual([
            [1, 9],
            [9, 17],
            [17, 25],
        ]);
        expect(parts[2]!.id).toBe(long.id);
        // b has no row over the page: on its stored layer-1 rows nothing covers [9, 17)
        expect(
            (await rowsOver(db, [b!], PAGE2)).filter((r) => r.layer === 1),
        ).toEqual([]);
        // The middle part's transition is compacted to the two who stay
        const middle = await db
            .select()
            .from(schema.timeline_transitions)
            .where(eq(schema.timeline_transitions.timeline_id, parts[1]!.id))
            .all();
        expect(middle.map((t) => t.slot_count)).toEqual([2]);

        const r1 = await resolverOf(db);
        const after = track(r1, all, 30);
        all.forEach((id, m) => {
            if (id === b) return;
            expectClose([before[m]!], [after[m]!]);
        });
        // b: unchanged before the page, then it follows the page move under it (layer 0) from
        // where it is at 9, and after the page it still arrives where the long move took it
        const bm = all.indexOf(b!);
        expectClose([before[bm]!.slice(0, 19)], [after[bm]!.slice(0, 19)]);
        expect(r1.positionAt(b!, 9)).toEqual(bAt9);
        expect(r1.positionAt(b!, 25)).toEqual(bAt25);
    });

    it("a move over exactly the range (a converted page's shared move): no cut, the slot compacted", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const all = (await resolverOf(db)).marcherIds();
        const pageMove = await page2Move(db);
        const [transition] = await db
            .select()
            .from(schema.timeline_transitions)
            .where(eq(schema.timeline_transitions.timeline_id, pageMove.id))
            .all();
        const r0 = await resolverOf(db);
        const before = track(r0, all, 30);
        const m = all[1]!;

        const result = await transactionWithHistory(db, "remove", (tx) =>
            removeMarchersFromMoveForRangeInTransaction({
                tx,
                timelineId: pageMove.id,
                marcherIds: [m],
                range: PAGE2,
            }),
        );

        expect(result).toMatchObject({ removed: [m], skipped: [], cuts: [] });
        expect(await rowsOver(db, [m], PAGE2)).toEqual([]);
        const after = await db
            .select()
            .from(schema.timeline_transitions)
            .where(eq(schema.timeline_transitions.id, transition!.id))
            .get();
        expect(after!.slot_count).toBe(transition!.slot_count - 1);
        // m stands where page 1 left it through page 2; everyone else keeps every position
        const r1 = await resolverOf(db);
        for (let beat = 9; beat <= 17; beat++)
            expect(r1.positionAt(m, beat)).toEqual(r0.positionAt(m, 9));
        const tracks = track(r1, all, 8);
        all.forEach((id, i) => {
            if (id !== m) expectClose([before[i]!.slice(0, 17)], [tracks[i]!]);
        });
    });

    it("shape recipe and follow-the-leader members stay and are named; the others leave", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const all = (await resolverOf(db)).marcherIds();
        const [a, b, c] = all;
        const pageMove = await page2Move(db);
        // Set up outside the history: a recipe alone writes no tracked row
        await db.transaction((tx) =>
            saveShapeRecipeInTransaction({
                tx,
                timelineId: pageMove.id,
                recipe: {
                    kind: "line",
                    kindVersion: 1,
                    params: {},
                    orderMode: "slot",
                    reverse: false,
                },
                members: [{ marcherId: a!, slot: 0, x: 10, y: 10 }],
            }),
        );
        // G6: four marchers in a line (T1, a stored shape) then follow-the-leader (T2, [4, 12))
        const g6 = await loadTimelineFixture(db, golden("G6"));
        const leaders = [1, 2, 3, 4].map((id) => g6.marchers.get(id)!);

        const result = await transactionWithHistory(db, "take out", (tx) =>
            takeMarchersOutOfRangeInTransaction({
                tx,
                marcherIds: [a!, b!, c!, leaders[0]!],
                range: PAGE2,
            }),
        );

        expect(result.removed).toEqual([b, c].sort((x, y) => x! - y!));
        expect(result.skipped.map((s) => [s.marcherId, s.reason])).toEqual(
            [
                [a!, "shape"],
                [leaders[0]!, "followTheLeader"],
            ].sort((x, y) => (x[0] as number) - (y[0] as number)),
        );
        expect(await rowsOver(db, [b!, c!], PAGE2)).toEqual([]);
        expect(await rowsOver(db, [a!], PAGE2)).toHaveLength(1);
        expect(await rowsOver(db, [leaders[0]!], PAGE2)).toHaveLength(1);

        const refusal = await db.transaction((tx) =>
            skippedRefusal(tx, result.skipped),
        );
        expect(refusal!.refusal).toBe("inShapeOrFollowTheLeader");
        expect(refusal!.marcherIds).toEqual(
            [a!, leaders[0]!].sort((x, y) => x - y),
        );
        expect(refusal!.message).toMatch(
            /is in a shape, and FX\d+ follows the leader, so they keep their move here\.$/,
        );
    });

    it("one undo step restores every row the cuts and the removal wrote", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const [a, b, c] = (await resolverOf(db)).marcherIds();
        await longSharedMove(db, [a!, b!, c!]);
        const before = await dataOf(db);

        await transactionWithHistory(db, "take out", (tx) =>
            takeMarchersOutOfRangeInTransaction({
                tx,
                marcherIds: [a!, c!],
                range: PAGE2,
            }),
        );
        expect(await dataOf(db)).not.toEqual(before);

        const undo = await performUndo(db);
        expect(undo.success, undo.error?.message).toBe(true);
        expect(await dataOf(db)).toEqual(before);
    });
});

describeDbTests(
    "take marchers out of a move into a move of their own",
    (it) => {
        it("they leave for a new move over the same counts, and everyone keeps every position", async ({
            db,
            marchersAndPages: _,
        }) => {
            await convertPagesToTimeline(db);
            const all = (await resolverOf(db)).marcherIds();
            const [a, b] = all;
            const pageMove = await page2Move(db);
            const before = track(await resolverOf(db), all, 30);

            const result = await transactionWithHistory(db, "take", (tx) =>
                takeMarchersIntoOwnMoveInTransaction({
                    tx,
                    timelineId: pageMove.id,
                    marcherIds: [b!, a!],
                }),
            );

            expect(result.taken).toEqual([a, b]);
            expect(result.skipped).toEqual([]);
            expect(result.timelineId).not.toBe(pageMove.id);
            const own = (await db
                .select()
                .from(schema.timelines)
                .where(eq(schema.timelines.id, result.timelineId!))
                .get())!;
            expect({ start: own.start_beat, end: own.end_beat }).toEqual(PAGE2);
            expect(await membersOf(db, own.id)).toEqual([a, b]);
            expectClose(before, track(await resolverOf(db), all, 30));
        });

        it("the move's whole membership: it already is their own, so nothing is written", async ({
            db,
            marchersAndPages: _,
        }) => {
            await convertPagesToTimeline(db);
            const all = (await resolverOf(db)).marcherIds();
            const pageMove = await page2Move(db);
            const before = await dataOf(db);

            // Nothing to write, so outside the history (an empty edit is refused there)
            const result = await db.transaction((tx) =>
                takeMarchersIntoOwnMoveInTransaction({
                    tx,
                    timelineId: pageMove.id,
                    marcherIds: all,
                }),
            );

            expect(result).toEqual({
                taken: all,
                skipped: [],
                timelineId: pageMove.id,
            });
            expect(await dataOf(db)).toEqual(before);
        });

        it("a shape recipe member stays and is named; nobody left to take writes nothing", async ({
            db,
            marchersAndPages: _,
        }) => {
            await convertPagesToTimeline(db);
            const [a, b] = (await resolverOf(db)).marcherIds();
            const pageMove = await page2Move(db);
            await db.transaction((tx) =>
                saveShapeRecipeInTransaction({
                    tx,
                    timelineId: pageMove.id,
                    recipe: {
                        kind: "line",
                        kindVersion: 1,
                        params: {},
                        orderMode: "slot",
                        reverse: false,
                    },
                    members: [{ marcherId: a!, slot: 0, x: 10, y: 10 }],
                }),
            );
            const before = await dataOf(db);

            const alone = await db.transaction((tx) =>
                takeMarchersIntoOwnMoveInTransaction({
                    tx,
                    timelineId: pageMove.id,
                    marcherIds: [a!],
                }),
            );
            expect(alone).toEqual({
                taken: [],
                skipped: [
                    { marcherId: a, timelineId: pageMove.id, reason: "shape" },
                ],
                timelineId: null,
            });
            expect(await dataOf(db)).toEqual(before);

            const both = await transactionWithHistory(db, "take", (tx) =>
                takeMarchersIntoOwnMoveInTransaction({
                    tx,
                    timelineId: pageMove.id,
                    marcherIds: [a!, b!],
                }),
            );
            expect(both.taken).toEqual([b]);
            expect(both.skipped.map((s) => s.marcherId)).toEqual([a]);
            expect(await membersOf(db, pageMove.id)).toContain(a);
            expect(await membersOf(db, both.timelineId!)).toEqual([b]);
        });
    },
);

describeDbTests("the drag back (holds decision 16)", (it) => {
    it("skips and names a shape member: it keeps its move, untouched; the others are taken out", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const [a, b] = (await resolverOf(db)).marcherIds();
        const pageMove = await page2Move(db);
        await db.transaction((tx) =>
            saveShapeRecipeInTransaction({
                tx,
                timelineId: pageMove.id,
                recipe: {
                    kind: "line",
                    kindVersion: 1,
                    params: {},
                    orderMode: "slot",
                    reverse: false,
                },
                members: [{ marcherId: a!, slot: 0, x: 10, y: 10 }],
            }),
        );
        const r = await resolverOf(db);
        const back = [a!, b!].map((marcherId) => {
            const [x, y] = r.positionAt(marcherId, PAGE2.start);
            return { marcherId, x, y };
        });
        expect(r.positionAt(a!, PAGE2.end)).not.toEqual(
            r.positionAt(a!, PAGE2.start),
        );
        const aRows = await rowsOver(db, [a!], PAGE2);
        const aTrack = track(r, [a!], 33);

        const result = await transactionWithHistory(db, "drag back", (tx) =>
            moveMarchersInRangeInTransaction({ tx, range: PAGE2, moves: back }),
        );

        expect(result.cleared).toEqual([b]);
        expect(result.skipped!.refusal).toBe("inShapeOrFollowTheLeader");
        expect(result.skipped!.marcherIds).toEqual([a]);
        expect(result.skipped!.message).toMatch(
            /^\S+ is in a shape, so it keeps its move here\.$/,
        );
        expect(result.slots).toEqual([]);
        expect(await rowsOver(db, [b!], PAGE2)).toEqual([]);
        expect(await rowsOver(db, [a!], PAGE2)).toEqual(aRows);
        expectClose(aTrack, track(await resolverOf(db), [a!], 33));
    });
});
