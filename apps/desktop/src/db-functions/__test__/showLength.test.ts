import { afterEach, describe, expect } from "vitest";
import { asc, getTableName, sql } from "drizzle-orm";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/timeline/convert/writePageConversion";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import { performRedo, performUndo } from "../history";
import { readPageGrid } from "../timelineRipple";
import { TimelineWriteError } from "../timelineErrors";
import {
    appendPageOfCounts,
    appendPagesToEnd,
    extendCountsTo,
} from "../showLength";

// These tests set the flag and convert the show themselves
keepFixturesInPageMode(
    "its tests convert the show and set the flag themselves",
);

/**
 * Counts past the end of the show (tempo experiment E1), on the `marchersAndPages` show: beat 0
 * plus 96 counts of 0.5 s (48 s), 24 measures of 4 starting at beats 1, 5, …, 93, and page 0 plus
 * pages 1 to 6 starting at beats 1, 9, …, 41, 8 counts each, so the last flag is at beat 49.
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
    schema.marcher_pages,
    ...TIMELINE_TABLES,
];

const snapshot = async (db: DbConnection, tables = TABLES) => {
    const out: Record<string, unknown[]> = {};
    for (const table of tables)
        out[getTableName(table)] = await db.select().from(table).all();
    return out;
};

const setTimelineFlag = async (db: DbConnection, on: boolean) => {
    await db.delete(schema.workspace_settings);
    await db.insert(schema.workspace_settings).values({
        id: 1,
        json_data: JSON.stringify({ timelineMode: on }),
    });
};

const setUp = async (db: DbConnection) => {
    await setTimelineFlag(db, true);
    await convertPagesToTimeline(db);
    await startTimelineResolver(db);
};

/** `[id, start, end]` of every page, in show order */
const grid = async (db: DbConnection) =>
    (await db.transaction((tx) => readPageGrid(tx))).pages.map((p) => [
        p.id,
        p.start,
        p.end,
    ]);

const beats = async (db: DbConnection) =>
    await db
        .select({ id: schema.beats.id, duration: schema.beats.duration })
        .from(schema.beats)
        .orderBy(asc(schema.beats.position))
        .all();

