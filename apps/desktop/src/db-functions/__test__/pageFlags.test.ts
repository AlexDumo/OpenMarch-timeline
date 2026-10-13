import { afterEach, describe, expect, test } from "vitest";
import { eq, getTableName, sql } from "drizzle-orm";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { getTestWithHistory } from "@/test/history";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/timeline/convert/writePageConversion";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import { performRedo, performUndo } from "../history";
import {
    addPageFlag,
    appendedPageMessage,
    appendPageLabel,
    basicAppendLength,
    countsText,
    deletePageFlags,
    pageFlagGrid,
    planPageFlagInsertion,
} from "../pageFlags";
import { readPageGrid } from "../timelineRipple";
import { TimelineWriteError } from "../timelineErrors";

// These tests set the flag and convert the show themselves
keepFixturesInPageMode(
    "its tests convert the show and set the flag themselves",
);

/**
 * Page flags in timeline mode (docs/timeline/ui.md UI-9 **+** and Deleting a flag, P8.13), on a
 * converted `marchersAndPages` show: beat 0 plus 96 beats (97 ordinals), page 0 plus pages 1 to 6
 * starting at beats 1, 9, 17, 25, 33 and 41 (8 counts each, so flags at 9, 17, …, 49). Beat ids
 * equal their ordinals here.
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
    schema.pages,
    schema.utility,
    schema.marchers,
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

const setUp = async (db: DbConnection, flag = true) => {
    await setTimelineFlag(db, flag);
    await convertPagesToTimeline(db);
    await startTimelineResolver(db);
};

/** `[id, start, end]` of every page, in show order. */
const grid = async (db: DbConnection) =>
    (await db.transaction((tx) => readPageGrid(tx))).pages.map((p) => [
        p.id,
        p.start,
        p.end,
    ]);

const lastPageCounts = async (db: DbConnection) =>
    (await db.query.utility.findFirst())!.last_page_counts;

