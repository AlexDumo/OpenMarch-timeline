import { describe, expect, it } from "vitest";
import { parseMusicXml, parseMusicXmlWithReport } from "../../parser";
import { formatTempoMarking } from "../../tempo";
import {
    measure,
    museScoreTempo,
    note,
    rehearsal,
    rest,
    restMeasures,
    score,
    sibeliusTempo,
    time,
    words,
} from "./scoreBuilders";

const durations = (xml: string) =>
    parseMusicXml(xml).map((m) => m.beats.map((b) => b.duration));
const codes = (xml: string) =>
    parseMusicXmlWithReport(xml).warnings.map((w) => w.code);

describe("tempo", () => {
    it("reads a decimal <sound tempo> (MuseScore ♩. = 85 is 127.5 quarters)", () => {
        const xml = score(
            measure(
                1,
                time(6, 8) + museScoreTempo("quarter", 1, 85, 127.5) + rest(3),
            ),
        );
        const [m] = parseMusicXml(xml);
        expect(m!.beats).toHaveLength(2);
        for (const beat of m!.beats)
            expect(beat.duration).toBeCloseTo(60 / 85, 9);
        expect(formatTempoMarking(m!.tempo!)).toBe("♩. = 85");
        expect(m!.tempo!.quarterBpm).toBe(127.5);
    });

    it("reads ♩. = 88 from a Sibelius metronome with no <sound tempo>", () => {
        const xml = score(
            measure(1, time(6, 8) + sibeliusTempo("quarter", 1, 88) + rest(3)) +
                measure(2, rest(3)),
        );
        expect(durations(xml)).toEqual([
            [60 / 88, 60 / 88],
            [60 / 88, 60 / 88],
        ]);
    });

    it("converts half-note and eighth-note beat units to the counts", () => {
        const cut = score(
            measure(1, time(2, 2) + sibeliusTempo("half", 0, 66) + rest(4)),
        );
        expect(durations(cut)[0]).toEqual([60 / 66, 60 / 66]);
        expect(parseMusicXml(cut)[0]!.tempo!.quarterBpm).toBe(132);

        const sevenEight = score(
            measure(
                1,
                time("2+2+3", 8) + sibeliusTempo("eighth", 0, 352) + rest(3.5),
            ),
        );
        const [short1, short2, long] = durations(sevenEight)[0]!;
        expect(short1).toBeCloseTo(60 / 176, 9);
        expect(short2).toBeCloseTo(60 / 176, 9);
        expect(long).toBeCloseTo(90 / 176, 9);
    });

    it("prefers <sound tempo> to the printed number when both are there", () => {
        const xml = score(
            measure(
                1,
                time(4, 4) + museScoreTempo("quarter", 0, 132, 131.5) + rest(4),
            ),
        );
        expect(durations(xml)[0]![0]).toBeCloseTo(60 / 131.5, 9);
    });

    it('reads "c. 132" as 132 and says it was approximate, never NaN', () => {
        const xml = score(
            measure(
                1,
                time(4, 4) + sibeliusTempo("quarter", 0, "c. 132") + rest(4),
            ),
        );
        const report = parseMusicXmlWithReport(xml);
        expect(report.measures[0]!.beats.map((b) => b.duration)).toEqual(
            Array(4).fill(60 / 132),
        );
        expect(report.warnings).toMatchObject([
            {
                code: "approximate-tempo",
                severity: "info",
                message: "m1: Approximate tempo read as c. ♩ = 132",
            },
        ]);
    });

    it("keeps the previous tempo and warns when a tempo isn't a number", () => {
        const xml = score(
            measure(
                1,
                time(4, 4) + museScoreTempo("quarter", 0, 100, 100) + rest(4),
            ) +
                measure(2, sibeliusTempo("quarter", 0, "fast") + rest(4)) +
                measure(3, '<sound tempo="0"/>' + rest(4)),
        );
        const report = parseMusicXmlWithReport(xml);
        for (const m of report.measures)
            expect(m.beats.every((b) => b.duration === 60 / 100)).toBe(true);
        expect(report.warnings.map((w) => w.message)).toEqual([
            'm2: Tempo "fast" isn\'t a number; kept ♩ = 100',
            'm3: Tempo "0" isn\'t a number; kept ♩ = 100',
        ]);
    });

    it("applies a marking in the middle of a measure from the count it falls on", () => {
        const xml = score(
            measure(
                1,
                time(4, 4) +
                    museScoreTempo("quarter", 0, 120, 120) +
                    note(1) +
                    note(1) +
                    museScoreTempo("quarter", 0, 60, 60) +
                    note(1) +
                    note(1),
            ),
        );
        expect(durations(xml)[0]).toEqual([0.5, 0.5, 1, 1]);
    });

    it("reads a tempo written as text with a note glyph", () => {
        const xml = score(
            measure(
                1,
                time(4, 4) +
                    '<direction placement="above"><direction-type><words>Allegro ♩ = 144</words></direction-type></direction>' +
                    rest(4),
            ),
        );
        expect(durations(xml)[0]![0]).toBeCloseTo(60 / 144, 9);
        expect(codes(xml)).toEqual([]);
    });

    it('warns when tempo words like "Allegro" come with no number', () => {
        const xml = score(measure(1, time(4, 4) + words("Allegro") + rest(4)));
        const report = parseMusicXmlWithReport(xml);
        expect(report.warnings.map((w) => w.code)).toEqual([
            "no-tempo",
            "tempo-word-without-number",
        ]);
        expect(report.measures[0]!.beats[0]!.duration).toBe(0.5);
    });

    it("counts x/2 in halves when the tempo is marked in halves", () => {
        const xml = score(
            measure(1, time(3, 2) + sibeliusTempo("half", 0, 60) + rest(6)),
        );
        expect(durations(xml)[0]).toEqual([1, 1, 1]);
        expect(parseMusicXml(xml)[0]!.meter!.inQuarters).toBeUndefined();
    });

    it("reads a metric modulation with no number as new note = old note, with a warning", () => {
        const xml = score(
            measure(
                1,
                time(4, 4) + museScoreTempo("quarter", 0, 120, 120) + rest(4),
            ) +
                measure(
                    2,
                    time(12, 8) +
                        "<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><beat-unit>quarter</beat-unit></metronome></direction-type></direction>" +
                        rest(6),
                ),
        );
        const report = parseMusicXmlWithReport(xml);
        expect(report.warnings.map((w) => w.message)).toEqual([
            "m2: Metric modulation ♩. = ♩ has no number; read as the new note lasting as long as the old one: ♩. = 120",
        ]);
        // The new dotted quarter lasts as long as the old quarter: 0.5 s
        expect(durations(xml)[1]).toEqual(Array(4).fill(0.5));
    });
});

