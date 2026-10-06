import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect } from "vitest";
import { asc, countDistinct, eq, getTableName } from "drizzle-orm";
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
import { countTimes, scoreMeasuresOf } from "@/timeline/tempo";
import type Measure from "@/global/classes/Measure";
import { _importMusicXmlFile } from "@/components/music/MusicXmlImport";
import { performUndo } from "../history";
import { createTrack } from "../timelineCommands";
import {
    applyMusicXmlReimport,
    planMusicXmlReimport,
} from "../musicXmlReimport";
import {
    readCountDurationsInTransaction,
    setTempoSyncedBeatIds,
} from "../tempo";
import { getWorkspaceSettingsParsed } from "../workspaceSettings";

/**
 * E12 against the tempo kit's score exports (apps/desktop/tempo-kit): v1 prints F at ♩=138 (the
 * typo), v2 fixes it to ♩=132, v3 is v2 with two bars added before L.
 */
keepFixturesInPageMode(
    "its tests convert the show and set the flag themselves",
);

afterEach(() => stopTimelineResolver());

const kitFile = (name: string) =>
    readFileSync(
        path.resolve(__dirname, "../../../tempo-kit/fixtures", name),
        "utf8",
    );
const report = (version: "v1" | "v2" | "v3") =>
    parseMusicXmlWithReport(kitFile(`score-${version}-musescore.musicxml`));
const score = (version: "v1" | "v2" | "v3") =>
    scoreMeasuresOf(report(version).measures);

/** Everything a re-import must leave alone: counts (ids and order), pages and drill. */
const DRILL_TABLES = [
    schema.pages,
    schema.timelines,
    schema.timeline_transitions,
    schema.timeline_assignments,
    schema.marcher_pages,
];

const drillSnapshot = async (db: DbConnection) => {
    const out: Record<string, unknown[]> = {};
    for (const table of DRILL_TABLES)
        out[getTableName(table)] = await db.select().from(table).all();
    out.beats = (
        await db
            .select({ id: schema.beats.id, position: schema.beats.position })
            .from(schema.beats)
            .orderBy(asc(schema.beats.position))
            .all()
    ).map((b) => [b.id, b.position]);
    out.measures = (await db.select().from(schema.measures).all()).map((m) => [
        m.id,
        m.start_beat,
    ]);
    return out;
};

const marks = async (db: DbConnection) =>
    Object.fromEntries(
        (await db.select().from(schema.measures).all()).map((m) => [
            m.id,
            m.rehearsal_mark,
        ]),
    );

const undoEntries = async (db: DbConnection) =>
    (
        await db
            .select({ n: countDistinct(schema.history_undo.history_group) })
            .from(schema.history_undo)
            .get()
    )?.n ?? 0;

/**
 * Timeline mode, the kit's v1 score imported the ordinary way, and a breakaway clip that isn't on
 * a page edge (the kind of drill a full re-import refuses).
 */
const setUpV1Show = async (db: DbConnection) => {
    await db.delete(schema.workspace_settings);
    await db.insert(schema.workspace_settings).values({
        id: 1,
        json_data: JSON.stringify({ timelineMode: true, measurementOffset: 1 }),
    });
    await convertPagesToTimeline(db);
    await startTimelineResolver(db);
    const { beats, pages } = await readShowTiming(db);
    const measures = await db.select().from(schema.measures).all();
    const imported = await _importMusicXmlFile({
        data: {
            fileName: "score-v1.musicxml",
            report: report("v1"),
            allPages: [...pages],
            measures: measures.map((m) => ({ id: m.id }) as Measure),
            allBeats: [...beats],
        },
    });
    expect(imported.success).toBe(true);
    await createTrack({
        db,
        target: { kind: "marcher", marcherId: 1 },
        startBeat: 3,
        endBeat: 6,
    });
};

/** Measure index (from 0, the pickup) of each kit letter, and its first count's ordinal. */
const letters = (version: "v1" | "v2" | "v3") => {
    const out: Record<string, { measure: number; ordinal: number }> = {};
    let ordinal = 1;
    report(version).measures.forEach((m, i) => {
        if (m.rehearsalMark) out[m.rehearsalMark] = { measure: i, ordinal };
        ordinal += m.beats.length;
    });
    return out;
};

