import { afterEach, describe, expect } from "vitest";
import { getBeats, getMeasures, getPages } from "@/db-functions";
import type Page from "@/global/classes/Page";
import type Beat from "@/global/classes/Beat";
import { asc, getTableName } from "drizzle-orm";
import { parseMusicXmlWithReport } from "@openmarch/musicxml-parser";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/test/convertPages";
import { readShowTiming } from "@/timeline/showTiming";
import {
    startTimelineResolver,
    stopTimelineResolver,
} from "@/timeline/timelineStore";
import { createTrack } from "@/db-functions/timelineCommands";
import { performUndo } from "@/db-functions/history";
import type Measure from "@/global/classes/Measure";
import {
    _dryRunMusicXmlImport,
    _importMusicXmlFile,
    parseMusicXmlFile,
    type MusicXmlImportData,
} from "../MusicXmlImport";

keepFixturesInPageMode(
    "its tests convert the show and set the timeline flag themselves",
);

afterEach(() => stopTimelineResolver());

/** A MuseScore-style score: a one-count pickup, then A in 4/4 and B in 6/8 (♩. = 88). */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Tpt</part-name></score-part></part-list>
<part id="P1">
<measure number="0" implicit="yes"><attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type></note></measure>
<measure number="1"><direction><direction-type><rehearsal>A</rehearsal></direction-type></direction><note><rest measure="yes"/><duration>1920</duration><voice>1</voice></note></measure>
<measure number="2"><attributes><time><beats>6</beats><beat-type>8</beat-type></time></attributes>
<direction><direction-type><rehearsal>B</rehearsal></direction-type></direction>
<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>88</per-minute></metronome></direction-type><sound tempo="132"/></direction>
<note><rest measure="yes"/><duration>1440</duration><voice>1</voice></note></measure>
</part></score-partwise>`;

const TABLES = [
    schema.beats,
    schema.measures,
    schema.pages,
    schema.workspace_settings,
    schema.timelines,
    schema.timeline_transitions,
    schema.timeline_assignments,
];

const snapshot = async (db: DbConnection) => {
    const out: Record<string, unknown[]> = {};
    for (const table of TABLES)
        out[getTableName(table)] = await db.select().from(table).all();
    return out;
};

const importData = async (db: DbConnection): Promise<MusicXmlImportData> => {
    const { beats, pages } = await readShowTiming(db);
    const measures = await db.select().from(schema.measures).all();
    return {
        fileName: "score.musicxml",
        report: parseMusicXmlWithReport(XML),
        allPages: [...pages],
        measures: measures.map((m) => ({ id: m.id }) as Measure),
        allBeats: [...beats],
    };
};

/** The show converted, the resolver running. */
const setUp = async (db: DbConnection) => {
    await db.delete(schema.workspace_settings);
    await db.insert(schema.workspace_settings).values({
        id: 1,
        json_data: JSON.stringify({ measurementOffset: 1 }),
    });
    await convertPagesToTimeline(db);
    await startTimelineResolver(db);
};

describeDbTests("MusicXML import", (it) => {
    describe("dry run", () => {
        it("says the import would go through, and writes nothing", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            const before = await snapshot(db);
            expect(
                await _dryRunMusicXmlImport({ data: await importData(db) }),
            ).toEqual({ ok: true });
            expect(await snapshot(db)).toEqual(before);
        });

        it("explains in plain words when the drill would refuse it, and writes nothing", async ({
            db,
            marchersAndPages: _,
        }) => {
            await setUp(db);
            // A track that isn't on a page edge loses its beats when the old beats go
            await createTrack({
                db,
                target: { kind: "marcher", marcherId: 1 },
                startBeat: 11,
                endBeat: 13,
            });
            const before = await snapshot(db);
            const result = await _dryRunMusicXmlImport({
                data: await importData(db),
            });
            expect(result.ok).toBe(false);
            const message = (result as { message: string }).message;
            expect(message).not.toMatch(/^E-/);
            expect(message.length).toBeGreaterThan(10);
            expect(await snapshot(db)).toEqual(before);
        });
    });

    it("writes the counts, marks and the score's first measure number", async ({
        db,
        marchersAndPages: _,
    }) => {
        await setUp(db);
        const result = await _importMusicXmlFile({
            data: await importData(db),
        });
        expect(result.success).toBe(true);

        const beats = await db
            .select()
            .from(schema.beats)
            .orderBy(asc(schema.beats.position))
            .all();
        // Beat 0, then the counts: 1 (pickup) + 4 + 2 (6/8)
        expect(beats.slice(1, 8).map((b) => b.duration)).toEqual([
            0.5,
            0.5,
            0.5,
            0.5,
            0.5,
            60 / 88,
            60 / 88,
        ]);
        const marks = (await db.select().from(schema.measures).all()).map(
            (m) => m.rehearsal_mark,
        );
        expect(marks.slice(0, 3)).toEqual([null, "A", "B"]);
        const settings = await db
            .select()
            .from(schema.workspace_settings)
            .get();
        expect(JSON.parse(settings!.json_data)).toMatchObject({
            measurementOffset: 0,
        });
    });

    it.skipIf(process.env.VITEST_ENABLE_HISTORY !== "true")(
        "is one undo entry, measure numbering included",
        async ({ db, marchersAndPages: _ }) => {
            await setUp(db);
            const before = await snapshot(db);
            await _importMusicXmlFile({ data: await importData(db) });
            expect((await performUndo(db)).success).toBe(true);
            const after = await snapshot(db);
            expect(after.beats).toEqual(before.beats);
            expect(after.measures).toEqual(before.measures);
            expect(after.pages).toEqual(before.pages);
            expect(
                JSON.parse(
                    (after.workspace_settings[0] as { json_data: string })
                        .json_data,
                ),
            ).toMatchObject({ measurementOffset: 1 });
        },
    );
});

/*
 * The import reads and parses the file before it opens a history transaction, so a file that
 * can't be imported fails without touching the show; a file that can replaces the show's
 * measures and beats and moves each page to a measure's first beat.
 */

/** A picked file's bytes (jsdom's File has no `arrayBuffer`). */
const score = (measures: string) => {
    const bytes = new TextEncoder().encode(
        `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">${measures}</part>