describe("meters", () => {
    const counts = (
        beats: string | number,
        beatType: number,
        quarters: number,
    ) =>
        parseMusicXml(
            score(
                measure(
                    1,
                    time(beats, beatType) +
                        museScoreTempo("quarter", 0, 60, 60) +
                        rest(quarters),
                ),
            ),
        )[0]!.beats.map((b) => b.duration);

    it.each([
        ["4/4", 4, 4, 4, [1, 1, 1, 1]],
        ["3/4", 3, 4, 3, [1, 1, 1]],
        ["5/4", 5, 4, 5, [1, 1, 1, 1, 1]],
        ["7/4", 7, 4, 7, [1, 1, 1, 1, 1, 1, 1]],
        ["2/2 (♩ marked)", 2, 2, 4, [1, 1, 1, 1]],
        ["3/2 (♩ marked)", 3, 2, 6, [1, 1, 1, 1, 1, 1]],
        ["6/8", 6, 8, 3, [1.5, 1.5]],
        ["9/8", 9, 8, 4.5, [1.5, 1.5, 1.5]],
        ["12/8", 12, 8, 6, [1.5, 1.5, 1.5, 1.5]],
        ["3/8", 3, 8, 1.5, [1.5]],
        ["2/8", 2, 8, 1, [1]],
        ["5/8", 5, 8, 2.5, [1.5, 1]],
        ["7/8", 7, 8, 3.5, [1, 1, 1.5]],
        ["8/8", 8, 8, 4, [1.5, 1.5, 1]],
        ["2+2+3/8", "2+2+3", 8, 3.5, [1, 1, 1.5]],
        ["3+2+2/8", "3+2+2", 8, 3.5, [1.5, 1, 1]],
        ["3+3+2/8", "3+3+2", 8, 4, [1.5, 1.5, 1]],
        ["7/16", 7, 16, 1.75, [0.5, 0.5, 0.75]],
    ])(
        "counts %s at ♩ = 60 as %j seconds",
        (_, beats, beatType, quarters, expected) => {
            expect(counts(beats, beatType, quarters)).toEqual(expected);
        },
    );

    it("writes 2+2+3 as short, short, long the way the app's mixed-meter helpers read it", () => {
        const [m] = parseMusicXml(
            score(
                measure(
                    1,
                    time("2+2+3", 8) +
                        museScoreTempo("quarter", 0, 176, 176) +
                        rest(3.5),
                ),
            ),
        );
        const durationsSet = [...new Set(m!.beats.map((b) => b.duration))];
        // measureIsMixedMeter: exactly two durations in the ratio 3:2
        expect(durationsSet).toHaveLength(2);
        expect(
            Math.max(...durationsSet) / Math.min(...durationsSet),
        ).toBeCloseTo(1.5, 12);
        // getStrongBeatIndexes / patternStringToLongBeatIndexes("2+2+3") give [2]
        const longest = Math.max(...durationsSet);
        expect(
            m!.beats.flatMap((b, i) => (b.duration === longest ? [i] : [])),
        ).toEqual([2]);
        // The short count is the quarter: the tempo the app shows for mixed meter
        expect(Math.min(...durationsSet)).toBeCloseTo(60 / 176, 12);
        expect(m!.meter).toMatchObject({
            text: "2+2+3/8",
            grouping: "2+2+3",
            assumedGrouping: false,
        });
    });

    it("warns once when it guesses a grouping, and not for compound meters", () => {
        const xml = score(
            measure(
                1,
                time(7, 8) + museScoreTempo("eighth", 0, 352, 176) + rest(3.5),
            ) +
                measure(2, rest(3.5)) +
                measure(3, time(6, 8) + rest(3)) +
                measure(4, time(5, 8) + rest(2.5)),
        );
        expect(
            parseMusicXmlWithReport(xml).warnings.map((w) => w.message),
        ).toEqual([
            "m1: 7/8 has no grouping in the file; counted 2+2+3",
            "m4: 5/8 has no grouping in the file; counted 3+2",
        ]);
    });

    it("keeps the previous meter and warns when the meter isn't understood", () => {
        const xml = score(
            measure(
                1,
                time(4, 4) + museScoreTempo("quarter", 0, 120, 120) + rest(4),
            ) +
                measure(2, time(4, 3) + rest(4)) +
                measure(
                    3,
                    `<attributes><time><senza-misura/></time></attributes>` +
                        rest(4),
                ),
        );
        const report = parseMusicXmlWithReport(xml);
        expect(report.measures.map((m) => m.beats.length)).toEqual([4, 4, 4]);
        expect(report.warnings.map((w) => w.message)).toEqual([
            "m2: 4/3 isn't a meter OpenMarch can count; kept 4/4",
            "m3: senza misura isn't a meter OpenMarch can count; kept 4/4",
        ]);
    });

    it("warns when a score has no time signature, and counts 4/4", () => {
        const xml = score(
            measure(1, museScoreTempo("quarter", 0, 120, 120) + rest(4)),
        );
        expect(codes(xml)).toEqual(["no-time-signature"]);
        expect(durations(xml)[0]).toHaveLength(4);
    });
});