describeDbTests("MusicXML re-import in place (E12, tempo kit)", (it) => {
    it("v1 → v2 (F fixed): only the counts from F to G change, and drill is untouched", async ({
        db,
        marchersAndPages: _,
    }) => {
        await setUpV1Show(db);
        const drillBefore = await drillSnapshot(db);
        expect(drillBefore.timeline_assignments.length).toBeGreaterThan(0);
        const marksBefore = await marks(db);
        const before = await readCountDurationsInTransaction(db);

        const { plan } = await planMusicXmlReimport({ db, score: score("v2") });
        expect(plan.sameStructure).toBe(true);
        expect(plan.differing).toEqual([]);
        expect(plan.tempoChanges).toHaveLength(1);
        expect(plan.tempoChanges[0]).toMatchObject({
            mark: "F",
            before: { bpm: 138, even: true },
            after: { bpm: 132, even: true },
        });

        const result = await applyMusicXmlReimport({
            db,
            score: score("v2"),
            timing: "score",
        });
        expect(result.changed).toBe(true);

        const after = await readCountDurationsInTransaction(db);
        const { F, G } = letters("v2");
        expect(after.beatIds).toEqual(before.beatIds);
        before.durations.forEach((d, i) => {
            if (i >= F.ordinal && i < G.ordinal)
                expect(after.durations[i]).toBeCloseTo(60 / 132, 9);
            else expect(after.durations[i]).toBe(d);
        });
        // Counts before F keep their times; every count from G on is later by the same amount
        const t0 = countTimes(before.durations);
        const t1 = countTimes(after.durations);
        expect(t1.slice(0, F.ordinal + 1)).toEqual(t0.slice(0, F.ordinal + 1));
        const shift = (G.ordinal - F.ordinal) * (60 / 132 - 60 / 138);
        for (let i = G.ordinal; i < t0.length; i++)
            expect(t1[i] - t0[i]).toBeCloseTo(shift, 9);

        expect(await drillSnapshot(db)).toEqual(drillBefore);
        expect(await marks(db)).toEqual(marksBefore);
    });

    it("v1 → v3 (F fixed, two bars added before L): reported, K–L left alone, no counts added", async ({
        db,
        marchersAndPages: _,
    }) => {
        await setUpV1Show(db);
        const drillBefore = await drillSnapshot(db);
        const before = await readCountDurationsInTransaction(db);

        const { plan } = await planMusicXmlReimport({ db, score: score("v3") });
        const v1 = letters("v1");
        const v3 = letters("v3");
        expect(plan.sameStructure).toBe(false);
        expect(plan.differing).toEqual([
            {
                show: { from: v1.K.measure, to: v1.L.measure },
                score: { from: v3.K.measure, to: v3.L.measure },
                afterMark: "K",
                beforeMark: "L",
            },
        ]);
        expect(v3.L.measure - v1.L.measure).toBe(2);

        await applyMusicXmlReimport({
            db,
            score: score("v3"),
            timing: "score",
        });
        const after = await readCountDurationsInTransaction(db);
        expect(after.beatIds).toEqual(before.beatIds);
        // F's typo is fixed (it is before the bars that differ) ...
        const { F, G } = letters("v1");
        expect(after.durations[F.ordinal]).toBeCloseTo(60 / 132, 9);
        expect(after.durations[G.ordinal - 1]).toBeCloseTo(60 / 132, 9);
        // ... and nothing between K and L changed
        for (let i = v1.K.ordinal; i < v1.L.ordinal; i++)
            expect(after.durations[i]).toBe(before.durations[i]);
        expect(await drillSnapshot(db)).toEqual(drillBefore);
    });

    it("keeps a synced show's alignment unless asked, and then drops only the counts that moved from the synced ones", async ({
        db,
        marchersAndPages: _,
    }) => {
        await setUpV1Show(db);
        const { beatIds, durations } =
            await readCountDurationsInTransaction(db);
        const { B, F, M } = letters("v1");
        await setTempoSyncedBeatIds({
            db,
            syncedBeatIds: [beatIds[B.ordinal], beatIds[M.ordinal]],
        });
        // A mark the designer lost, which the file brings back
        const gRow = (await db.select().from(schema.measures).all()).find(
            (m) => m.rehearsal_mark === "G",
        )!;
        await db
            .update(schema.measures)
            .set({ rehearsal_mark: null })
            .where(eq(schema.measures.id, gRow.id))
            .run();

        const { plan } = await planMusicXmlReimport({ db, score: score("v2") });
        expect(plan.synced).toEqual({ total: 2, moved: [beatIds[M.ordinal]] });
        expect(plan.markChanges.length).toBeGreaterThan(0);

        await applyMusicXmlReimport({ db, score: score("v2"), timing: "keep" });
        expect((await readCountDurationsInTransaction(db)).durations).toEqual(
            durations,
        );
        expect(
            (await db.select().from(schema.measures).all()).find(
                (m) => m.id === gRow.id,
            )?.rehearsal_mark,
        ).toBe("G");

        await applyMusicXmlReimport({
            db,
            score: score("v2"),
            timing: "score",
        });
        expect(
            (await readCountDurationsInTransaction(db)).durations[F.ordinal],
        ).toBeCloseTo(60 / 132, 9);
        expect(
            (await getWorkspaceSettingsParsed({ db })).tempoSyncedBeatIds,
        ).toEqual([beatIds[B.ordinal]]);
    });

    it("writes nothing when the show already matches the file", async ({
        db,
        marchersAndPages: _,
    }) => {
        await setUpV1Show(db);
        const entries = await undoEntries(db);
        const result = await applyMusicXmlReimport({
            db,
            score: score("v1"),
            timing: "score",
        });
        expect(result.changed).toBe(false);
        expect(await undoEntries(db)).toBe(entries);
    });

    it.skipIf(process.env.VITEST_ENABLE_HISTORY !== "true")(
        "is one undo entry: timing, marks and numbering come back together",
        async ({ db, marchersAndPages: _ }) => {
            await setUpV1Show(db);
            await db
                .update(schema.measures)
                .set({ rehearsal_mark: null })
                .where(eq(schema.measures.rehearsal_mark, "G"))
                .run();
            const before = await readCountDurationsInTransaction(db);
            const marksBefore = await marks(db);
            const entries = await undoEntries(db);

            await applyMusicXmlReimport({
                db,
                score: score("v2"),
                timing: "score",
            });
            expect(await undoEntries(db)).toBe(entries + 1);
            expect((await performUndo(db)).success).toBe(true);
            expect(await readCountDurationsInTransaction(db)).toEqual(before);
            expect(await marks(db)).toEqual(marksBefore);
        },
    );
});
