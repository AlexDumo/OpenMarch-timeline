import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { decodeXmlBytes, readMusicXmlFile } from "../read";

const xml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise>é</score-partwise>`;

describe("reading a file's bytes", () => {
    it("reads UTF-8, with or without a byte order mark", () => {
        const bytes = new TextEncoder().encode(xml);
        expect(decodeXmlBytes(bytes)).toBe(xml);
        expect(
            decodeXmlBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes])),
        ).toBe(xml);
    });

    it("reads UTF-16 with a byte order mark, as Finale writes it", () => {
        const units = [...xml].map((c) => c.charCodeAt(0));
        const le = new Uint8Array([
            0xff,
            0xfe,
            ...units.flatMap((u) => [u & 0xff, u >> 8]),
        ]);
        const be = new Uint8Array([
            0xfe,
            0xff,
            ...units.flatMap((u) => [u >> 8, u & 0xff]),
        ]);
        expect(decodeXmlBytes(le)).toBe(xml);
        expect(decodeXmlBytes(be)).toBe(xml);
    });

    it("reads a UTF-8 file that says it is UTF-16 as UTF-8", () => {
        const mislabelled = xml.replace("UTF-8", "UTF-16");
        expect(decodeXmlBytes(new TextEncoder().encode(mislabelled))).toBe(
            mislabelled,
        );
    });

    it("reads the 8-bit encoding the declaration names", () => {
        const latin1 = `<?xml version="1.0" encoding="ISO-8859-1"?><a>é</a>`;
        const bytes = new Uint8Array([...latin1].map((c) => c.charCodeAt(0)));
        expect(decodeXmlBytes(bytes)).toBe(latin1);
    });

    it("finds the score in an .mxl through its container, whatever the file is called", async () => {
        const zip = new JSZip();
        zip.file(
            "META-INF/container.xml",
            `<container><rootfiles><rootfile full-path="music/score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`,
        );
        zip.file("music/other.xml", "<not-it/>");
        zip.file("music/score.musicxml", xml);
        const bytes = await zip.generateAsync({ type: "uint8array" });
        expect(await readMusicXmlFile(bytes)).toBe(xml);
    });

    it("reads a plain XML file that is named .mxl", async () => {
        expect(await readMusicXmlFile(new TextEncoder().encode(xml))).toBe(xml);
    });
});
