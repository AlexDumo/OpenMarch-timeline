import { describe, expect, it, vi } from "vitest";

/**
 * The import reads and parses the file before it opens a history transaction, so a file that
 * can't be imported fails without touching the show.
 */

vi.mock("@/App", () => ({ queryClient: undefined }));
vi.mock("@/global/database/db", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    db: {},
}));

const { parseMusicXmlFile } = await import("../MusicXmlImport");

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