/** Every marcher's position at every beat up to `upTo`, from the resolver. */
const positions = async (db: DbConnection, upTo = 60) => {
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

const expectRefused = async (write: Promise<unknown>) => {
    const error = await write.then(
        () => null,
        (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TimelineWriteError);
    expect((error as TimelineWriteError).code).toBe("E-ARGS");
};

describe("planPageFlagInsertion", () => {
    const pages = [
        { id: 0, start: 0, end: 1 },
        { id: 1, start: 1, end: 9 },
        { id: 2, start: 9, end: 17 },
    ];
    const plan = (beat: number, beatCount = 30) =>
        planPageFlagInsertion({ beatCount, pages }, beat);

    test("inside a page it splits that page", () => {
        expect(plan(5)).toEqual({
            kind: "split",
            beat: 5,
            page: pages[1],
            last: false,
        });
        expect(plan(16)).toEqual({
            kind: "split",
            beat: 16,
            page: pages[2],
            last: true,
        });
    });

    test("past the last flag it appends, while the show has the beats", () => {
        expect(plan(18)).toEqual({
            kind: "append",
            beat: 18,
            lastPage: pages[2],
        });
        expect(plan(30)).toMatchObject({ kind: "append", beat: 30 });
        expect(plan(31)).toBeNull();
    });

    test("nothing on a flag, at home, or at a fractional beat", () => {
        for (const beat of [0, 1, 9, 17, 4.5, -1, Number.NaN])
            expect(plan(beat), `beat ${beat}`).toBeNull();
        expect(planPageFlagInsertion({ beatCount: 30, pages: [] }, 5)).toBe(
            null,
        );
    });

    test("in Basic it also appends on the last flag, and only there", () => {
        const basic = (beat: number, beatCount = 30) =>
            planPageFlagInsertion({ beatCount, pages }, beat, { basic: true });
        expect(basic(17)).toEqual({
            kind: "append",
            beat: 17,
            lastPage: pages[2],
        });
        // Where the show's beats end on the last flag too
        expect(basic(17, 17)).toMatchObject({ kind: "append", beat: 17 });
        expect(basic(18)).toMatchObject({ kind: "append", beat: 18 });
        expect(basic(12)).toMatchObject({ kind: "split", beat: 12 });
        for (const beat of [0, 1, 9, 4.5]) expect(basic(beat)).toBeNull();
    });

    test("in a show with only home, Basic appends on home's flag; Expert doesn't", () => {
        const home = [pages[0]!];
        expect(
            planPageFlagInsertion({ beatCount: 30, pages: home }, 1, {
                basic: true,
            }),
        ).toEqual({ kind: "append", beat: 1, lastPage: pages[0] });
        expect(
            planPageFlagInsertion({ beatCount: 30, pages: home }, 1),
        ).toBeNull();
        expect(
            planPageFlagInsertion({ beatCount: 30, pages: home }, 0, {
                basic: true,
            }),
        ).toBeNull();
    });

    test("pageFlagGrid reads the renderer's pages", () => {
        const beats = (from: number, to: number) =>
            Array.from({ length: to - from }, (_, i) => ({ index: from + i }));
        expect(
            pageFlagGrid(
                [
                    { id: 2, beats: beats(9, 17) },
                    { id: 0, beats: beats(0, 1) },
                    { id: 1, beats: beats(1, 9) },
                    { id: 9, beats: [] },
                ],
                30,
            ),
        ).toEqual({ beatCount: 30, pages });
    });
});

describe("Basic's append in words", () => {
    test("countsText", () => {
        expect(countsText(1)).toBe("1 count");
        expect(countsText(16)).toBe("16 counts");
    });

    test("basicAppendLength: the default counts, and how many the show is short", () => {
        expect(basicAppendLength(49, 97, 16)).toEqual({
            counts: 16,
            missing: 0,
        });
        expect(basicAppendLength(81, 97, 16)).toEqual({
            counts: 16,
            missing: 0,
        });
        expect(basicAppendLength(97, 97, 16)).toEqual({
            counts: 16,
            missing: 16,
        });
        expect(basicAppendLength(90, 97, 8)).toEqual({ counts: 8, missing: 1 });
    });

    test("appendPageLabel leaves out what it doesn't know", () => {
        const full = { counts: 16, missing: 0 };
        expect(appendPageLabel("4", full)).toBe(
            "Add a page of 16 counts after Page 4",
        );
        expect(appendPageLabel("4", { counts: 1, missing: 0 })).toBe(
            "Add a page of 1 count after Page 4",
        );
        expect(appendPageLabel("4", { counts: 8, missing: 3 })).toBe(
            "Add a page of 8 counts after Page 4, lengthening the show",
        );
        expect(appendPageLabel(undefined, full)).toBe(
            "Add a page of 16 counts",
        );
        expect(appendPageLabel("4", undefined)).toBe("Add a page after Page 4");
        expect(appendPageLabel(undefined, undefined)).toBe("Add a page");
    });

    test("appendedPageMessage names the page and its counts, and the measures it added", () => {
        expect(
            appendedPageMessage({
                name: "5",
                appended: { counts: 16, addedMeasures: 0 },
            }),
        ).toBe("Added Page 5 · 16 counts");
        expect(
            appendedPageMessage({
                name: "5",
                appended: { counts: 1, addedMeasures: 1 },
            }),
        ).toBe("Added Page 5 · 1 count, and 1 measure at the end of the show");
        expect(
            appendedPageMessage({
                name: "5",
                appended: { counts: 16, addedMeasures: 4 },
            }),
        ).toBe(
            "Added Page 5 · 16 counts, and 4 measures at the end of the show",
        );
        expect(appendedPageMessage({ name: "5" })).toBeNull();
    });
});

describeDbTests("page flags in timeline mode (UI-9)", (it) => {
    describe("+", () => {
        it("inside a page: the split page keeps its flag, id and notes; the new page comes before it", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            await db
                .update(schema.pages)
                .set({ notes: "page two" })
                .where(eq(schema.pages.id, 2));
            const timelineBefore = await snapshot(db, TIMELINE_TABLES);
            const motionBefore = await positions(db);
            const countsBefore = await lastPageCounts(db);
            const before = await snapshot(db);

            const added = await addPageFlag({ db, beat: 13 });

            expect(added.startBeat).toBe(9);
            expect(added.endBeat).toBe(13);
            expect(added.page.is_subset).toBe(false);
            expect(added.page.notes).toBeNull();
            const id = added.page.id;
            expect(await grid(db)).toEqual([
                [0, 0, 1],
                [1, 1, 9],
                [id, 9, 13],
                [2, 13, 17],
                [3, 17, 25],
                [4, 25, 33],
                [5, 33, 41],
                [6, 41, 49],
            ]);
            const two = await db.query.pages.findFirst({
                where: eq(schema.pages.id, 2),
            });
            expect(two!.notes).toBe("page two");
            expect(await lastPageCounts(db)).toBe(countsBefore);
            // Only page rows changed: motion is the same everywhere
            expect(await snapshot(db, TIMELINE_TABLES)).toEqual(timelineBefore);
            expect(await positions(db)).toEqual(motionBefore);
            await roundTrip(db, before, await snapshot(db));
        });

        it("in the last page: the last flag stays, through last_page_counts", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const timelineBefore = await snapshot(db, TIMELINE_TABLES);
            const before = await snapshot(db);

            const added = await addPageFlag({ db, beat: 45 });

            expect([added.startBeat, added.endBeat]).toEqual([41, 45]);
            expect(await grid(db)).toEqual([
                ...ORIGINAL.slice(0, 6),
                [added.page.id, 41, 45],
                [6, 45, 49],
            ]);
            expect(await lastPageCounts(db)).toBe(4);
            expect(await snapshot(db, TIMELINE_TABLES)).toEqual(timelineBefore);
            await roundTrip(db, before, await snapshot(db));
        });

        it("past the last flag: appends a page ending at the beat", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const timelineBefore = await snapshot(db, TIMELINE_TABLES);
            const motionBefore = await positions(db);
            const before = await snapshot(db);

            const added = await addPageFlag({ db, beat: 60 });

            expect([added.startBeat, added.endBeat]).toEqual([49, 60]);
            expect(await grid(db)).toEqual([
                ...ORIGINAL,
                [added.page.id, 49, 60],
            ]);
            expect(await lastPageCounts(db)).toBe(11);
            expect(await snapshot(db, TIMELINE_TABLES)).toEqual(timelineBefore);
            expect(await positions(db)).toEqual(motionBefore);
            await roundTrip(db, before, await snapshot(db));
        });

        describe("Basic (basic)", () => {
            const setDefaultNewPageCounts = async (
                db: DbConnection,
                counts: number,
            ) =>
                await db.update(schema.workspace_settings).set({
                    json_data: JSON.stringify({
                        timelineMode: true,
                        defaultNewPageCounts: counts,
                    }),
                });
            const WITH_MEASURES = [...TABLES, schema.measures];

            it("on or past the last flag: appends a page of the file's default new-page counts from the last flag, wherever the beat is", async ({
                db,
                marchersAndPages: _,
            }) => {
                await setUp(db);
                await setDefaultNewPageCounts(db, 8);
                const timelineBefore = await snapshot(db, TIMELINE_TABLES);
                const before = await snapshot(db);

                // On the flag, just past it, inside the new page, and past where it ends
                for (const beat of [49, 50, 53, 80]) {
                    const added = await addPageFlag({ db, beat, basic: true });
                    expect([added.startBeat, added.endBeat]).toEqual([49, 57]);
                    expect(added.name).toBe("7");
                    expect(added.appended).toEqual({
                        counts: 8,
                        addedMeasures: 0,
                    });
                    expect(await grid(db)).toEqual([
                        ...ORIGINAL,
                        [added.page.id, 49, 57],
                    ]);
                    expect(await lastPageCounts(db)).toBe(8);
                    expect(await snapshot(db, TIMELINE_TABLES)).toEqual(
                        timelineBefore,
                    );
                    await roundTrip(db, before, await snapshot(db));
                    expect((await performUndo(db)).success).toBe(true);
                }
            });

            it("the default is 16 counts when the file doesn't set one", async ({
                db,
                marchersAndPages: _,
            }) => {
                await setUp(db);
                const added = await addPageFlag({
                    db,
                    beat: 52,
                    basic: true,
                });
                expect([added.startBeat, added.endBeat]).toEqual([49, 65]);
                expect(added.appended).toEqual({
                    counts: 16,
                    addedMeasures: 0,
                });
            });

            it("back to back, then where the music ends on the last flag: lengthens the show by whole default measures, in the same edit, with motion unchanged", async ({
                db,
                marchersAndPages: _,
            }) => {
                await setUp(db);
                const timelineBefore = await snapshot(db, TIMELINE_TABLES);
                const motionBefore = await positions(db);
                // 97 ordinals: 16-count pages from the last flag at 49 fill the show to its end
                for (const flag of [49, 65, 81]) {
                    const added = await addPageFlag({
                        db,
                        beat: flag,
                        basic: true,
                    });
                    expect([added.startBeat, added.endBeat]).toEqual([
                        flag,
                        flag + 16,
                    ]);
                }
                const beatsBefore = (await db.select().from(schema.beats).all())
                    .length;
                expect(beatsBefore).toBe(97);
                const measuresBefore = (
                    await db.select().from(schema.measures).all()
                ).length;
                const before = await snapshot(db, WITH_MEASURES);

                const added = await addPageFlag({ db, beat: 97, basic: true });

                expect([added.startBeat, added.endBeat]).toEqual([97, 113]);
                expect(added.name).toBe("10");
                // 16 counts in the default 4/4 at 120: 4 measures
                expect(added.appended).toEqual({
                    counts: 16,
                    addedMeasures: 4,
                });
                const beats = await db.select().from(schema.beats).all();
                expect(beats).toHaveLength(113);
                expect(beats.slice(97).every((b) => b.duration === 0.5)).toBe(
                    true,
                );
                expect(
                    (await db.select().from(schema.measures).all()).length,
                ).toBe(measuresBefore + 4);
                expect((await grid(db)).at(-1)).toEqual([
                    added.page.id,
                    97,
                    113,
                ]);
                expect(await lastPageCounts(db)).toBe(16);
                // No timeline row is written: motion is the same
                expect(await snapshot(db, TIMELINE_TABLES)).toEqual(
                    timelineBefore,
                );
                expect(await positions(db)).toEqual(motionBefore);
                // One undo takes back the beats, the measures and the page
                const after = await snapshot(db, WITH_MEASURES);
                expect((await performUndo(db)).success).toBe(true);
                expect(await snapshot(db, WITH_MEASURES)).toEqual(before);
                expect((await performRedo(db)).success).toBe(true);
                expect(await snapshot(db, WITH_MEASURES)).toEqual(after);
                expect(await violations(db)).toEqual([]);
            });

            it("adds only the measures it's short of", async ({
                db,
                marchersAndPages: _,
            }) => {
                await setUp(db);
                await setDefaultNewPageCounts(db, 50);
                // From 49, 50 counts need beat 99: the show is 2 counts short, so 1 measure
                const added = await addPageFlag({ db, beat: 52, basic: true });
                expect([added.startBeat, added.endBeat]).toEqual([49, 99]);
                expect(added.appended).toEqual({
                    counts: 50,
                    addedMeasures: 1,
                });
                expect(await db.select().from(schema.beats).all()).toHaveLength(
                    101,
                );
                expect(await lastPageCounts(db)).toBe(50);
            });

            it("inside a page it still splits at the beat", async ({
                db,
                marchersAndPages: _,
            }) => {
                await setUp(db);
                const added = await addPageFlag({ db, beat: 13, basic: true });
                expect([added.startBeat, added.endBeat]).toEqual([9, 13]);
                expect(added.name).toBe("2");
                expect(added.appended).toBeUndefined();
            });

            it("a show with only home: appends page 1 on home's flag", async ({
                db,
                marchersAndPages: _,
            }) => {
                await setUp(db);
                await deletePageFlags({
                    db,
                    pageIds: new Set([1, 2, 3, 4, 5, 6]),
                });
                expect(await grid(db)).toEqual([[0, 0, 1]]);
                await expectRefused(addPageFlag({ db, beat: 1 }));
                const added = await addPageFlag({ db, beat: 1, basic: true });
                expect([added.startBeat, added.endBeat]).toEqual([1, 17]);
                expect(added.name).toBe("1");
                expect(await grid(db)).toEqual([
                    [0, 0, 1],
                    [added.page.id, 1, 17],
                ]);
            });

            it("Expert still refuses on the last flag", async ({
                db,
                marchersAndPages: _,
            }) => {
                await setUp(db);
                await expectRefused(addPageFlag({ db, beat: 49 }));
            });
        });

        it("refuses on a flag, at home, past the show's beats, at a fractional beat, and in page mode, writing nothing", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const before = await snapshot(db);
            for (const beat of [0, 1, 9, 17, 49, 98, 12.5])
                await expectRefused(addPageFlag({ db, beat }));
            expect(await snapshot(db)).toEqual(before);

            await setTimelineFlag(db, false);
            await expectRefused(addPageFlag({ db, beat: 13 }));
            expect(await snapshot(db)).toEqual(before);
        });
    });

    describe("deleting a flag", () => {
        it("removes only that flag: the next page takes its start and keeps its own flag", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            await db
                .update(schema.pages)
                .set({ notes: "page four" })
                .where(eq(schema.pages.id, 4));
            const timelineBefore = await snapshot(db, TIMELINE_TABLES);
            const motionBefore = await positions(db);
            const before = await snapshot(db);

            const deleted = await deletePageFlags({
                db,
                pageIds: new Set([3]),
            });

            expect(deleted.map((p) => p.id)).toEqual([3]);
            expect(await grid(db)).toEqual([
                ...ORIGINAL.slice(0, 3),
                [4, 17, 33],
                ...ORIGINAL.slice(5),
            ]);
            const four = await db.query.pages.findFirst({
                where: eq(schema.pages.id, 4),
            });
            expect(four!.notes).toBe("page four");
            expect(
                await db
                    .select()
                    .from(schema.marcher_pages)
                    .where(eq(schema.marcher_pages.page_id, 3))
                    .all(),
            ).toEqual([]);
            expect(await snapshot(db, TIMELINE_TABLES)).toEqual(timelineBefore);
            expect(await positions(db)).toEqual(motionBefore);
            await roundTrip(db, before, await snapshot(db));
        });

        it("the first page after home: the next page starts at home's flag", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const before = await snapshot(db);
            await deletePageFlags({ db, pageIds: new Set([1]) });
            expect(await grid(db)).toEqual([
                [0, 0, 1],
                [2, 1, 17],
                ...ORIGINAL.slice(3),
            ]);
            await roundTrip(db, before, await snapshot(db));
        });

        it("the last page: the page before becomes the last, ending at its own flag", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            // Page 5 becomes [37, 41), so the counts after the delete are 4
            await addPageFlag({ db, beat: 37 });
            const timelineBefore = await snapshot(db, TIMELINE_TABLES);
            const before = await snapshot(db);

            await deletePageFlags({ db, pageIds: new Set([6]) });

            expect((await grid(db)).at(-1)).toEqual([5, 37, 41]);
            expect(await lastPageCounts(db)).toBe(4);
            expect(await snapshot(db, TIMELINE_TABLES)).toEqual(timelineBefore);
            await roundTrip(db, before, await snapshot(db));
        });

        it("several flags at once, adjacent ones included; home is skipped", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const before = await snapshot(db);
            const deleted = await deletePageFlags({
                db,
                pageIds: new Set([0, 3, 4, 6]),
            });
            expect(deleted.map((p) => p.id).sort()).toEqual([3, 4, 6]);
            expect(await grid(db)).toEqual([
                ...ORIGINAL.slice(0, 3),
                [5, 17, 41],
            ]);
            // Page 5 ends at its own flag, 41
            expect(await lastPageCounts(db)).toBe(24);
            await roundTrip(db, before, await snapshot(db));
        });

        it("undoes +: deleting the added page's flag puts the page rows back", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const rows = async () =>
                (await db.select().from(schema.pages).all())
                    .map((p) => [p.id, p.start_beat, p.notes, p.is_subset])
                    .sort((a, b) => (a[0] as number) - (b[0] as number));
            const pagesBefore = await rows();
            const countsBefore = await lastPageCounts(db);

            const middle = await addPageFlag({ db, beat: 20 });
            await deletePageFlags({ db, pageIds: new Set([middle.page.id]) });
            const last = await addPageFlag({ db, beat: 44 });
            await deletePageFlags({ db, pageIds: new Set([last.page.id]) });

            expect(await rows()).toEqual(pagesBefore);
            expect(await lastPageCounts(db)).toBe(countsBefore);
            expect(await grid(db)).toEqual(ORIGINAL);
        });

        it("refuses an unknown page and page mode, writing nothing; home alone is a no-op", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const before = await snapshot(db);
            await expectRefused(
                deletePageFlags({ db, pageIds: new Set([99]) }),
            );
            expect(
                await deletePageFlags({ db, pageIds: new Set([0]) }),
            ).toEqual([]);
            expect(await snapshot(db)).toEqual(before);

            await setTimelineFlag(db, false);
            await expectRefused(deletePageFlags({ db, pageIds: new Set([3]) }));
            expect(await snapshot(db)).toEqual(before);
        });
    });

    describe("history", () => {
        const testWithHistory = getTestWithHistory(it, TABLES);

        testWithHistory(
            "+ and deleting a flag are one undoable edit each",
            async ({ db, marchersAndPages: _, expectNumberOfChanges }) => {
                await setUp(db);
                const state = await expectNumberOfChanges.getDatabaseState(db);
                await addPageFlag({ db, beat: 13 });
                await addPageFlag({ db, beat: 60 });
                await deletePageFlags({ db, pageIds: new Set([3, 5]) });
                await expectNumberOfChanges.test(db, 3, state);
            },
        );
    });
});