describe("measure numbers and pickups", () => {
    it("keeps the file's numbers and gives a pickup only the counts it fills", () => {
        const xml = score(
            measure(
                0,
                time(4, 4) + museScoreTempo("quarter", 0, 120, 120) + note(1),
                {
                    implicit: true,
                },
            ) + restMeasures(1, 2),
        );
        const report = parseMusicXmlWithReport(xml);
        expect(
            report.measures.map((m) => [m.label, m.number, m.beats.length]),
        ).toEqual([
            ["0", 0, 1],
            ["1", 1, 4],
            ["2", 2, 4],
        ]);
        expect(report.measures[0]!.implicit).toBe(true);
        expect(report.warnings).toMatchObject([
            {
                code: "pickup",
                severity: "info",
                message: "m0: Pickup: 1 count(s)",
            },
        ]);
    });

    it("gives a 6/8 pickup of three eighths one dotted-quarter count", () => {
        const xml = score(
            measure(
                0,
                time(6, 8) +
                    sibeliusTempo("quarter", 1, 120) +
                    note(0.5) +
                    note(0.5) +
                    note(0.5),
                {
                    implicit: true,
                },
            ) + measure(1, rest(3)),
        );
        expect(durations(xml)).toEqual([[0.5], [0.5, 0.5]]);
    });

    it("rounds a pickup that isn't a whole count up, with a warning", () => {
        const xml = score(
            measure(
                0,
                time(4, 4) + museScoreTempo("quarter", 0, 120, 120) + note(0.5),
                {
                    implicit: true,
                },
            ) + restMeasures(1, 1),
        );
        const report = parseMusicXmlWithReport(xml);
        expect(report.measures[0]!.beats).toHaveLength(1);
        expect(report.warnings[0]).toMatchObject({
            code: "pickup-rounded",
            severity: "warning",
        });
    });

    it("warns when the file's numbers skip, naming the number the app will show", () => {
        const xml = score(
            measure(
                1,
                time(4, 4) + museScoreTempo("quarter", 0, 120, 120) + rest(4),
            ) +
                measure(2, rest(4)) +
                measure(4, rest(4)),
        );
        expect(
            parseMusicXmlWithReport(xml).warnings.map((w) => w.message),
        ).toEqual([
            "m4: The file's measure numbers aren't consecutive after m2; OpenMarch numbers this measure m3",
        ]);
    });
});

