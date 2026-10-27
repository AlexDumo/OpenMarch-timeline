import { afterEach, describe, expect } from "vitest";
import { asc, getTableName, sql } from "drizzle-orm";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/test/convertPages";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import { performRedo, performUndo, transactionWithHistory } from "../history";
import { readPageGrid } from "../timelineRipple";
import { ensureCountsInTransaction, takeStoredCounts } from "../endlessCounts";
import { appendPageOfCounts } from "../appendPages";
import { addPageFlag, movePageFlag, pageFlagMoveLimits } from "../pageFlags";
import { resizeTimeline } from "../timelineResize";
import { shiftTimeline } from "../timelineCommands";
import { moveMarchersInRangeInTransaction } from "../timelineMoves";
import { addMarchersToTimeline } from "../timelineMembership";
import { createItems, setItemGeometry, type NewItemArgs } from "../items";
import { endlessIdOf } from "@/timeline/endlessTimeline";
import { createAllUndoTriggers } from "../historyTriggers";

// These tests set the flag and convert the show themselves
keepFixturesInPageMode(
    "its tests convert the show and set the flag themselves",
);

/**
 * Writes past the last stored count (docs/timeline/endless-counts.md, slice 2), on the
 * `marchersAndPages` show: beat 0 plus 96 counts of 0.5 s, 24 measures of 4 starting at beats 1,
 * 5, …, 93, and page 0 plus pages 1 to 6 starting at beats 1, 9, …, 41, 8 counts each, so the
 * last flag is at beat 49 and the stored counts end at beat 97.
 */

afterEach(() => stopTimelineResolver());

const TIMELINE_TABLES = [
    schema.timelines,
    schema.timeline_shapes,
    schema.timeline_transitions,
    schema.timeline_assignments,
    schema.timeline_slot_destinations,
];

const TABLES = [
    schema.beats,
    schema.measures,
    schema.pages,
    schema.utility,
    ...TIMELINE_TABLES,
];

const snapshot = async (db: DbConnection, tables = TABLES) => {
    const out: Record<string, unknown[]> = {};
    for (const table of tables)
        out[getTableName(table)] = await db.select().from(table).all();
    return out;
};

const setUp = async (db: DbConnection) => {
    await db.delete(schema.workspace_settings);
    await db.insert(schema.workspace_settings).values({
        id: 1,
        json_data: JSON.stringify({ timelineMode: true }),
    });
    await convertPagesToTimeline(db);
    await startTimelineResolver(db);
};

const snapshotOf = async (
    taken: Record<string, unknown[]>,
    names: readonly string[],
) => Object.fromEntries(names.map((name) => [name, taken[name]]));

const beatCount = async (db: DbConnection) =>
    (await db.select({ id: schema.beats.id }).from(schema.beats).all()).length;

/** `[id, start, end]` of every page, in show order */
const grid = async (db: DbConnection) =>
    (await db.transaction((tx) => readPageGrid(tx))).pages.map((p) => [
        p.id,
        p.start,
        p.end,
    ]);

/** The ordinals of the measures' first beats, ascending */
const measureStarts = async (db: DbConnection) => {
    const beats = await db
        .select({ id: schema.beats.id })
        .from(schema.beats)
        .orderBy(asc(schema.beats.position))
        .all();
    const order = new Map(beats.map((b, i) => [b.id, i]));
    return (await db.select().from(schema.measures).all())
        .map((m) => order.get(m.start_beat)!)
        .sort((a, b) => a - b);
};

/** Every marcher's position at every beat up to `upTo`, from the resolver */
const positions = async (upTo = 60) => {
    await timelineResolverSettled();
    const r = useTimelineResolverStore.getState().resolver!;
    const out: unknown[] = [];
    for (const id of r.marcherIds())
        for (let beat = 0; beat <= upTo; beat++)
            out.push([id, beat, r.positionAt(id, beat)]);
    return out;
};

const violations = async (db: DbConnection) =>
    await db.all(
        sql`SELECT code, transition_id, detail FROM timeline_commit_violations`,
    );

