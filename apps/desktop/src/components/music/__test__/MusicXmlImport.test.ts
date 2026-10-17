import { describe, expect } from "vitest";
import { getBeats, getMeasures, getPages } from "@/db-functions";
import { describeDbTests, type DbConnection } from "@/test/base";
import type Page from "@/global/classes/Page";
import type Measure from "@/global/classes/Measure";
import type Beat from "@/global/classes/Beat";
import { _importMusicXmlFile, parseMusicXmlFile } from "../MusicXmlImport";

/**
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
const importScore = async (
    db: DbConnection,
    file: ReturnType<typeof score>,
) => {
    const parsed = await parseMusicXmlFile(file);
    // The import only reads the rows' ids
    return await _importMusicXmlFile({
        data: {
            fileName: "score.musicxml",
            parsed,
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

describeDbTests("MusicXML import", (it) => {
    it("writes the score's measures and beats", async ({ db }) => {
        const result = await importScore(
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
        const result = await importScore(
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
        await importScore(db, score(marked));

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

        await expect(importScore(db, score(""))).rejects.toThrow();

        expect(await getMeasures({ db })).toEqual(before.measures);
        expect(await getBeats({ db })).toEqual(before.beats);
    });
});
