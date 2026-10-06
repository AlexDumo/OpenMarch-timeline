import { afterEach, describe, expect } from "vitest";
import { asc, getTableName, sql } from "drizzle-orm";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { convertPagesToTimeline } from "@/timeline/convert/writePageConversion";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { performRedo, performUndo } from "../history";
import { createTrack } from "../timelineCommands";
import { readPageGrid } from "../timelineRipple";
import { TimelineWriteError } from "../timelineErrors";
import {
    commitDrillEdit,
    insertedMeasureStarts,
    onDrillPreviewRolledBack,
    previewDrillEdit,
    stepsPerFiveYards,
    withLastFlag,
    type DrillEdit,
    type DrillImpact,
} from "../drillEdits";

keepFixturesInPageMode(
    "its tests convert the show and set the timeline flag themselves",
);

/**
 * Count edits with drill choices (tempo experiment E10), on the converted `marchersAndPages`
 * show: beat 0, then 96 beats of 0.5 s; page 0, then pages 1 to 6 of 8 counts starting at beats
 * 1, 9, 17, 25, 33 and 41; one timeline per page with one layer-0 move. Beat ids are ordinals.
 */

afterEach(() => stopTimelineResolver());

const TABLES = [
    schema.beats,
    schema.pages,
    schema.measures,
    schema.utility,
    schema.timelines,
    schema.timeline_transitions,
    schema.timeline_assignments,
    schema.timeline_slot_destinations,
];

