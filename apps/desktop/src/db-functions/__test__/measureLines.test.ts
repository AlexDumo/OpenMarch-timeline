import { describe, expect } from "vitest";
import { asc } from "drizzle-orm";
import { timelineHistoryTables } from "@/test/timelineMode";
import { describeDbTests, schema } from "@/test/base";
import { getTestWithHistory } from "@/test/history";
import type { DbConnection } from "@/db-functions";
import { editMeasureLines } from "../measureLines";

/**
 * The measure row's edits (tempo E8) on the `marchersAndPages` show: 96 timed beats after the
 * zero-length beat 0, 24 measures of 4 beats (m1 at beat 1, m2 at beat 5, …) and pages. Each edit
 * is one undo entry and leaves beats and pages exactly as they were.
 */
describeDbTests("measureLines", (it) => {
    const testWithHistory = getTestWithHistory(it, [
        schema.measures,
        schema.beats,
        schema.pages,
        ...timelineHistoryTables(),
    ]);

    /** Measure lines as [beat id, mark] in show order */
    const lines = async (db: DbConnection) => {
        const rows = await db
            .select({
                beat: schema.measures.start_beat,
                mark: schema.measures.rehearsal_mark,
            })
            .from(schema.measures)
            .orderBy(asc(schema.measures.start_beat))
            .all();
        return rows.map((row) => [row.beat, row.mark] as const);
    };
    const beatsAndPages = async (db: DbConnection) => ({
        beats: await db.select().from(schema.beats).all(),
        pages: await db.select().from(schema.pages).all(),
    });
    const measureIdAt = async (db: DbConnection, beat: number) => {
        const row = (await db.select().from(schema.measures).all()).find(
            (m) => m.start_beat === beat,
        );
        if (!row) throw new Error(`no measure at ${beat}`);
        return row.id;
    };

    describe("rehearsal marks", () => {
        testWithHistory(
            "names, renames and removes a mark, one undo each",
            async ({ db, marchersAndPages: _, expectNumberOfChanges }) => {
                const state = await expectNumberOfChanges.getDatabaseState(db);
                const before = await beatsAndPages(db);
                const m19 = await measureIdAt(db, 73);
                await editMeasureLines({
                    db,
                    edit: { kind: "mark", measureId: m19, mark: "C" },
                });
                expect((await lines(db))[18]).toEqual([73, "C"]);
                await editMeasureLines({
                    db,
                    edit: { kind: "mark", measureId: m19, mark: " D " },
                });
                expect((await lines(db))[18]).toEqual([73, "D"]);
                // Renaming to the same name is no edit
                await editMeasureLines({
                    db,
                    edit: { kind: "mark", measureId: m19, mark: "D" },
                });
                await editMeasureLines({
                    db,
                    edit: { kind: "mark", measureId: m19, mark: "" },
                });
                expect((await lines(db))[18]).toEqual([73, null]);
                expect(await beatsAndPages(db)).toEqual(before);
                await expectNumberOfChanges.test(db, 3, state);
            },
        );

        testWithHistory(
            "Move C here over a measure's own mark replaces it, as one undo entry (DN-3)",
            async ({ db, marchersAndPages: _, expectNumberOfChanges }) => {
                const m19 = await measureIdAt(db, 73);
                const m20 = await measureIdAt(db, 77);
                await editMeasureLines({
                    db,
                    edit: { kind: "mark", measureId: m19, mark: "G" },
                });
                await editMeasureLines({
                    db,
                    edit: { kind: "mark", measureId: m20, mark: "H" },
                });
                const state = await expectNumberOfChanges.getDatabaseState(db);
                await editMeasureLines({
                    db,
                    edit: {
                        kind: "moveMark",
                        fromMeasureId: m19,
                        toMeasureId: m20,
                        replace: true,
                    },
                });
                expect((await lines(db))[18]).toEqual([73, null]);
                expect((await lines(db))[19]).toEqual([77, "G"]);
                await expectNumberOfChanges.test(db, 1, state);
            },
        );

        testWithHistory(
            "moves a mark to another measure as one undo entry",
            async ({ db, marchersAndPages: _, expectNumberOfChanges }) => {
                const before = await beatsAndPages(db);
                const m19 = await measureIdAt(db, 73);
                const m20 = await measureIdAt(db, 77);
                await editMeasureLines({
                    db,
                    edit: { kind: "mark", measureId: m19, mark: "G" },
                });
                const state = await expectNumberOfChanges.getDatabaseState(db);
                await editMeasureLines({
                    db,
                    edit: {
                        kind: "moveMark",
                        fromMeasureId: m19,
                        toMeasureId: m20,
                    },
                });
                expect((await lines(db))[18]).toEqual([73, null]);
                expect((await lines(db))[19]).toEqual([77, "G"]);
                expect(await beatsAndPages(db)).toEqual(before);
                await expectNumberOfChanges.test(db, 1, state);
            },
        );

        testWithHistory(
            "marks a count without a measure by starting one there",
            async ({ db, marchersAndPages: _, expectNumberOfChanges }) => {
                const state = await expectNumberOfChanges.getDatabaseState(db);
                const result = await editMeasureLines({
                    db,
                    edit: { kind: "start", beat: 75, mark: "C" },
                });
                expect(result.createdIds).toHaveLength(1);
                const all = await lines(db);
                expect(all).toHaveLength(25);
                expect(all[19]).toEqual([75, "C"]);
                await expectNumberOfChanges.test(db, 1, state);
            },
        );
    });

    describe("measure lines", () => {
        testWithHistory(
            "starts and removes a measure line without touching beats or pages",
            async ({ db, marchersAndPages: _, expectNumberOfChanges }) => {
                const state = await expectNumberOfChanges.getDatabaseState(db);
                const before = await beatsAndPages(db);
                await editMeasureLines({
                    db,
                    edit: { kind: "start", beat: 7 },
                });
                expect((await lines(db)).slice(0, 4)).toEqual([
                    [1, null],
                    [5, null],
                    [7, null],
                    [9, null],
                ]);
                await editMeasureLines({
                    db,
                    edit: {
                        kind: "remove",
                        measureId: await measureIdAt(db, 9),
                    },
                });
                expect((await lines(db)).slice(0, 4)).toEqual([
                    [1, null],
                    [5, null],
                    [7, null],
                    [13, null],
                ]);
                expect(await beatsAndPages(db)).toEqual(before);
                await expectNumberOfChanges.test(db, 2, state);
            },
        );

        testWithHistory(
            "won't remove measure 1",
            async ({ db, marchersAndPages: _ }) => {
                await expect(
                    editMeasureLines({
                        db,
                        edit: {
                            kind: "remove",
                            measureId: await measureIdAt(db, 1),
                        },
                    }),
                ).rejects.toThrow();
                expect(await lines(db)).toHaveLength(24);
            },
        );

        testWithHistory(
            "m3 in 3 with later measures keeping their beats re-bars the rest, marks following",
            async ({ db, marchersAndPages: _, expectNumberOfChanges }) => {
                const state = await expectNumberOfChanges.getDatabaseState(db);
                const before = await beatsAndPages(db);
                // D at m6 (beat 21) before the edit
                await editMeasureLines({
                    db,
                    edit: {
                        kind: "mark",
                        measureId: await measureIdAt(db, 21),
                        mark: "D",
                    },
                });
                await editMeasureLines({
                    db,
                    edit: {
                        kind: "setBeats",
                        measureId: await measureIdAt(db, 9),
                        beats: 3,
                        laterKeep: true,
                    },
                });
                const after = await lines(db);
                expect(after.slice(0, 7)).toEqual([
                    [1, null],
                    [5, null],
                    [9, null],
                    [12, null],
                    [16, null],
                    [20, "D"],
                    [24, null],
                ]);
                // The last measure (m24 at 93) moved to 92 and runs to the end
                expect(after).toHaveLength(24);
                expect(after[23]).toEqual([92, null]);
                expect(await beatsAndPages(db)).toEqual(before);
                await expectNumberOfChanges.test(db, 2, state);
            },
        );

        testWithHistory(
            "m3 in 3 with the next measure absorbing the difference moves one line",
            async ({ db, marchersAndPages: _, expectNumberOfChanges }) => {
                const state = await expectNumberOfChanges.getDatabaseState(db);
                await editMeasureLines({
                    db,
                    edit: {
                        kind: "setBeats",
                        measureId: await measureIdAt(db, 9),
                        beats: 3,
                        laterKeep: false,
                    },
                });
                expect((await lines(db)).slice(2, 5)).toEqual([
                    [9, null],
                    [12, null],
                    [17, null],
                ]);
                await expectNumberOfChanges.test(db, 1, state);
            },
        );

        testWithHistory(
            "beats per measure from here, up to the next rehearsal mark",
            async ({ db, marchersAndPages: _, expectNumberOfChanges }) => {
                const state = await expectNumberOfChanges.getDatabaseState(db);
                const before = await beatsAndPages(db);
                await editMeasureLines({
                    db,
                    edit: {
                        kind: "mark",
                        measureId: await measureIdAt(db, 25),
                        mark: "B",
                    },
                });
                await editMeasureLines({
                    db,
                    edit: {
                        kind: "beatsFrom",
                        measureId: await measureIdAt(db, 5),
                        beats: 3,
                        until: "mark",
                    },
                });
                const after = await lines(db);
                expect(after.map(([beat]) => beat).slice(0, 10)).toEqual([
                    1, 5, 8, 11, 14, 17, 20, 23, 25, 29,
                ]);
                expect(after[8]).toEqual([25, "B"]);
                expect(await beatsAndPages(db)).toEqual(before);
                await expectNumberOfChanges.test(db, 2, state);
            },
        );
    });
});