/** The ordinals of the measures' first beats, ascending */
const measureStarts = async (db: DbConnection) => {
    const order = new Map((await beats(db)).map((b, i) => [b.id, i]));
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

/** One undo restores `before` exactly; redo brings back `after` */
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

const ORIGINAL = [
    [0, 0, 1],
    [1, 1, 9],
    [2, 9, 17],
    [3, 17, 25],
    [4, 25, 33],
    [5, 33, 41],
    [6, 41, 49],
];

describeDbTests("counts past the end of the show (E1)", (it) => {
    describe("pages every N counts to the end (FB-7)", () => {
        it("adds a page every 16 counts over the counts past the last flag, as one undo", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const timelineBefore = await snapshot(db, TIMELINE_TABLES);
            const motionBefore = await positions();
            const before = await snapshot(db);

            expect(await appendPagesToEnd({ db, counts: 16 })).toBe(3);

            const after = await grid(db);
            expect(after.slice(0, 7)).toEqual(ORIGINAL);
            expect(
                after.slice(7).map(([, start, end]) => [start, end]),
            ).toEqual([
                [49, 65],
                [65, 81],
                [81, 97],
            ]);
            // No counts added, and nothing the drill had moves
            expect((await beats(db)).length).toBe(97);
            expect(await snapshot(db, TIMELINE_TABLES)).toEqual(timelineBefore);
            expect(await positions()).toEqual(motionBefore);
            await roundTrip(db, before, await snapshot(db));
            // Pages already reach the end: nothing to add, and no empty undo step
            expect(await appendPagesToEnd({ db, counts: 16 })).toBe(0);
        });
    });

    describe("+ N counts after the last page", () => {
        it("where the show has counts after the last flag, it adds a page there and no counts", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const timelineBefore = await snapshot(db, TIMELINE_TABLES);
            const motionBefore = await positions();
            const before = await snapshot(db);

            const added = await appendPageOfCounts({ db, counts: 16 });

            expect([added.startBeat, added.endBeat]).toEqual([49, 65]);
            expect(await grid(db)).toEqual([
                ...ORIGINAL,
                [added.page.id, 49, 65],
            ]);
            expect((await beats(db)).length).toBe(97);
            expect(await snapshot(db, TIMELINE_TABLES)).toEqual(timelineBefore);
            expect(await positions()).toEqual(motionBefore);
            await roundTrip(db, before, await snapshot(db));
        });

        it("where the show ends at its last flag, it appends the counts at the last tempo and meter", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            // The last page runs to the end of the show: its flag is on the last count
            await db.update(schema.utility).set({ last_page_counts: 56 });
            // A slower last count, to see the tempo carry on
            await db
                .update(schema.beats)
                .set({ duration: 0.6 })
                .where(sql`${schema.beats.id} >= 93`);
            const timelineBefore = await snapshot(db, TIMELINE_TABLES);
            const motionBefore = await positions(96);
            const before = await snapshot(db);

            const added = await appendPageOfCounts({ db, counts: 8 });

            expect([added.startBeat, added.endBeat]).toEqual([97, 105]);
            expect(await grid(db)).toEqual([
                ...ORIGINAL.slice(0, 6),
                [6, 41, 97],
                [added.page.id, 97, 105],
            ]);
            const after = await beats(db);
            expect(after.length).toBe(105);
            expect(after.slice(97).map((b) => b.duration)).toEqual(
                Array(8).fill(0.6),
            );
            // Measures of 4 carry on from the first appended count
            expect((await measureStarts(db)).slice(-4)).toEqual([
                89, 93, 97, 101,
            ]);
            expect((await db.query.utility.findFirst())!.last_page_counts).toBe(
                8,
            );
            // Nothing after the end of the show: every timeline row stays
            expect(await snapshot(db, TIMELINE_TABLES)).toEqual(timelineBefore);
            expect(await positions(96)).toEqual(motionBefore);
            await roundTrip(db, before, await snapshot(db));
        });

        it("finishes a short last measure before starting new ones", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            await db.update(schema.utility).set({ last_page_counts: 56 });
            // Measure 24 (beats 93-96) loses its line, so measure 23 runs 8 counts; the line goes
            // back at 95, leaving a 2-count last measure after a meter of 6 (89-94)
            await db
                .update(schema.measures)
                .set({ start_beat: 95 })
                .where(sql`${schema.measures.id} = 24`);

            await appendPageOfCounts({ db, counts: 8 });

            expect((await measureStarts(db)).slice(-3)).toEqual([89, 95, 101]);
        });

        it("is refused outside timeline mode, and writes nothing", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setTimelineFlag(db, false);
            await db.update(schema.utility).set({ last_page_counts: 56 });
            const before = await snapshot(db);
            const error = await appendPageOfCounts({ db, counts: 8 }).then(
                () => null,
                (e: unknown) => e,
            );
            expect(error).toBeInstanceOf(TimelineWriteError);
            expect((error as TimelineWriteError).code).toBe("E-ARGS");
            expect(await snapshot(db)).toEqual(before);
        });
    });

    describe("Extend counts to the end of the music", () => {
        it("appends whole measures until the music's end, with no page flag", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const pagesBefore = await grid(db);
            const timelineBefore = await snapshot(db, TIMELINE_TABLES);
            const before = await snapshot(db);

            // 48 s of counts; music to 2:31: 103 s more is 206 counts, so 52 measures (208)
            const added = await extendCountsTo({ db, untilSeconds: 151 });

            expect(added).toBe(208);
            const after = await beats(db);
            expect(after.length).toBe(97 + 208);
            expect(after.reduce((sum, b) => sum + b.duration, 0)).toBe(152);
            const starts = await measureStarts(db);
            expect(starts.length).toBe(24 + 52);
            expect(starts.slice(-2)).toEqual([297, 301]);
            expect(await grid(db)).toEqual(pagesBefore);
            expect(await snapshot(db, TIMELINE_TABLES)).toEqual(timelineBefore);
            await roundTrip(db, before, await snapshot(db));
        });

        it("works in page mode too, and adds nothing when the counts already reach the end", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setTimelineFlag(db, false);
            expect(await extendCountsTo({ db, untilSeconds: 30 })).toBe(0);
            expect((await beats(db)).length).toBe(97);
            expect(await extendCountsTo({ db, untilSeconds: 49 })).toBe(4);
            expect((await beats(db)).length).toBe(101);
        });
    });
});
