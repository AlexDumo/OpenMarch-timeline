import { describe, expect, it } from "vitest";
import { parseMusicXmlWithReport } from "@openmarch/musicxml-parser";
import {
    firstMeasureNumber,
    formatDuration,
    marksRange,
    meterLabel,
    previewRows,
    summaryParts,
    warningText,
    type PreviewTranslate,
} from "../musicXmlPreview";

const m = (number: string | number, inner: string, implicit = false) =>
    `<measure number="${number}"${implicit ? ' implicit="yes"' : ""}>${inner}</measure>`;
const time = (beats: string | number, beatType: number) =>
    `<attributes><divisions>2</divisions><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time></attributes>`;
const tempo = (bpm: number) => `<sound tempo="${bpm}"/>`;
const mark = (l: string) =>
    `<direction><direction-type><rehearsal>${l}</rehearsal></direction-type></direction>`;
const words = (w: string) =>
    `<direction><direction-type><words>${w}</words></direction-type></direction>`;
const note = (quarters: number) =>
    `<note><duration>${quarters * 2}</duration></note>`;
const score = (inner: string) =>
    `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">${inner}</part></score-partwise>`;

/** Echoes the key and its params, so the tests see which text and values the dialog asks for. */
const t: PreviewTranslate = (key, params) =>
    params && Object.keys(params).length
        ? `${key} ${JSON.stringify(params)}`
        : key;

const report = parseMusicXmlWithReport(
    score(
        m(0, time(4, 4) + tempo(132) + note(1), true) +
            m(1, mark("A") + note(4)) +
            m(2, note(4)) +
            m(3, mark("B") + time(7, 8) + note(3.5)) +
            m(4, mark("C") + time(4, 4) + words("rit.") + note(4)) +
            m(5, words("a tempo") + note(4)),
    ),
);

describe("previewRows", () => {
    it("shows only measures where something happens", () => {
        expect(
            previewRows(report).map((r) => [
                r.measure,
                r.rehearsalMark,
                r.meter,
                r.tempo,
                r.counts,
                r.warnings.map((w) => w.code),
                r.notes.map((w) => w.code),
            ]),
        ).toEqual([
            ["0", undefined, "4/4", "♩ = 132", 1, [], ["pickup"]],
            ["1", "A", undefined, undefined, 4, [], []],
            ["3", "B", "7/8 (2+2+3)", undefined, 3, ["assumed-grouping"], []],
            ["4", "C", "4/4", undefined, 4, ["ramp-not-applied"], []],
            ["5", undefined, undefined, "♩ = 132", 4, [], ["a-tempo"]],
        ]);
    });

    it("shows every measure when asked", () => {
        expect(previewRows(report, { all: true })).toHaveLength(6);
    });
});

describe("summary", () => {
    it("lists measures, marks, meter changes, warnings and length", () => {
        expect(summaryParts(report, t)).toEqual([
            'music.xmlPreview.summary.measures {"count":6}',
            'music.xmlPreview.summary.marks {"marks":"A–C"}',
            'music.xmlPreview.summary.meterChanges {"count":2}',
            'music.xmlPreview.summary.warnings {"count":2}',
            formatDuration(report.summary.durationSeconds),
        ]);
    });

    it.each([
        [["A", "B", "C", "D"], "A–D"],
        [["A"], "A"],
        [["A", "C"], "A, C"],
        [["Intro", "Ballad"], "Intro, Ballad"],
        [[], ""],
    ])("marks %j read %j", (marks, expected) => {
        expect(marksRange(marks)).toBe(expected);
    });

    it("formats durations as m:ss", () => {
        expect(formatDuration(252.4)).toBe("4:12");
        expect(formatDuration(5)).toBe("0:05");
    });
});

describe("labels", () => {
    it("shows the grouping of grouped meters only", () => {
        expect(
            meterLabel({
                text: "2+2+3/8",
                counts: [1, 1, 1.5],
                grouping: "2+2+3",
                assumedGrouping: false,
            }),
        ).toBe("7/8 (2+2+3)");
        expect(
            meterLabel({
                text: "6/8",
                counts: [1.5, 1.5],
                assumedGrouping: false,
            }),
        ).toBe("6/8");
    });

    it("translates a rit. that wasn't applied with its reason", () => {
        const w = report.warnings.find((x) => x.code === "ramp-not-applied")!;
        expect(warningText(w, t)).toBe(
            'music.xmlPreview.warnings.ramp-not-applied {"text":"rit.","reason":"music.xmlPreview.rampReasons.no-target {\\"window\\":4}","window":4}',
        );
    });

    it("numbers measures from the file's first number, so a pickup is m0", () => {
        expect(firstMeasureNumber(report)).toBe(0);
        expect(
            firstMeasureNumber(
                parseMusicXmlWithReport(score(m("A", time(4, 4) + note(4)))),
            ),
        ).toBe(undefined);
    });
});
