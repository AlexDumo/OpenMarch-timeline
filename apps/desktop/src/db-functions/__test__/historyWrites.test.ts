import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect } from "vitest";
import { parseMusicXmlWithReport } from "@openmarch/musicxml-parser";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import {
    convertPagesToTimeline,
    readShowTiming,
} from "@/timeline/convert/writePageConversion";
import {
    startTimelineResolver,
    stopTimelineResolver,
} from "@/timeline/timelineStore";
import { scoreMeasuresOf } from "@/timeline/tempo";
import type Measure from "@/global/classes/Measure";
import { _importMusicXmlFile } from "@/components/music/MusicXmlImport";
import { getUndoStackLength, subscribeHistoryWrites } from "../history";
import {
    durationsByBeatId,
    readCountDurationsInTransaction,
    retimeBeats,
} from "../tempo";
import { applyTapTheBeat } from "../tapTheBeat";
import { editMeasureLines } from "../measureLines";
import { appendPageOfCounts, extendCountsTo } from "../showLength";
import { applyMusicXmlReimport } from "../musicXmlReimport";
import { commitDrillEdit } from "../drillEdits";

/**
 * Undo must turn on after every tempo write, whoever calls it (Priya's blocker: a count edit made
 * outside a TanStack mutation left Undo greyed out). Every write path goes through
 * `transactionWithHistory`, which tells `subscribeHistoryWrites` listeners after it commits; the
 * app refreshes its Undo state from there (`refreshHistoryOnWrites`). Each test makes one write
 * and checks the listener heard it and the undo stack grew.
 */
keepFixturesInPageMode(
    "its tests convert the show and set the flag themselves",
);

afterEach(() => stopTimelineResolver());

const setUp = async (db: DbConnection) => {
    await db.delete(schema.workspace_settings);
    await db.insert(schema.workspace_settings).values({
        id: 1,
        json_data: JSON.stringify({ timelineMode: true, measurementOffset: 1 }),
    });
    await convertPagesToTimeline(db);
    await startTimelineResolver(db);
};

/** Runs `write` and checks Undo would turn on: one history write heard, a longer undo stack */
const expectUndoAfter = async (
    db: DbConnection,
    write: () => Promise<unknown>,
) => {
    const before = await getUndoStackLength(db);
    let heard = 0;
    const stop = subscribeHistoryWrites(() => heard++);
    try {
        await write();
    } finally {
        stop();
    }
    expect(heard, "history writes heard").toBe(1);
    expect(await getUndoStackLength(db)).toBeGreaterThan(before);
};

const kitFile = (name: string) =>
    readFileSync(
        path.resolve(__dirname, "../../../tempo-kit/fixtures", name),
        "utf8",
    );
const report = (version: "v1" | "v2") =>
    parseMusicXmlWithReport(kitFile(`score-${version}-musescore.musicxml`));

const importV1 = async (db: DbConnection) => {
    const { beats, pages } = await readShowTiming(db);
    const measures = await db.select().from(schema.measures).all();
    return await _importMusicXmlFile({
        data: {
            fileName: "score-v1.musicxml",
            report: report("v1"),
            allPages: [...pages],
            measures: measures.map((m) => ({ id: m.id }) as Measure),
            allBeats: [...beats],
        },
    });
};

const slowerDurations = async (db: DbConnection) => {
    const show = await db.transaction((tx) =>
        readCountDurationsInTransaction(tx),
    );
    return durationsByBeatId(
        show.beatIds,
        show.durations.map((d, i) => (i === 0 ? d : d * 1.1)),
    );
};

describeDbTests("Undo turns on after every tempo write", (it) => {
    describe("timing", () => {
        it("retimeBeats (Align drags, tempo map, punch-in tap)", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const newDurationsByBeatId = await slowerDurations(db);
            await expectUndoAfter(db, () =>
                retimeBeats({ db, newDurationsByBeatId }),
            );
        });

        it("tap the beat apply", async ({ db, marchersAndPages: _ }) => {
            await setUp(db);
            const newDurationsByBeatId = await slowerDurations(db);
            await expectUndoAfter(db, () =>
                applyTapTheBeat({ db, newDurationsByBeatId, originShift: 0 }),
            );
        });
    });

    describe("labels", () => {
        it("measure row edits", async ({ db, marchersAndPages: _ }) => {
            await setUp(db);
            const measure = (await db.select().from(schema.measures).all())[3]!;
            await expectUndoAfter(db, () =>
                editMeasureLines({
                    db,
                    edit: { kind: "mark", measureId: measure.id, mark: "C" },
                }),
            );
        });
    });

    describe("show length", () => {
        it("+ N counts", async ({ db, marchersAndPages: _ }) => {
            await setUp(db);
            await expectUndoAfter(db, () =>
                appendPageOfCounts({ db, counts: 8 }),
            );
        });

        it("extend counts to the end", async ({ db, marchersAndPages: _ }) => {
            await setUp(db);
            await expectUndoAfter(db, () =>
                extendCountsTo({ db, untilSeconds: 60 }),
            );
        });
    });

    describe("MusicXML", () => {
        it("import", async ({ db, marchersAndPages: _ }) => {
            await setUp(db);
            await expectUndoAfter(db, async () => {
                const result = await importV1(db);
                expect(result.success).toBe(true);
            });
        });

        it("re-import in place", async ({ db, marchersAndPages: _ }) => {
            await setUp(db);
            expect((await importV1(db)).success).toBe(true);
            await expectUndoAfter(db, async () => {
                const result = await applyMusicXmlReimport({
                    db,
                    score: scoreMeasuresOf(report("v2").measures),
                    timing: "score",
                });
                expect(result.changed).toBe(true);
            });
        });
    });

    describe("drill edits (count edits with drill choices)", () => {
        it("remove counts", async ({ db, marchersAndPages: _ }) => {
            await setUp(db);
            await expectUndoAfter(db, () =>
                commitDrillEdit({
                    db,
                    edit: {
                        kind: "removeCounts",
                        start: 11,
                        end: 13,
                        crossing: "squeeze",
                        inside: "delete",
                    },
                }),
            );
        });

        it("add counts", async ({ db, marchersAndPages: _ }) => {
            await setUp(db);
            await expectUndoAfter(db, () =>
                commitDrillEdit({
                    db,
                    edit: {
                        kind: "addCounts",
                        at: 17,
                        count: 4,
                        recording: "has",
                        crossing: "hold",
                    },
                }),
            );
        });

        it("a page flag grip drag", async ({ db, marchersAndPages: _ }) => {
            await setUp(db);
            const page = (await db.select().from(schema.pages).all()).find(
                (p) => p.id !== 0,
            )!;
            await expectUndoAfter(db, () =>
                commitDrillEdit({
                    db,
                    edit: { kind: "moveFlag", pageId: page.id, to: 11 },
                }),
            );
        });
    });
});