const snapshot = async (db: DbConnection) => {
    const out: Record<string, unknown[]> = {};
    for (const table of TABLES)
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

const resolver = () => useTimelineResolverStore.getState().resolver!;

const timelineRanges = async (db: DbConnection) =>
    (
        await db
            .select()
            .from(schema.timelines)
            .orderBy(asc(schema.timelines.start_beat), asc(schema.timelines.id))
            .all()
    ).map((l) => [l.start_beat, l.end_beat]);

const pageRanges = async (db: DbConnection) =>
    (await db.transaction((tx) => readPageGrid(tx))).pages
        .filter((p) => p.id !== 0)
        .map((p) => [p.start, p.end]);

const violations = async (db: DbConnection) =>
    await db.all(sql`SELECT code FROM timeline_commit_violations`);

/** A preview reports what the commit does, writes nothing, and the commit undoes and redoes */
const previewThenCommit = async (
    db: DbConnection,
    edit: DrillEdit,
): Promise<DrillImpact> => {
    const before = await snapshot(db);
    const preview = (await previewDrillEdit({ db, edit }))!;
    if (!preview.ok) throw preview.error;
    expect(await snapshot(db), "a preview writes nothing").toEqual(before);
    const impact = await commitDrillEdit({ db, edit });
    expect(impact).toEqual(preview.impact);
    expect(await violations(db)).toEqual([]);
    await timelineResolverSettled();
    return impact;
};

/** One undo restores everything; redo brings the edit back */
const roundTrip = async (
    db: DbConnection,
    before: Record<string, unknown[]>,
) => {
    const after = await snapshot(db);
    const undo = await performUndo(db);
    expect(undo.success, undo.error?.message).toBe(true);
    expect(await snapshot(db)).toEqual(before);
    const redo = await performRedo(db);
    expect(redo.success, redo.error?.message).toBe(true);
    expect(await snapshot(db)).toEqual(after);
    await timelineResolverSettled();
};

const ORIGINAL = [
    [1, 9],
    [9, 17],
    [17, 25],
    [25, 33],
    [33, 41],
    [41, 49],
];

describeDbTests("count edits with drill choices (E10)", (it) => {
    describe("remove counts", () => {
        it("inside a page: its move is squeezed to the same set, later moves shift, one undo", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const at17 = new Map(
                resolver()
                    .marcherIds()
                    .map((id) => [id, resolver().positionAt(id, 17)]),
            );
            const before = await snapshot(db);
            const impact = await previewThenCommit(db, {
                kind: "removeCounts",
                start: 11,
                end: 13,
                crossing: "squeeze",
                inside: "keep",
            });
            expect(await timelineRanges(db)).toEqual([
                [1, 9],
                [9, 15],
                [15, 23],
                [23, 31],
                [31, 39],
                [39, 47],
            ]);
            expect(await pageRanges(db)).toEqual(await timelineRanges(db));
            // Page 2's set is reached two counts sooner
            for (const [id, [x, y]] of at17) {
                const [nx, ny] = resolver().positionAt(id, 15);
                expect(nx).toBeCloseTo(x, 9);
                expect(ny).toBeCloseTo(y, 9);
            }
            expect(impact.countsBefore - impact.countsAfter).toBe(2);
            expect(impact.pages).toEqual([
                {
                    id: 2,
                    nameBefore: "2",
                    nameAfter: "2",
                    countsBefore: 8,
                    countsAfter: 6,
                },
            ]);
            expect(impact.renumbered).toBeNull();
            const squeezed = impact.moves.filter(
                (m) => m.change === "squeezed",
            );
            expect(squeezed).toHaveLength(1);
            expect(squeezed[0]).toMatchObject({
                clip: { kind: "page", page: "2" },
                pageMove: true,
                countsBefore: 8,
                countsAfter: 6,
                before: {
                    startPage: "2",
                    startCount: 1,
                    endPage: "2",
                    endCount: 8,
                },
            });
            // Same distance in fewer counts: bigger steps
            const { stepBefore, stepAfter } = squeezed[0]!;
            if (stepBefore !== undefined && stepAfter !== undefined)
                expect(stepAfter).toBeCloseTo((stepBefore * 6) / 8, 9);
            const shifted = impact.moves.filter((m) => m.change === "shifted");
            expect(shifted.map((m) => m.shiftBy)).toEqual([-2, -2, -2, -2]);
            await roundTrip(db, before);
        });

        it("across a page line, squeezing: both pages lose counts and keep their sets", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const impact = await previewThenCommit(db, {
                kind: "removeCounts",
                start: 13,
                end: 21,
                crossing: "squeeze",
                inside: "keep",
            });
            // Page 3 starts on the first count after the cut
            expect(await pageRanges(db)).toEqual([
                [1, 9],
                [9, 13],
                [13, 17],
                [17, 25],
                [25, 33],
                [33, 41],
            ]);
            expect(await timelineRanges(db)).toEqual(await pageRanges(db));
            expect(
                impact.moves
                    .filter((m) => m.change === "squeezed")
                    .map((m) => [m.countsBefore, m.countsAfter]),
            ).toEqual([
                [8, 4],
                [8, 4],
            ]);
        });

        it("across a page line, skipping: the move into the cut stops where marchers are when it starts", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const at13 = new Map(
                resolver()
                    .marcherIds()
                    .map((id) => [id, resolver().positionAt(id, 13)]),
            );
            const at25 = new Map(
                resolver()
                    .marcherIds()
                    .map((id) => [id, resolver().positionAt(id, 25)]),
            );
            const before = await snapshot(db);
            const impact = await previewThenCommit(db, {
                kind: "removeCounts",
                start: 13,
                end: 21,
                crossing: "skip",
                inside: "keep",
            });
            expect(await timelineRanges(db)).toEqual(await pageRanges(db));
            for (const [id, [x, y]] of at13) {
                const [nx, ny] = resolver().positionAt(id, 13);
                expect(nx).toBeCloseTo(x, 9);
                expect(ny).toBeCloseTo(y, 9);
            }
            // Page 3 still arrives on its set, from there
            for (const [id, [x, y]] of at25) {
                const [nx, ny] = resolver().positionAt(id, 17);
                expect(nx).toBeCloseTo(x, 9);
                expect(ny).toBeCloseTo(y, 9);
            }
            const byPage = new Map(
                impact.moves
                    .filter((m) => m.clip.kind === "page")
                    .map((m) => [m.clip.kind === "page" ? m.clip.page : "", m]),
            );
            expect(byPage.get("2")?.change).toBe("stopsEarly");
            // Page 3's move runs on out of the cut: marchers can't jump, so it is squeezed
            expect(byPage.get("3")).toMatchObject({
                change: "squeezed",
                note: "cantSkip",
            });
            await roundTrip(db, before);
        });

        it("a whole page: the page and its move go, and later pages renumber", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const impact = await previewThenCommit(db, {
                kind: "removeCounts",
                start: 9,
                end: 17,
                crossing: "squeeze",
                inside: "keep",
            });
            expect(await timelineRanges(db)).toEqual([
                [1, 9],
                [9, 17],
                [17, 25],
                [25, 33],
                [33, 41],
            ]);
            expect(impact.pages).toEqual([
                { id: 2, nameBefore: "2", countsBefore: 8 },
            ]);
            expect(impact.renumbered).toEqual({ from: "3", to: "2" });
            expect(
                impact.moves.find((m) => m.change === "deleted"),
            ).toMatchObject({ clip: { kind: "page", page: "2" } });
        });

        it("a clip only in the cut refuses, naming it in pages and counts; deleting it with the counts works", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const track = await createTrack({
                db,
                target: { kind: "marcher", marcherId: 1 },
                startBeat: 11,
                endBeat: 13,
            });
            await timelineResolverSettled();
            const before = await snapshot(db);
            const edit: DrillEdit = {
                kind: "removeCounts",
                start: 10,
                end: 14,
                crossing: "squeeze",
                inside: "keep",
            };
            const refused = (await previewDrillEdit({ db, edit }))!;
            expect(refused.ok).toBe(false);
            const error = (refused as { error: unknown }).error;
            expect(error).toBeInstanceOf(TimelineWriteError);
            expect((error as TimelineWriteError).subject).toMatchObject({
                reason: "noCounts",
                clip: { kind: "marchers", total: 1 },
                span: {
                    startPage: "2",
                    startCount: 3,
                    endPage: "2",
                    endCount: 4,
                },
                timelineId: track.timelineId,
            });
            expect(await snapshot(db)).toEqual(before);

            const impact = await previewThenCommit(db, {
                ...edit,
                inside: "delete",
            });
            expect(
                impact.moves.find((m) => m.timelineId === track.timelineId),
            ).toMatchObject({ change: "deleted", note: "onlyInCut" });
            await roundTrip(db, before);
        });
    });

    describe("add counts", () => {
        it("at a flag, stretching: the page gets the counts and its move stretches to the flag", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const before = await snapshot(db);
            const impact = await previewThenCommit(db, {
                kind: "addCounts",
                at: 17,
                count: 4,
                recording: "has",
                crossing: "stretch",
            });
            expect(await timelineRanges(db)).toEqual([
                [1, 9],
                [9, 21],
                [21, 29],
                [29, 37],
                [37, 45],
                [45, 53],
            ]);
            expect(await pageRanges(db)).toEqual(await timelineRanges(db));
            expect(impact.pages).toEqual([
                {
                    id: 2,
                    nameBefore: "2",
                    nameAfter: "2",
                    countsBefore: 8,
                    countsAfter: 12,
                },
            ]);
            expect(impact.timing).toEqual([]);
            await roundTrip(db, before);
        });

        it("at a flag, holding: the move keeps its counts, marchers hold to the flag, no page renumbers", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const at17 = new Map(
                resolver()
                    .marcherIds()
                    .map((id) => [id, resolver().positionAt(id, 17)]),
            );
            const before = await snapshot(db);
            const impact = await previewThenCommit(db, {
                kind: "addCounts",
                at: 17,
                count: 4,
                recording: "has",
                crossing: "hold",
            });
            expect(await timelineRanges(db)).toEqual([
                [1, 9],
                [9, 17],
                [17, 21],
                [21, 29],
                [29, 37],
                [37, 45],
                [45, 53],
            ]);
            // Page 2 owns the hold: its box runs to the end of the new counts
            expect(await pageRanges(db)).toEqual([
                [1, 9],
                [9, 21],
                [21, 29],
                [29, 37],
                [37, 45],
                [45, 53],
            ]);
            for (const [id, [x, y]] of at17)
                for (const beat of [17, 19, 21]) {
                    const [nx, ny] = resolver().positionAt(id, beat);
                    expect(nx).toBeCloseTo(x, 9);
                    expect(ny).toBeCloseTo(y, 9);
                }
            expect(impact.renumbered).toBeNull();
            expect(impact.moves.filter((m) => m.change === "holds")).toEqual([
                expect.objectContaining({
                    after: {
                        startPage: "2",
                        startCount: 9,
                        endPage: "2",
                        endCount: 12,
                    },
                }),
            ]);
            await roundTrip(db, before);
        });

        it("in the same time: the page keeps its length in seconds and gets faster", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const impact = await previewThenCommit(db, {
                kind: "addCounts",
                at: 17,
                count: 4,
                recording: "sameTime",
                crossing: "stretch",
            });
            expect(impact.timing).toHaveLength(1);
            expect(impact.timing[0]!.page).toBe("2");
            expect(impact.timing[0]!.bpmBefore).toBeCloseTo(120, 6);
            expect(impact.timing[0]!.bpmAfter).toBeCloseTo(180, 6);
            const durations = (
                await db
                    .select({ d: schema.beats.duration })
                    .from(schema.beats)
                    .orderBy(asc(schema.beats.position))
                    .all()
            ).map((b) => b.d);
            const page2 = durations.slice(9, 21).reduce((s, d) => s + d, 0);
            expect(page2).toBeCloseTo(4, 9);
        });

        it("hold is refused partway through a page", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const preview = (await previewDrillEdit({
                db,
                edit: {
                    kind: "addCounts",
                    at: 13,
                    count: 2,
                    recording: "has",
                    crossing: "hold",
                },
            }))!;
            expect(preview.ok).toBe(false);
        });

        it("on the last page's flag, both ways, the last page grows", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            for (const crossing of ["stretch", "hold"] as const) {
                const preview = (await previewDrillEdit({
                    db,
                    edit: {
                        kind: "addCounts",
                        at: 49,
                        count: 4,
                        recording: "has",
                        crossing,
                    },
                }))!;
                if (!preview.ok) throw preview.error;
                expect(preview.impact.pages).toEqual([
                    {
                        id: 6,
                        nameBefore: "6",
                        nameAfter: "6",
                        countsBefore: 8,
                        countsAfter: 12,
                    },
                ]);
            }
        });
    });

    describe("move a page flag", () => {
        it("carries the moves that land on it: page 2 two counts longer, page 3 two shorter", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const before = await snapshot(db);
            const impact = await previewThenCommit(db, {
                kind: "moveFlag",
                pageId: 2,
                to: 19,
            });
            expect(await timelineRanges(db)).toEqual([
                [1, 9],
                [9, 19],
                [19, 25],
                [25, 33],
                [33, 41],
                [41, 49],
            ]);
            expect(await pageRanges(db)).toEqual(await timelineRanges(db));
            expect(impact.countsAfter).toBe(impact.countsBefore);
            expect(
                impact.pages.map((p) => [
                    p.nameBefore,
                    p.countsBefore,
                    p.countsAfter,
                ]),
            ).toEqual([
                ["2", 8, 10],
                ["3", 8, 6],
            ]);
            await roundTrip(db, before);
        });

        it("the last flag changes the last page's counts", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            await previewThenCommit(db, {
                kind: "moveFlag",
                pageId: 6,
                to: 45,
            });
            expect((await timelineRanges(db)).at(-1)).toEqual([41, 45]);
            expect((await pageRanges(db)).at(-1)).toEqual([41, 45]);
        });

        it("refuses to pass the next flag", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const preview = (await previewDrillEdit({
                db,
                edit: { kind: "moveFlag", pageId: 2, to: 25 },
            }))!;
            expect(preview.ok).toBe(false);
            expect(await timelineRanges(db)).toEqual(ORIGINAL);
        });
    });

    describe("a last flag past the show's last count", () => {
        it("stays where it is when the page before it is moved", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const beats = (await db.select().from(schema.beats).all()).length;
            // Page 6 starts on beat 41; its flag goes past the end of the counts
            const lastPageCounts = beats - 41 + 4;
            await db
                .update(schema.utility)
                .set({ last_page_counts: lastPageCounts });
            await previewThenCommit(db, {
                kind: "moveFlag",
                pageId: 5,
                to: 35,
            });
            const utility = await db.select().from(schema.utility).get();
            expect(35 + utility!.last_page_counts).toBe(41 + lastPageCounts);
        });

        it("keeps its distance past the end when counts are removed before it", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const beats = (await db.select().from(schema.beats).all()).length;
            const lastPageCounts = beats - 41 + 4;
            await db
                .update(schema.utility)
                .set({ last_page_counts: lastPageCounts });
            await previewThenCommit(db, {
                kind: "removeCounts",
                start: 11,
                end: 13,
                crossing: "squeeze",
                inside: "keep",
            });
            const utility = await db.select().from(schema.utility).get();
            expect(utility!.last_page_counts).toBe(lastPageCounts);
        });
    });

    describe("previews", () => {
        it("run one at a time, a newer one on a channel replaces a waiting one, and each rollback is announced", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const windows: { start: number; end: number }[] = [];
            const stop = onDrillPreviewRolledBack((w) => windows.push(w));
            const edit = (to: number): DrillEdit => ({
                kind: "moveFlag",
                pageId: 2,
                to,
            });
            const [first, replaced, newest] = await Promise.all([
                previewDrillEdit({ db, edit: edit(18), channel: "a" }),
                previewDrillEdit({ db, edit: edit(19), channel: "b" }),
                previewDrillEdit({ db, edit: edit(20), channel: "b" }),
            ]);
            stop();
            expect(first?.ok).toBe(true);
            expect(replaced).toBeNull();
            expect(newest?.ok).toBe(true);
            expect(windows).toHaveLength(2);
            expect(windows[0]!.end).toBeLessThanOrEqual(windows[1]!.start);
            expect(await timelineRanges(db)).toEqual(ORIGINAL);
        });
    });
});

