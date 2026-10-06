import { afterEach, describe, expect } from "vitest";
import { countDistinct, getTableName, sql } from "drizzle-orm";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { getTestWithHistory } from "@/test/history";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/timeline/convert/writePageConversion";
import {
    startTimelineResolver,
    stopTimelineResolver,
} from "@/timeline/timelineStore";
import { moveCount } from "@/timeline/tempo";
import { performRedo, performUndo } from "../history";
import {
    durationsByBeatId,
    readCountDurationsInTransaction,
    readTempoSyncedBeatIds,
    retimeBeats,
    setTempoSyncedBeatIds,
    TempoWriteError,
} from "../tempo";
import {
    getWorkspaceSettingsParsed,
    updateWorkspaceSettingsParsed,
} from "../workspaceSettings";

// These tests set the flag and convert the show themselves
keepFixturesInPageMode(
    "its tests convert the show and set the flag themselves",
);

/**
 * The tempo write path on a converted `marchersAndPages` show (beat 0 plus 96 beats, pages every
 * 8 counts from count 1; beat ids equal their ordinals).
 */

afterEach(() => stopTimelineResolver());

const TABLES = [
    schema.beats,
    schema.pages,
    schema.measures,
    schema.utility,
    schema.workspace_settings,
    schema.timelines,
    schema.timeline_transitions,
    schema.timeline_assignments,
];

const snapshot = async (db: DbConnection) => {
    const out: Record<string, unknown[]> = {};
    for (const table of TABLES)
        out[getTableName(table)] = await db.select().from(table).all();
    // `updated_at` is set by the write; compare the settings by content
    out.workspace_settings = (
        out.workspace_settings as { json_data: string }[]
    ).map((r) => JSON.parse(r.json_data));
    return out;
};

const setUp = async (db: DbConnection) => {
    await db.delete(schema.workspace_settings);
    await db.insert(schema.workspace_settings).values({
        id: 1,
        json_data: JSON.stringify({
            timelineMode: true,
            audioOffsetSeconds: 0.25,
        }),
    });
    await convertPagesToTimeline(db);
    await startTimelineResolver(db);
};

/** The number of undo entries. */
const undoEntries = async (db: DbConnection) =>
    (
        await db
            .select({ n: countDistinct(schema.history_undo.history_group) })
            .from(schema.history_undo)
            .get()
    )?.n ?? 0;

const counts = (db: DbConnection) =>
    db.transaction((tx) => readCountDurationsInTransaction(tx));

/** No history triggers are left on `workspace_settings` (it has scoped history). */
const settingsTriggers = async (db: DbConnection) =>
    await db.all(
        sql`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'workspace_settings' AND (name LIKE '%_ut' OR name LIKE '%_it' OR name LIKE '%_dt')`,
    );

const roundTrip = async (
    db: DbConnection,
    before: Record<string, unknown[]>,
    after: Record<string, unknown[]>,
) => {
    for (let i = 0; i < 2; i++) {
        const undo = await performUndo(db);
        expect(undo.success, undo.error?.message).toBe(true);
        expect(await snapshot(db)).toEqual(before);
        expect(await settingsTriggers(db)).toEqual([]);
        const redo = await performRedo(db);
        expect(redo.success, redo.error?.message).toBe(true);
        expect(await snapshot(db)).toEqual(after);
        expect(await settingsTriggers(db)).toEqual([]);
    }
};