describe("rit., accel. and a tempo", () => {
    const head = measure(
        1,
        time(4, 4) +
            rehearsal("A") +
            museScoreTempo("quarter", 0, 132, 132) +
            rest(4),
    );

    it("applies a rit. that arrives at a numbered tempo, and goes back with a tempo", () => {
        const xml = score(
            head +
                measure(2, words("rit.", "start") + rest(4)) +
                measure(
                    3,
                    '<direction><direction-type><dashes type="stop" number="1"/></direction-type></direction>' +
                        rest(4),
                ) +
                measure(4, museScoreTempo("quarter", 0, 100, 100) + rest(4)) +
                measure(5, rehearsal("B") + words("a tempo") + rest(4)),
        );
        const report = parseMusicXmlWithReport(xml);
        const bpm = report.measures.map((m) =>
            m.beats.map((b) => 60 / b.duration),
        );
        expect(bpm[0]).toEqual([132, 132, 132, 132]);
        const ramp = [...bpm[1]!, ...bpm[2]!];
        ramp.forEach((value, i) =>
            expect(value).toBeCloseTo(132 - (32 * i) / 8, 9),
        );
        expect(bpm[3]).toEqual([100, 100, 100, 100]);
        expect(bpm[4]).toEqual([132, 132, 132, 132]);
        expect(report.ramps).toEqual([
            {
                kind: "slower",
                text: "rit.",
                startMeasureIndex: 1,
                targetMeasureIndex: 3,
                applied: true,
                fromQuarterBpm: 132,
                toQuarterBpm: 100,
            },
        ]);
        expect(report.warnings.map((w) => w.message)).toEqual([
            "m2: rit. from ♩ = 132 to ♩ = 100 at m4",
            "m5: a tempo: back to ♩ = 132",
        ]);
        expect(report.summary).toMatchObject({
            tempoChanges: 2,
            ramps: 1,
            warnings: 0,
        });
    });

    it('reports "rit. at m33 not applied" when nothing says where it arrives', () => {
        const xml = score(
            head +
                restMeasures(2, 31) +
                measure(33, words("poco rit.") + rest(4)) +
                measure(34, rest(4)) +
                measure(35, words("a tempo") + rest(4)),
        );
        const report = parseMusicXmlWithReport(xml);
        expect(report.warnings.map((w) => [w.severity, w.message])).toEqual([
            [
                "warning",
                "m33: poco rit. not applied: no tempo marking says where it arrives",
            ],
            ["info", "m35: a tempo: back to ♩ = 132"],
        ]);
        expect(
            report.measures.every((m) =>
                m.beats.every((b) => b.duration === 60 / 132),
            ),
        ).toBe(true);
        expect(report.ramps[0]).toMatchObject({
            applied: false,
            startMeasureIndex: 32,
        });
    });

    it("doesn't apply a rit. to a marking too far away or going the other way", () => {
        const far = score(
            head +
                measure(2, words("rit.") + rest(4)) +
                restMeasures(3, 5) +
                measure(8, museScoreTempo("quarter", 0, 100, 100) + rest(4)),
        );
        expect(parseMusicXmlWithReport(far).warnings[0]!.message).toBe(
            "m2: rit. not applied: the next tempo marking is more than 4 measures later",
        );
        const faster = score(
            head +
                measure(2, words("rit.") + rest(4)) +
                measure(3, museScoreTempo("quarter", 0, 140, 140) + rest(4)),
        );
        expect(parseMusicXmlWithReport(faster).warnings[0]!.message).toBe(
            "m2: rit. not applied: the next tempo marking goes the other way",
        );
    });

    it("applies an accel. and reads Tempo I", () => {
        const xml = score(
            head +
                measure(2, words("accel.") + rest(4)) +
                measure(3, museScoreTempo("quarter", 0, 164, 164) + rest(4)) +
                measure(4, words("Tempo I") + rest(4)),
        );
        const bpm = parseMusicXml(xml).map((m) =>
            m.beats.map((b) => 60 / b.duration),
        );
        expect(bpm[1]![0]).toBeCloseTo(132, 9);
        expect(bpm[1]![3]).toBeCloseTo(132 + 32 * (3 / 4), 9);
        expect(bpm[3]).toEqual([132, 132, 132, 132]);
    });

    it('warns about "a tempo" with no rit. or accel. before it', () => {
        const xml = score(head + measure(2, words("a tempo") + rest(4)));
        expect(codes(xml)).toEqual(["a-tempo-unknown"]);
    });
});