describe("withLastFlag", () => {
    it("runs the last page to start + last_page_counts past the show's end", () => {
        const grid = {
            beatIds: [0, 1, 2, 3, 4],
            pages: [
                { id: 0, start: 0, end: 1 },
                { id: 1, start: 1, end: 5 },
            ],
        };
        expect(withLastFlag(grid, 8).pages[1]!.end).toBe(9);
        expect(withLastFlag(grid, 2).pages[1]!.end).toBe(5);
    });
});

describe("insertedMeasureStarts", () => {
    // Measures of 4 at beats 1, 5, 9; the show has 13 beats (beat 0 and 12 counts)
    const measureStarts = [1, 5, 9];
    it("at a downbeat, adds whole measures of the measure before's length", () => {
        expect(
            insertedMeasureStarts({
                measureStarts,
                beatCount: 13,
                at: 9,
                count: 16,
            }),
        ).toEqual([0, 4, 8, 12]);
    });
    it("after the last count, continues the meter", () => {
        expect(
            insertedMeasureStarts({
                measureStarts,
                beatCount: 13,
                at: 13,
                count: 4,
            }),
        ).toEqual([0]);
        // A last measure of 2 counts is finished first
        expect(
            insertedMeasureStarts({
                measureStarts,
                beatCount: 11,
                at: 11,
                count: 6,
            }),
        ).toEqual([2]);
    });
    it("partway through a measure, adds no line", () => {
        expect(
            insertedMeasureStarts({
                measureStarts,
                beatCount: 13,
                at: 7,
                count: 4,
            }),
        ).toEqual([]);
    });
    it("in a show without measures, adds none", () => {
        expect(
            insertedMeasureStarts({
                measureStarts: [],
                beatCount: 13,
                at: 13,
                count: 4,
            }),
        ).toEqual([]);
    });
});