describeDbTests("tempo write path", (it) => {
    const testWithHistory = getTestWithHistory(it, TABLES);

    describe("retimeBeats", () => {
        it("changes durations only, as one undo entry", async ({
            db,
            marchersAndPages,
        }) => {
            expect(marchersAndPages.expectedBeats.length).toBeGreaterThan(20);
            await setUp(db);
            const before = await snapshot(db);
            const undoBefore = await undoEntries(db);
            const show = await counts(db);
            // Line count 9 (page 2's start) up 0.4 s late: scale left, move right
            const r = moveCount({
                durations: show.durations,
                index: 9,
                toTime:
                    show.durations.slice(0, 9).reduce((a, b) => a + b) + 0.4,
            });
            const changed = await retimeBeats({
                db,
                newDurationsByBeatId: durationsByBeatId(
                    show.beatIds,
                    r.durations,
                ),
            });
            expect(changed).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
            expect(await undoEntries(db)).toBe(undoBefore + 1);
            const after = await snapshot(db);
            // Pages, measures and drill rows are untouched
            for (const t of [
                "pages",
                "measures",
                "timelines",
                "timeline_transitions",
                "timeline_assignments",
            ])
                expect(after[t]).toEqual(before[t]);
            expect((await counts(db)).durations).toEqual(r.durations);
            await roundTrip(db, before, after);
        });

        it("moves the audio offset when count 1 moves, in the same undo entry", async ({
            db,
            marchersAndPages,
        }) => {
            void marchersAndPages;
            await setUp(db);
            const before = await snapshot(db);
            const show = await counts(db);
            const r = moveCount({
                durations: show.durations,
                index: 1,
                toTime: 1.5,
                synced: [17],
            });
            await retimeBeats({
                db,
                newDurationsByBeatId: durationsByBeatId(
                    show.beatIds,
                    r.durations,
                ),
                originShift: r.originShift,
                syncedBeatIds: [17, 1],
            });
            const settings = await getWorkspaceSettingsParsed({ db });
            expect(settings.audioOffsetSeconds).toBeCloseTo(0.25 - 1.5, 12);
            expect(settings.tempoSyncedBeatIds).toEqual([1, 17]);
            expect(settings.timelineMode).toBe(true);
            await roundTrip(db, before, await snapshot(db));
        });

        it("keeps settings writes outside history after an undo", async ({
            db,
            marchersAndPages,
        }) => {
            void marchersAndPages;
            await setUp(db);
            await retimeBeats({
                db,
                newDurationsByBeatId: new Map(),
                originShift: 1,
            });
            expect((await performUndo(db)).success).toBe(true);
            const undoLength = await undoEntries(db);
            const settings = await getWorkspaceSettingsParsed({ db });
            await updateWorkspaceSettingsParsed({
                db,
                settings: { ...settings, projectName: "Fall show" },
            });
            expect(await undoEntries(db)).toBe(undoLength);
            expect(await settingsTriggers(db)).toEqual([]);
        });

        it("refuses bad input and writes nothing", async ({
            db,
            marchersAndPages,
        }) => {
            void marchersAndPages;
            await setUp(db);
            const before = await snapshot(db);
            const cases: [Map<number, number>, TempoWriteError["code"]][] = [
                [new Map([[3, -1]]), "bad-duration"],
                [new Map([[3, NaN]]), "bad-duration"],
                [new Map([[99999, 0.5]]), "unknown-beat"],
                [new Map([[0, 0.5]]), "first-beat"],
            ];
            for (const [newDurationsByBeatId, code] of cases) {
                const error = await retimeBeats({
                    db,
                    newDurationsByBeatId,
                }).catch((e: unknown) => e);
                expect(error).toBeInstanceOf(TempoWriteError);
                expect((error as TempoWriteError).code).toBe(code);
            }
            expect(await snapshot(db)).toEqual(before);
        });

        it("adds no undo entry for a retime that changes nothing", async ({
            db,
            marchersAndPages,
        }) => {
            void marchersAndPages;
            await setUp(db);
            const length = await undoEntries(db);
            const show = await counts(db);
            expect(
                await retimeBeats({
                    db,
                    newDurationsByBeatId: durationsByBeatId(
                        show.beatIds,
                        show.durations,
                    ),
                    syncedBeatIds: [],
                }),
            ).toEqual([]);
            expect(await undoEntries(db)).toBe(length);
        });

        it("refuses durations computed for a different show", () => {
            expect(() => durationsByBeatId([0, 1, 2], [0, 0.5])).toThrow(
                TempoWriteError,
            );
        });
    });

    describe("synced counts", () => {
        it("stores, reads and undoes synced beat ids", async ({
            db,
            marchersAndPages,
        }) => {
            void marchersAndPages;
            await setUp(db);
            expect(await readTempoSyncedBeatIds(db)).toEqual([]);
            const before = await snapshot(db);
            await setTempoSyncedBeatIds({
                db,
                syncedBeatIds: [33, 9, 9, 123456],
            });
            expect(await readTempoSyncedBeatIds(db)).toEqual([9, 33]);
            await roundTrip(db, before, await snapshot(db));
        });
    });

    describe("tempo map", () => {
        it("writes a typed row's durations, synced counts and mark as one undo entry", async ({
            db,
            marchersAndPages,
        }) => {
            void marchersAndPages;
            await setUp(db);
            const before = await snapshot(db);
            const undoBefore = await undoEntries(db);
            const show = await counts(db);
            // ♩=152.5 from count 9 to count 17, as the tempo map writes it
            const durations = show.durations.map((d, i) =>
                i >= 9 && i < 17 ? 60 / 152.5 : d,
            );
            await retimeBeats({
                db,
                newDurationsByBeatId: durationsByBeatId(
                    show.beatIds,
                    durations,
                ),
                syncedBeatIds: [9, 17],
                tempoMapMarks: [
                    {
                        beatId: 9,
                        meter: { top: 12, bottom: 8, groups: [3, 3, 3, 3] },
                        unit: "dq",
                    },
                    { beatId: 123456 },
                ],
            });
            expect(await undoEntries(db)).toBe(undoBefore + 1);
            const settings = await getWorkspaceSettingsParsed({ db });
            expect(settings.tempoMapMarks).toEqual([
                {
                    beatId: 9,
                    meter: { top: 12, bottom: 8, groups: [3, 3, 3, 3] },
                    unit: "dq",
                },
            ]);
            expect(await readTempoSyncedBeatIds(db)).toEqual([9, 17]);
            expect((await counts(db)).durations[9]).toBe(60 / 152.5);
            await roundTrip(db, before, await snapshot(db));
        });
    });

    testWithHistory(
        "retime with offset and synced counts is one change",
        async ({ db, marchersAndPages, expectNumberOfChanges }) => {
            void marchersAndPages;
            const state = await expectNumberOfChanges.getDatabaseState(db);
            const show = await counts(db);
            const r = moveCount({
                durations: show.durations,
                index: 1,
                toTime: 0.5,
                synced: [9],
            });
            await retimeBeats({
                db,
                newDurationsByBeatId: durationsByBeatId(
                    show.beatIds,
                    r.durations,
                ),
                originShift: r.originShift,
                syncedBeatIds: [9],
            });
            await expectNumberOfChanges.test(db, 1, state);
        },
    );
});