/** One undo restores `before` exactly, counts included; redo brings back `after` */
const roundTrip = async (
    db: DbConnection,
    before: Record<string, unknown[]>,
    after: Record<string, unknown[]>,
) => {
    const undo = await performUndo(db);
    expect(undo.success, undo.error?.message).toBe(true);
    expect(await snapshot(db)).toEqual(before);
    expect(await violations(db)).toEqual([]);
    const redo = await performRedo(db);
    expect(redo.success, redo.error?.message).toBe(true);
    expect(await snapshot(db)).toEqual(after);
    expect(await violations(db)).toEqual([]);
};

describeDbTests("writes past the last stored count", (it) => {
    describe("ensureCountsInTransaction", () => {
        it("stores nothing inside the counts, and up to `through` past them", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const before = await snapshot(db);
            const inside = await transactionWithHistory(db, "test", (tx) =>
                ensureCountsInTransaction({ tx, through: 90 }),
            ).catch((error: unknown) => error);
            // Nothing written is no edit: history refuses it, and nothing changed
            expect(inside).toBeInstanceOf(Error);
            expect(await snapshot(db)).toEqual(before);

            const after = await transactionWithHistory(db, "test", (tx) =>
                ensureCountsInTransaction({ tx, through: 105 }),
            );
            expect(after).toBe(105);
            expect(await beatCount(db)).toBe(105);
            // The meter carries on: measures of 4 from beat 97
            expect((await measureStarts(db)).slice(-3)).toEqual([93, 97, 101]);
            // Pages don't move
            expect(await snapshot(db, [schema.pages, schema.utility])).toEqual(
                await snapshotOf(before, ["pages", "utility"]),
            );
        });
    });

    describe("a count-in before the first page", () => {
        it("stays when counts are stored past the end (#1055)", async ({
            db,
            marchersAndPages: _,
        }) => {
            // Page 1 starts on beat 5, so beats 1 to 4 have no page
            const beats = await db
                .select({ id: schema.beats.id })
                .from(schema.beats)
                .orderBy(asc(schema.beats.position))
                .all();
            await db
                .update(schema.pages)
                .set({ start_beat: beats[5].id })
                .where(sql`${schema.pages.start_beat} = ${beats[1].id}`);
            await setUp(db);
            const firstPages = (await grid(db)).slice(0, 2);
            expect(firstPages[1][1]).toBe(5);

            await transactionWithHistory(db, "test", (tx) =>
                ensureCountsInTransaction({ tx, through: 105 }),
            );

            expect(await beatCount(db)).toBe(105);
            expect((await grid(db)).slice(0, 2)).toEqual(firstPages);
        });
    });

    describe("page flags", () => {
        it("+ far past the end stores the counts up to the flag, and one undo removes them", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const timelineBefore = await snapshot(db, TIMELINE_TABLES);
            const motionBefore = await positions();
            const before = await snapshot(db);

            const added = await addPageFlag({ db, beat: 140 });

            expect([added.startBeat, added.endBeat]).toEqual([49, 140]);
            expect(await beatCount(db)).toBe(140);
            expect((await grid(db)).slice(-1)).toEqual([
                [added.page.id, 49, 140],
            ]);
            // Nothing the drill had moves
            expect(await snapshot(db, TIMELINE_TABLES)).toEqual(timelineBefore);
            expect(await positions()).toEqual(motionBefore);
            await roundTrip(db, before, await snapshot(db));
        });

        it("the last flag's drag has no end past the moves, and stores the counts it lands on", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const limits = await pageFlagMoveLimits({ db, pageId: 6 });
            expect(limits!.max).toBe(Infinity);
            expect(limits!.maxBlock).toEqual({ kind: "open" });
            const before = await snapshot(db);

            await movePageFlag({ db, pageId: 6, beat: 130 });

            expect(await beatCount(db)).toBe(130);
            expect((await grid(db)).slice(-1)).toEqual([[6, 41, 130]]);
            await roundTrip(db, before, await snapshot(db));
        });
    });

    describe("moves", () => {
        it("a move resized past the end stores the counts it lands on", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const last = (await db.select().from(schema.timelines).all()).sort(
                (a, b) => b.end_beat - a.end_beat,
            )[0]!;
            const before = await snapshot(db);

            await resizeTimeline({
                db,
                timelineId: last.id,
                start: last.start_beat,
                end: 150,
            });

            expect(await beatCount(db)).toBe(150);
            // The last page doesn't grow to cover it
            expect((await grid(db)).slice(-1)).toEqual([[6, 41, 49]]);
            await roundTrip(db, before, await snapshot(db));
        });

        it("a move made past the end stores its counts; the marcher moves there and the pages stay", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const [marcher] = await db.select().from(schema.marchers).all();
            const before = await snapshot(db);

            await transactionWithHistory(db, "makeClip", async (tx) => {
                await moveMarchersInRangeInTransaction({
                    tx,
                    range: { start: 120, end: 128 },
                    moves: [{ marcherId: marcher!.id, x: 12, y: 34 }],
                });
            });

            expect(await beatCount(db)).toBe(128);
            expect((await grid(db)).slice(-1)).toEqual([[6, 41, 49]]);
            await timelineResolverSettled();
            const r = useTimelineResolverStore.getState().resolver!;
            expect(r.positionAt(marcher!.id, 128)).toEqual([12, 34]);
            await roundTrip(db, before, await snapshot(db));
        });

        it("Add selected marchers past the end stores the counts the move lands on", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const [marcher] = await db.select().from(schema.marchers).all();
            const before = await snapshot(db);

            const result = await addMarchersToTimeline({
                db,
                range: { start: 110, end: 118 },
                marcherIds: [marcher!.id],
            });

            expect(result.createdTimeline).toBe(true);
            expect(await beatCount(db)).toBe(118);
            const timeline = (
                await db.select().from(schema.timelines).all()
            ).find((t) => t.id === result.timelineId);
            expect(timeline).toMatchObject({ start_beat: 110, end_beat: 118 });
            // The last page doesn't grow to cover it
            expect((await grid(db)).slice(-1)).toEqual([[6, 41, 49]]);
            await roundTrip(db, before, await snapshot(db));
        });

        it("a move shifted past the end stores the counts it lands on", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const last = (await db.select().from(schema.timelines).all()).sort(
                (a, b) => b.end_beat - a.end_beat,
            )[0]!;
            const before = await snapshot(db);

            await shiftTimeline({ db, timelineId: last.id, delta: 100 });

            expect(await beatCount(db)).toBe(last.end_beat + 100);
            await roundTrip(db, before, await snapshot(db));
        });
    });

    describe("a last page whose counts run past the stored ones", () => {
        /**
         * The last page (6, from beat 41) has `last_page_counts` 72 but the show stores counts
         * only to beat 97, so it's drawn ending at 97 (`fromDatabasePages` clamps it), and its
         * move ends there.
         */
        const setUpLongLastPage = async (db: DbConnection) => {
            await db.update(schema.utility).set({ last_page_counts: 72 });
            await setUp(db);
            expect((await grid(db)).slice(-1)).toEqual([[6, 41, 97]]);
        };

        it("storing counts for a move keeps the last page as drawn, and moves nothing", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUpLongLastPage(db);
            const [marcher] = await db.select().from(schema.marchers).all();
            const timelinesBefore = await db
                .select()
                .from(schema.timelines)
                .all();
            const motionBefore = await positions(97);
            const before = await snapshot(db);

            await transactionWithHistory(db, "makeClip", async (tx) => {
                await moveMarchersInRangeInTransaction({
                    tx,
                    range: { start: 120, end: 128 },
                    moves: [{ marcherId: marcher!.id, x: 12, y: 34 }],
                });
            });

            expect(await beatCount(db)).toBe(128);
            // Its flag stays where it was drawn, and its length now says so
            expect((await grid(db)).slice(-1)).toEqual([[6, 41, 97]]);
            expect((await db.query.utility.findFirst())!.last_page_counts).toBe(
                56,
            );
            // Every row that was there stays, the move ending on the last flag included
            const timelinesAfter = await db
                .select()
                .from(schema.timelines)
                .all();
            for (const row of timelinesBefore)
                expect(timelinesAfter).toContainEqual(row);
            expect(await positions(97)).toEqual(motionBefore);
            await roundTrip(db, before, await snapshot(db));
        });

        it("+ N counts adds its page after the last flag as drawn", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUpLongLastPage(db);
            const timelineBefore = await snapshot(db, TIMELINE_TABLES);
            const before = await snapshot(db);

            const added = await appendPageOfCounts({ db, counts: 16 });

            expect([added.startBeat, added.endBeat]).toEqual([97, 113]);
            expect((await grid(db)).slice(-2)).toEqual([
                [6, 41, 97],
                [added.page.id, 97, 113],
            ]);
            expect(await beatCount(db)).toBe(113);
            expect(await snapshot(db, TIMELINE_TABLES)).toEqual(timelineBefore);
            await roundTrip(db, before, await snapshot(db));
        });
    });

    describe("the stored counts flag", () => {
        it("is set only by an edit that commits", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            takeStoredCounts();
            const refused = await transactionWithHistory(
                db,
                "test",
                async (tx) => {
                    await ensureCountsInTransaction({ tx, through: 120 });
                    throw new Error("refused");
                },
            ).catch((error: unknown) => error);
            expect(refused).toBeInstanceOf(Error);
            expect(await beatCount(db)).toBe(97);
            expect(takeStoredCounts()).toBe(false);

            await transactionWithHistory(db, "test", (tx) =>
                ensureCountsInTransaction({ tx, through: 120 }),
            );
            expect(takeStoredCounts()).toBe(true);
            expect(takeStoredCounts()).toBe(false);
        });
    });

    describe("big edits and writes keyed by beat id", () => {
        it("stores more counts in one edit than one insert statement can bind", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            // 12,000 beats bind 36,000 values, past SQLite's 32,766 for one statement
            const after = await transactionWithHistory(db, "test", (tx) =>
                ensureCountsInTransaction({ tx, through: 97 + 12_000 }),
            );
            expect(after).toBe(97 + 12_000);
            expect(await beatCount(db)).toBe(97 + 12_000);
        });

        const riser = (beatId: number): NewItemArgs => ({
            kind: "prop",
            name: "Riser",
            surfaceType: "platform",
            home: [120, 80],
            beatId,
            geometry: {
                outlineType: "rectangle",
                width: 2.4,
                depth: 1.2,
                height: 0.4,
            },
        });
        const beatIdAt = async (db: DbConnection, ordinal: number) =>
            (
                await db
                    .select({ id: schema.beats.id })
                    .from(schema.beats)
                    .orderBy(asc(schema.beats.position))
                    .all()
            )[ordinal]!.id;

        it("a prop drawn past the end stores the counts up to its beat and is on field from it, one undo step", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            // The timeline-only tables (items among them) get their history triggers as the app's
            // conversion makes them (`convertOnOpen`); the test conversion leaves that to its tests
            await createAllUndoTriggers(db);
            const before = await snapshot(db, [
                schema.beats,
                schema.measures,
                schema.items,
                schema.item_geometry,
            ]);
            const [item] = await createItems({
                db,
                newItems: [riser(endlessIdOf(110))],
            });
            expect(await beatCount(db)).toBe(111);
            const geometry = await db
                .select()
                .from(schema.item_geometry)
                .where(sql`${schema.item_geometry.item_id} = ${item!.id}`)
                .all();
            expect(geometry.map((g) => g.beat_id)).toEqual([
                await beatIdAt(db, 110),
            ]);
            await performUndo(db);
            expect(
                await snapshot(db, [
                    schema.beats,
                    schema.measures,
                    schema.items,
                    schema.item_geometry,
                ]),
            ).toEqual(before);
        });

        it("an Outline set past the end adds a change there, and leaves the one on the last stored count", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const last = await beatIdAt(db, 96);
            const [item] = await createItems({ db, newItems: [riser(last)] });
            await setItemGeometry({
                db,
                itemId: item!.id,
                beatId: endlessIdOf(104),
                geometry: {
                    outlineType: "rectangle",
                    width: 4,
                    depth: 1.2,
                    height: 0.4,
                },
            });
            const rows = await db
                .select()
                .from(schema.item_geometry)
                .where(sql`${schema.item_geometry.item_id} = ${item!.id}`)
                .all();
            expect(
                rows
                    .map((r) => [r.beat_id, r.width])
                    .sort((a, b) => a[1]! - b[1]!),
            ).toEqual([
                [last, 2.4],
                [await beatIdAt(db, 104), 4],
            ]);
        });
    });
});