describe("things the counts can't show", () => {
    it("warns about fermatas, repeats and D.C.", () => {
        const xml = score(
            measure(
                1,
                time(4, 4) + museScoreTempo("quarter", 0, 120, 120) + rest(4),
            ) +
                measure(
                    2,
                    `<note><pitch><step>C</step><octave>5</octave></pitch><duration>1920</duration><voice>1</voice><type>whole</type><notations><fermata type="upright"/></notations></note>` +
                        `<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>`,
                ) +
                measure(
                    3,
                    rest(4) +
                        `<direction><direction-type><words>D.C. al Fine</words></direction-type><sound dacapo="yes"/></direction>`,
                ),
        );
        expect(codes(xml)).toEqual(["fermata", "repeat", "jump"]);
    });
});

describe("summary", () => {
    it("counts measures, tempo changes, marks, meter changes and warnings", () => {
        const xml = score(
            measure(
                0,
                time(4, 4) + museScoreTempo("quarter", 0, 132, 132) + note(1),
                { implicit: true },
            ) +
                measure(1, rehearsal("A") + rest(4)) +
                measure(
                    2,
                    time(6, 8) +
                        rehearsal("B") +
                        museScoreTempo("quarter", 1, 88, 132) +
                        rest(3),
                ) +
                measure(
                    3,
                    time("2+2+3", 8) +
                        rehearsal("C") +
                        museScoreTempo("quarter", 0, 152.5, 152.5) +
                        rest(3.5),
                ) +
                measure(
                    4,
                    time(4, 4) + rehearsal("D") + words("rit.") + rest(4),
                ) +
                measure(5, words("a tempo") + rest(4)),
        );
        const { summary } = parseMusicXmlWithReport(xml);
        expect(summary).toMatchObject({
            measures: 6,
            counts: 1 + 4 + 2 + 3 + 4 + 4,
            tempoChanges: 1,
            ramps: 0,
            meterChanges: 3,
            rehearsalMarks: ["A", "B", "C", "D"],
            warnings: 1,
        });
    });

    it("reads only the first part of a multi-part score", () => {
        const xml = score(
            measure(
                1,
                time(4, 4) + museScoreTempo("quarter", 0, 120, 120) + rest(4),
            ),
            3,
        );
        expect(parseMusicXml(xml)).toHaveLength(1);
    });
});