describe("stepsPerFiveYards", () => {
    it("is 8 for 8 to 5", () => {
        // 5 yards = 180 inches = 90 field pixels; 8 counts
        expect(stepsPerFiveYards(90, 8)).toBeCloseTo(8, 9);
        expect(stepsPerFiveYards(0, 8)).toBe(Infinity);
    });
});

/**
 * Fix pass (FE-2, FE-3, FE-6): a cut keeps or names the rehearsal marks it takes, says how
 * measures renumber, asks whether the recording lost the counts, and holds get a name. Measures
 * are 4 counts from ordinal 1 (m1 at 1, m2 at 5, …, m24 at 93), numbered from 1.
 */
describeDbTests("count edits: marks, measures and the recording", (it) => {
    const mark = async (db: DbConnection, startBeat: number, name: string) =>
        await db
            .update(schema.measures)
            .set({ rehearsal_mark: name })
            .where(sql`${schema.measures.start_beat} = ${startBeat}`);
    const marks = async (db: DbConnection) =>
        (
            await db
                .select()
                .from(schema.measures)
                .orderBy(asc(schema.measures.start_beat))
                .all()
        ).flatMap((m, i) =>
            m.rehearsal_mark ? [[m.rehearsal_mark, i + 1] as const] : [],
        );
    const durations = async (db: DbConnection) =>
        (
            await db
                .select({ d: schema.beats.duration })
                .from(schema.beats)
                .orderBy(asc(schema.beats.position))
                .all()
        ).map((b) => b.d);
    const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

    it("moves the cut's first mark to the measure after it, and reports renumbering", async ({
        db,
        marchersAndPages: _,
    }) => {
        await setUp(db);
        await mark(db, 9, "F");
        await mark(db, 21, "G");
        const before = await snapshot(db);
        // m3–m4
        const impact = await previewThenCommit(db, {
            kind: "removeCounts",
            start: 9,
            end: 17,
            crossing: "squeeze",
            inside: "delete",
        });
        expect(await marks(db)).toEqual([
            ["F", 3],
            ["G", 4],
        ]);
        expect(impact.measures).toEqual({
            removed: { from: 3, to: 4 },
            added: null,
            renumbered: {
                before: { from: 5, to: 24 },
                after: { from: 3, to: 22 },
            },
        });
        expect(impact.marks).toEqual([
            { mark: "F", before: 3, after: 3, change: "moved" },
            { mark: "G", before: 6, after: 4, change: "renumbered" },
        ]);
        await roundTrip(db, before);
    });

    it("drops the cut's marks when asked, and says so", async ({
        db,
        marchersAndPages: _,
    }) => {
        await setUp(db);
        await mark(db, 9, "F");
        const impact = await previewThenCommit(db, {
            kind: "removeCounts",
            start: 9,
            end: 17,
            crossing: "squeeze",
            inside: "delete",
            marks: "drop",
        });
        expect(await marks(db)).toEqual([]);
        expect(impact.marks).toEqual([
            { mark: "F", before: 3, change: "removed" },
        ]);
    });

    it("doesn't move a mark onto a measure that has its own", async ({
        db,
        marchersAndPages: _,
    }) => {
        await setUp(db);
        await mark(db, 9, "F");
        await mark(db, 17, "G");
        const impact = await previewThenCommit(db, {
            kind: "removeCounts",
            start: 9,
            end: 17,
            crossing: "squeeze",
            inside: "delete",
        });
        expect(await marks(db)).toEqual([["G", 3]]);
        expect(impact.marks?.[0]).toEqual({
            mark: "F",
            before: 3,
            change: "removed",
        });
    });

    it("with the recording unchanged, the counts after the cut take its time, to their page's end", async ({
        db,
        marchersAndPages: _,
    }) => {
        await setUp(db);
        const show = await durations(db);
        const before = await snapshot(db);
        // Two counts out of page 2 ([9, 17)): its six left take its four seconds
        const impact = await previewThenCommit(db, {
            kind: "removeCounts",
            start: 11,
            end: 13,
            crossing: "squeeze",
            inside: "delete",
            recording: "kept",
        });
        const after = await durations(db);
        expect(after.length).toBe(show.length - 2);
        expect(sum(after)).toBeCloseTo(sum(show), 9);
        // Counts before the cut, and from page 3 on, keep their times
        expect(after.slice(0, 11)).toEqual(show.slice(0, 11));
        expect(after.slice(15)).toEqual(show.slice(17));
        for (const d of after.slice(11, 15)) expect(d).toBeCloseTo(0.75, 9);
        expect(impact.timing).toEqual([
            expect.objectContaining({ bpmBefore: 120, bpmAfter: 90 }),
        ]);
        await roundTrip(db, before);
    });

    it("names the clips a vamp makes after their page: its move and its hold (DN-4)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await setUp(db);
        const known = new Set(
            (await db.select().from(schema.timelines).all()).map((l) => l.id),
        );
        const impact = await previewThenCommit(db, {
            kind: "addCounts",
            at: 17,
            count: 4,
            recording: "has",
            crossing: "hold",
        });
        const holds = impact.moves.filter((m) => m.change === "holds");
        expect(holds.length).toBeGreaterThan(0);
        const names = (await db.select().from(schema.timelines).all())
            .filter((l) => holds.some((h) => h.timelineId === l.id))
            .map((l) => l.name);
        expect(new Set(names)).toEqual(new Set(["Pg 2 hold"]));
        // Every clip the vamp made is named after the page, none "Timeline N"
        const made = (await db.select().from(schema.timelines).all()).filter(
            (l) => !known.has(l.id),
        );
        for (const l of made)
            expect(["Pg 2 move", "Pg 2 hold"]).toContain(l.name);
        expect(impact.measures?.added).toEqual({ from: 5, to: 5 });
    });
});