</score-partwise>`,
    );
    return { arrayBuffer: async () => bytes.buffer as ArrayBuffer };
};

const MEASURE = `<measure number="1">
  <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
  <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
</measure>`;

/** A measure of rest `eighths` eighth notes long, in 6/8 */
const sixEight = (number: number, eighths: number, implicit = false) =>
    `<measure number="${number}"${implicit ? ' implicit="yes"' : ""}>
  ${number === 0 ? `<attributes><divisions>2</divisions><time><beats>6</beats><beat-type>8</beat-type></time></attributes>` : ""}
  <note><rest/><duration>${eighths}</duration></note>
</measure>`;

/** Imports a score into the show the way the hook does: parse first, then write. */
const importFile = async (db: DbConnection, file: ReturnType<typeof score>) => {
    const report = await parseMusicXmlFile(file);
    // The import only reads the rows' ids
    return await _importMusicXmlFile({
        data: {
            fileName: "score.musicxml",
            report,
            allPages: (await getPages({ db })) as unknown as Page[],
            measures: (await getMeasures({ db })) as unknown as Measure[],
            allBeats: (await getBeats({ db })) as unknown as Beat[],
        },
    });
};

describe("parseMusicXmlFile", () => {
    it("parses a score's measures", async () => {
        const parsed = await parseMusicXmlFile(score(MEASURE));

        expect(parsed.measures).toHaveLength(1);
        expect(parsed.measures[0].beats).toHaveLength(4);
    });

    it("rejects a score with no measures", async () => {
        await expect(parseMusicXmlFile(score(""))).rejects.toThrow(
            "The file has no measures",
        );
    });
});

describeDbTests("MusicXML import: replacing the counts", (it) => {
    it("writes the score's measures and beats", async ({ db }) => {
        const result = await importFile(
            db,
            score(MEASURE + MEASURE.replace('number="1"', 'number="2"')),
        );

        expect(result.success).toBe(true);
        const measures = await getMeasures({ db });
        expect(measures.length).toBeGreaterThanOrEqual(2);
        const beats = new Set((await getBeats({ db })).map((b) => b.id));
        for (const m of measures) expect(beats).toContain(m.start_beat);
    });

    it("imports a short last measure after a pickup rounded up to the whole measure", async ({
        db,
    }) => {
        // 6/8 with a five-eighth pickup (both counts) and a one-eighth last measure
        const result = await importFile(
            db,
            score(sixEight(0, 5, true) + sixEight(1, 6) + sixEight(2, 1)),
        );

        expect(result.success).toBe(true);
        const startBeats = (await getMeasures({ db })).map((m) => m.start_beat);
        expect(new Set(startBeats).size).toBe(startBeats.length);
    });

    it("numbers a rehearsal mark played again by a repeat", async ({ db }) => {
        const marked = MEASURE.replace(
            "</attributes>",
            `</attributes><direction><direction-type><rehearsal>A</rehearsal></direction-type></direction>`,
        ).replace(
            "</note>",
            `</note><barline location="right"><repeat direction="backward"/></barline>`,
        );
        await importFile(db, score(marked));

        const marks = (await getMeasures({ db }))
            .map((m) => m.rehearsal_mark)
            .filter(Boolean);
        expect(marks).toEqual(["A", "A-2"]);
    });

    it("leaves the show alone when the file can't be imported", async ({
        db,
    }) => {
        const before = {
            measures: await getMeasures({ db }),
            beats: await getBeats({ db }),
        };

        await expect(importFile(db, score(""))).rejects.toThrow();

        expect(await getMeasures({ db })).toEqual(before.measures);
        expect(await getBeats({ db })).toEqual(before.beats);
    });
});
