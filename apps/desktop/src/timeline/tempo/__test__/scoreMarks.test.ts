import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseMusicXmlWithReport } from "@openmarch/musicxml-parser";
import {
    deriveTempoMap,
    meterText,
    rowTempoText,
    type TempoMapMeasure,
} from "../tempoMap";
import { scoreTempoMarks, unitOfMarking } from "../scoreMarks";

const parse = (name: string) =>
    parseMusicXmlWithReport(
        readFileSync(
            path.resolve(__dirname, "../../../../tempo-kit/fixtures", name),
            "utf8",
        ),
    );

/** The map an import of `name` shows: rows as "m38 G 12/8 ♩.=152.5". */
function importedMap(name: string): string[] {
    const report = parse(name);
    const durations = [0];
    const measures: TempoMapMeasure[] = [];
    for (const m of report.measures) {
        measures.push({
            number: m.number,
            rehearsalMark: m.rehearsalMark ?? null,
            firstCount: durations.length,
            counts: m.beats.length,
        });
        durations.push(...m.beats.map((b) => b.duration));
    }
    const rows = deriveTempoMap({
        durations,
        measures,
        marks: scoreTempoMarks(report.measures),
    });
    return rows.map((r) =>
        [`m${r.measureNumber}`, r.rehearsalMark, meterText(r), rowTempoText(r)]
            .filter(Boolean)
            .join(" "),
    );
}

describe("scoreTempoMarks (FX-3)", () => {
    it("keeps Sam's corps chart as written: pickup, 7/8, 5/8, 3/2, 12/8 at ♩.=♩", () => {
        for (const file of [
            "corps-sibelius.musicxml",
            "corps-musescore.musicxml",
        ])
            expect(importedMap(file)).toEqual([
                "m0 4/4 pickup, 1 count ♩=176",
                "m1 A 4/4 ♩=176",
                "m17 C 7/8 2+2+3 ♩=176",
                "m25 D 5/8 3+2 ♩=176",
                "m29 E 3/2 ♩=176",
                "m30 F 4/4 ♩=152.5",
                "m38 G 12/8 ♩.=152.5",
            ]);
    });

    it("reads Marcus's 6/8 as ♩.=88, with its own decimal tempo", () => {
        const rows = importedMap("score-v1-sibelius.musicxml");
        expect(rows).toContain("m63 I 6/8 ♩.=88");
        expect(rows).toContain("m67 6/8 ♩.=85");
        expect(rows.some((r) => r.includes("2/4"))).toBe(false);
    });

    it("maps metronome notes to the map's units", () => {
        expect(unitOfMarking("quarter", 1)).toBe("dq");
        expect(unitOfMarking("eighth", 0)).toBe("e");
        expect(unitOfMarking("half", 1)).toBe("dh");
        expect(unitOfMarking("whole", 0)).toBeNull();
        expect(unitOfMarking("quarter", 2)).toBeNull();
    });
});
