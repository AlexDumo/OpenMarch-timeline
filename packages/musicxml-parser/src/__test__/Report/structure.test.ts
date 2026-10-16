import { describe, expect, it } from "vitest";
import { parseMusicXmlWithReport } from "../../parser";
import {
    measure,
    museScoreTempo,
    note,
    rehearsal,
    rest,
    score,
    sibeliusTempo,
    time,
    words,
} from "./scoreBuilders";

const seconds = (xml: string, options = {}) =>
    parseMusicXmlWithReport(xml, options).measures.map((m) =>
        m.beats.map((b) => Number(b.duration.toFixed(4))),
    );
const order = (xml: string) =>
    parseMusicXmlWithReport(xml).measures.map(
        (m) => `${m.label}${m.time! > 1 ? `x${m.time}` : ""}`,
    );
const codes = (xml: string) =>
    parseMusicXmlWithReport(xml).warnings.map((w) => w.code);

const backward = `<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>`;
const forward = `<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>`;
const endingStart = (n: string) =>
    `<barline location="left"><ending number="${n}" type="start">${n}.</ending></barline>`;
const endingStop = (n: string, type = "stop") =>
    `<barline location="right"><ending number="${n}" type="${type}"/>${type === "stop" ? `<repeat direction="backward"/>` : ""}</barline>`;

describe("parts", () => {
    it("reads a tempo that only a later part has (Finale puts it on the piano)", () => {
        const voice = measure(1, time(2, 4) + rest(2));
        const piano = measure(
            1,
            time(2, 4) + museScoreTempo("quarter", 0, 60, 60) + rest(2),
        );
        const xml = score("").replace(
            /<part id="P1"><\/part>/,
            `<part id="P1">${voice}</part><part id="P2">${piano}</part>`,
        );
        expect(seconds(xml)).toEqual([[1, 1]]);
        expect(codes(xml)).not.toContain("no-tempo");
    });

    it("counts a mark written in every part once", () => {
        const m =
            measure(1, time(4, 4) + rehearsal("A") + rest(4)) +
            measure(
                2,
                `<direction><direction-type><words>rit.</words></direction-type></direction>` +
                    rest(4),
            );
        const result = parseMusicXmlWithReport(score(m, 3));
        expect(result.ramps).toHaveLength(1);
        expect(result.summary.rehearsalMarks).toEqual(["A"]);
    });

    it("counts a mark written twice on one spot of one part (once per staff) once", () => {
        const rit = `<direction><direction-type><words>rit.</words></direction-type></direction>`;
        const m =
            measure(1, time(4, 4) + rest(4)) +
            measure(2, rit + rit + rest(4)) +
            measure(3, museScoreTempo("quarter", 0, 60, 60) + rest(4));
        expect(parseMusicXmlWithReport(score(m)).ramps).toHaveLength(1);
    });
});

describe("tempo marks", () => {
    it("keeps a tempo written again later in the same measure", () => {
        const m1 =
            museScoreTempo("quarter", 0, 120, 120) +
            note(1) +
            museScoreTempo("quarter", 0, 100, 100) +
            note(2) +
            museScoreTempo("quarter", 0, 120, 120) +
            note(1);
        const xml = score(measure(1, time(4, 4) + m1) + measure(2, rest(4)));
        expect(seconds(xml)).toEqual([
            [0.5, 0.6, 0.6, 0.5],
            [0.5, 0.5, 0.5, 0.5],
        ]);
    });

    it("reads a beat unit tied to another (MusicXML 4 <beat-unit-tied>)", () => {
        // ♩ tied to ♪ = 40: a beat of 1.5 quarters, 40 times a minute, is 60 quarters a minute
        const tied = `<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-tied><beat-unit>eighth</beat-unit></beat-unit-tied><per-minute>40</per-minute></metronome></direction-type></direction>`;
        expect(seconds(score(measure(1, time(2, 4) + tied + rest(2))))).toEqual(
            [[1, 1]],
        );
    });

    it("keeps the tempo for a modulation whose two sides are as long (♩. ⁀ ♪ = 𝅗𝅥)", () => {
        const start = museScoreTempo("quarter", 0, 60, 60);
        const modulation = `<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><beat-unit-tied><beat-unit>eighth</beat-unit></beat-unit-tied><beat-unit>half</beat-unit></metronome></direction-type></direction>`;
        const xml = score(
            measure(1, time(2, 4) + start + rest(2)) +
                measure(2, modulation + rest(2)),
        );
        expect(seconds(xml)).toEqual([
            [1, 1],
            [1, 1],
        ]);
    });

    it("doesn't read a swing mark (<metronome-note>) as a tempo", () => {
        const swing = `<direction><direction-type><metronome><metronome-note><metronome-type>eighth</metronome-type></metronome-note><metronome-note><metronome-type>eighth</metronome-type></metronome-note><metronome-relation>equals</metronome-relation><metronome-note><metronome-type>quarter</metronome-type></metronome-note></metronome></direction-type></direction>`;
        const xml = score(
            measure(
                1,
                time(2, 4) + museScoreTempo("quarter", 0, 60, 60) + rest(2),
            ) + measure(2, swing + rest(2)),
        );
        expect(seconds(xml)).toEqual([
            [1, 1],
            [1, 1],
        ]);
    });
});

describe("meters", () => {
    it("reads an alternate signature shown next to the real one (<interchangeable>) as the real one", () => {
        const alternate = `<attributes><divisions>480</divisions><time><beats>3</beats><beat-type>4</beat-type><interchangeable><time-relation>parentheses</time-relation><beats>6</beats><beat-type>8</beat-type></interchangeable></time></attributes>`;
        const result = parseMusicXmlWithReport(
            score(measure(1, alternate + rest(3))),
        );
        expect(result.measures[0]!.meter!.text).toBe("3/4");
        expect(result.measures[0]!.beats).toHaveLength(3);
    });
});

describe("repeats and jumps", () => {
    const tempo = museScoreTempo("quarter", 0, 60, 60);

    it("plays first and second endings, numbering each play", () => {
        const xml = score(
            measure(1, time(2, 4) + tempo + forward + rest(2)) +
                measure(2, endingStart("1") + rest(2) + endingStop("1")) +
                measure(
                    3,
                    endingStart("2") + rest(2) + endingStop("2", "discontinue"),
                ) +
                measure(4, rest(2)),
        );
        expect(order(xml)).toEqual(["1", "2", "1x2", "3", "4"]);
        const result = parseMusicXmlWithReport(xml);
        expect(result.summary).toMatchObject({
            measures: 5,
            writtenMeasures: 4,
            counts: 10,
            durationSeconds: 10,
        });
        expect(codes(xml)).toContain("repeat-played");
    });

    it("plays D.S. al Coda from the playback marks", () => {
        const xml = score(
            measure(1, time(2, 4) + tempo + rest(2)) +
                measure(
                    2,
                    `<direction><direction-type><segno/></direction-type><sound segno="segno"/></direction>` +
                        rest(2),
                ) +
                measure(
                    3,
                    rest(2) +
                        `<direction><direction-type><words>To Coda</words></direction-type><sound tocoda="coda"/></direction>`,
                ) +
                measure(
                    4,
                    rest(2) +
                        `<direction><direction-type><words>D.S. al Coda</words></direction-type><sound dalsegno="segno"/></direction>`,
                ) +
                measure(
                    5,
                    `<direction><direction-type><coda/></direction-type><sound coda="coda"/></direction>` +
                        rest(2),
                ),
        );
        expect(order(xml)).toEqual(["1", "2", "3", "4", "2x2", "3x2", "5"]);
        expect(codes(xml)).not.toContain("navigation-from-words");
    });

    it("plays D.S. al Coda from symbols and words, and asks to check it", () => {
        // How a file reads when it has no playback marks: two coda symbols and the D.S. words
        const xml = score(
            measure(1, time(2, 4) + tempo + rest(2)) +
                measure(
                    2,
                    `<direction><direction-type><segno/></direction-type></direction>` +
                        rest(2),
                ) +
                measure(
                    3,
                    rest(2) +
                        `<direction><direction-type><coda/></direction-type></direction>`,
                ) +
                measure(
                    4,
                    rest(2) +
                        `<direction><direction-type><words>D.S. al Coda</words></direction-type></direction>`,
                ) +
                measure(
                    5,
                    `<direction><direction-type><coda/></direction-type></direction>` +
                        rest(2),
                ),
        );
        expect(order(xml)).toEqual(["1", "2", "3", "4", "2x2", "3x2", "5"]);
        expect(codes(xml)).toContain("navigation-from-words");
    });

    it("keeps the written order with repeats: once", () => {
        const xml = score(
            measure(1, time(2, 4) + tempo + rest(2) + backward) +
                measure(2, rest(2)),
        );
        expect(
            parseMusicXmlWithReport(xml, { repeats: "once" }).measures.map(
                (m) => m.label,
            ),
        ).toEqual(["1", "2"]);
        expect(order(xml)).toEqual(["1", "1x2", "2"]);
    });

    it("doesn't warn about measure numbers in a file that has none", () => {
        const xml = score(
            `<measure>${time(2, 4) + rest(2)}</measure><measure>${rest(2)}</measure>`,
        );
        expect(codes(xml)).not.toContain("measure-numbers");
    });
});

describe("tempo at the end of a repeat", () => {
    it("plays a tempo written after the last count before the repeat sign after the repeat, not on the way back", () => {
        const xml = score(
            measure(
                1,
                time(4, 4) + museScoreTempo("quarter", 0, 120, 120) + rest(4),
            ) +
                measure(
                    2,
                    rest(4) + museScoreTempo("quarter", 0, 80, 80) + backward,
                ) +
                measure(3, rest(4)),
        );
        const half = [0.5, 0.5, 0.5, 0.5];
        expect(seconds(xml)).toEqual([
            half,
            half,
            half,
            half,
            [0.75, 0.75, 0.75, 0.75],
        ]);
    });
});

describe("short measures", () => {
    const tempo = museScoreTempo("quarter", 0, 60, 60);

    it("gives a short last measure only the counts its music fills", () => {
        const xml = score(
            measure(1, time(4, 4) + tempo + rest(4)) + measure(2, rest(3)),
        );
        expect(seconds(xml)).toEqual([
            [1, 1, 1, 1],
            [1, 1, 1],
        ]);
        expect(codes(xml)).toContain("short-measure");
    });

    it("reads a short first measure as a pickup even when it isn't marked implicit", () => {
        const xml = score(
            measure(0, time(4, 4) + tempo + rest(1)) + measure(1, rest(4)),
        );
        expect(seconds(xml)[0]).toEqual([1]);
        expect(codes(xml)).toContain("pickup");
    });

    it("gives the measure that completes a rounded pickup the counts the pickup didn't take", () => {
        // 6/8 with an eighth-note pickup: the pickup rounds up to one dotted-quarter count, and
        // the last measure (five eighths) gets the other count, so the repeat stays in time
        const xml = score(
            measure(0, time(6, 8) + tempo + rest(0.5), { implicit: true }) +
                measure(1, rest(3)) +
                measure(2, rest(2.5) + backward),
        );
        const result = parseMusicXmlWithReport(xml);
        expect(result.measures.map((m) => m.beats.length)).toEqual([
            1, 2, 1, 1, 2, 1,
        ]);
        expect(codes(xml)).toContain("completes-pickup");
    });

    it("keeps a count for a short measure after a pickup rounded up to the whole measure", () => {
        // 6/8 with a five-eighth pickup: it rounds up to both counts, so the one-eighth last
        // measure can't complete it and is just short
        const xml = score(
            measure(0, time(6, 8) + tempo + rest(2.5), { implicit: true }) +
                measure(1, rest(3)) +
                measure(2, rest(0.5)),
        );
        const result = parseMusicXmlWithReport(xml);
        expect(result.measures.map((m) => m.beats.length)).toEqual([2, 2, 1]);
        expect(codes(xml)).not.toContain("completes-pickup");
    });

    it("treats a measure a rounding error short as full", () => {
        // Triplets written as 160 + 160 + 159 divisions
        const xml = score(
            measure(
                1,
                time(1, 4) +
                    tempo +
                    `<note><rest/><duration>479</duration><voice>1</voice></note>`,
            ),
        );
        expect(codes(xml)).not.toContain("short-measure");
    });
});

describe("unnumbered endings", () => {
    it("plays unnumbered brackets in the order they are written", () => {
        const tempo = museScoreTempo("quarter", 0, 60, 60);
        const xml = score(
            measure(1, time(2, 4) + tempo + rest(2)) +
                measure(2, endingStart("") + rest(2) + endingStop("")) +
                measure(
                    3,
                    endingStart("") + rest(2) + endingStop("", "discontinue"),
                ),
        );
        expect(order(xml)).toEqual(["1", "2", "1x2", "3"]);
    });
});

describe("long measures", () => {
    it("gives a measure with more music than its meter extra counts, and warns", () => {
        const tempo = museScoreTempo("quarter", 0, 60, 60);
        const xml = score(measure(1, time(4, 4) + tempo + rest(6)));
        expect(seconds(xml)).toEqual([[1, 1, 1, 1, 1, 1]]);
        expect(codes(xml)).toContain("long-measure");
    });
});

describe("printed and played tempo", () => {
    it("plays <sound tempo> when the printed mark differs, and says so", () => {
        // Clara Schumann's Polonaise op. 1 no. 4 prints ♩ = 92 and plays 112
        const xml = score(
            measure(
                1,
                time(3, 4) + museScoreTempo("quarter", 0, 92, 112) + rest(3),
            ),
        );
        const result = parseMusicXmlWithReport(xml);
        expect(result.measures[0]!.beats[0]!.duration).toBeCloseTo(60 / 112);
        expect(result.measures[0]!.tempo!.perMinute).toBeCloseTo(112);
        expect(result.warnings.map((w) => w.message)).toContain(
            "m1: The score shows ♩ = 92 but plays ♩ = 112; used ♩ = 112",
        );
    });
});

describe("no time signature", () => {
    it("counts each measure in quarters, as long as its music", () => {
        const divisions = `<attributes><divisions>480</divisions></attributes>`;
        const tempo = museScoreTempo("quarter", 0, 60, 60);
        const xml = score(
            measure(1, divisions + tempo + rest(2)) +
                measure(2, rest(2)) +
                measure(3, rest(5)),
        );
        expect(seconds(xml)).toEqual([
            [1, 1],
            [1, 1],
            [1, 1, 1, 1, 1],
        ]);
        expect(codes(xml)).toEqual(["no-time-signature"]);
    });
});

describe("unusual tempos", () => {
    it("warns about a tempo too slow or fast to be meant", () => {
        const xml = score(
            measure(
                1,
                time(4, 4) + museScoreTempo("quarter", 0, 5, 5) + rest(4),
            ),
        );
        expect(codes(xml)).toContain("unusual-tempo");
    });
});

describe("exporter quirks", () => {
    it("reads Sibelius's D.S. al Fine, written with only a fine= sound, as the D.S.", () => {
        const tempo = museScoreTempo("quarter", 0, 60, 60);
        const xml = score(
            measure(1, time(2, 4) + tempo + rest(2)) +
                measure(
                    2,
                    `<direction><direction-type><segno/></direction-type></direction>` +
                        rest(2),
                ) +
                measure(
                    3,
                    rest(2) +
                        `<direction><direction-type><words>Fine</words></direction-type><sound fine="3"/></direction>`,
                ) +
                measure(
                    4,
                    rest(2) +
                        `<direction><direction-type><words>D.S. al Fine</words></direction-type><sound fine="4"/></direction>`,
                ),
        );
        expect(order(xml)).toEqual(["1", "2", "3", "4", "2x2", "3x2"]);
    });
});

describe("<sound tempo> mistakes", () => {
    it("uses the printed ♩. = 120 when Notion writes it as tempo=120", () => {
        const xml = score(
            measure(
                1,
                time(6, 8) + museScoreTempo("quarter", 1, 120, 120) + rest(3),
            ),
        );
        const result = parseMusicXmlWithReport(xml);
        expect(result.measures[0]!.beats[0]!.duration).toBeCloseTo(0.5);
        expect(codes(xml)).toContain("sound-tempo-ignored");
    });

    it("uses the printed ♩ = 76 when the file plays 7602", () => {
        const xml = score(
            measure(
                1,
                time(4, 4) + museScoreTempo("quarter", 0, 76, 7602) + rest(4),
            ),
        );
        expect(seconds(xml)[0]![0]).toBeCloseTo(60 / 76, 3);
    });

    it("still plays a <sound tempo> that differs from the print but could be meant", () => {
        const xml = score(
            measure(
                1,
                time(4, 4) + museScoreTempo("quarter", 0, 180, 80) + rest(4),
            ),
        );
        expect(seconds(xml)[0]![0]).toBeCloseTo(0.75);
        expect(codes(xml)).toContain("printed-tempo-differs");
    });
});

describe("divisions", () => {
    it("uses divisions written after the first note from the start of the measure", () => {
        const late = `<note><rest/><duration>960</duration><voice>1</voice></note><attributes><divisions>480</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>`;
        const xml = score(
            measure(1, museScoreTempo("quarter", 0, 60, 60) + late) +
                measure(2, rest(2)),
        );
        expect(seconds(xml)).toEqual([
            [1, 1],
            [1, 1],
        ]);
    });
});

describe("missing divisions", () => {
    it("works out the divisions of a part that never gives them (MEI converters leave them out)", () => {
        const noDivisions = (n: number) =>
            measure(
                n,
                (n === 1
                    ? `<attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>` +
                      museScoreTempo("quarter", 0, 60, 60)
                    : "") +
                    `<note><rest/><duration>960</duration><voice>1</voice></note>`.repeat(
                        4,
                    ),
            );
        const xml = score(noDivisions(1) + noDivisions(2));
        expect(seconds(xml)).toEqual([
            [1, 1, 1, 1],
            [1, 1, 1, 1],
        ]);
    });
});

describe("repeated measures", () => {
    const tempo = museScoreTempo("quarter", 0, 60, 60);

    it("reports a measure's tempo warnings once, not on every pass", () => {
        // Too slow to be meant, and a rit. with nothing to arrive at, in a repeated section
        const xml = score(
            measure(
                1,
                time(4, 4) + museScoreTempo("quarter", 0, 5, 5) + rest(4),
            ) +
                measure(2, words("rit.") + rest(4) + backward) +
                measure(3, rest(4)),
        );
        expect(order(xml)).toEqual(["1", "2", "1x2", "2x2", "3"]);
        const warned = codes(xml);
        expect(warned.filter((c) => c === "unusual-tempo")).toHaveLength(1);
        expect(warned.filter((c) => c === "ramp-not-applied")).toHaveLength(1);
    });

    it("gives the measure that completes the pickup the same counts on every pass", () => {
        // 4/4 with a pickup of 1.5 quarters (rounded up to two counts); the last measure (2.5
        // quarters) completes it with the other two counts, the first time and the second
        const xml = score(
            measure(0, time(4, 4) + tempo + rest(1.5), { implicit: true }) +
                measure(1, forward + rest(4)) +
                measure(2, rest(2.5) + backward),
        );
        expect(order(xml)).toEqual(["0", "1", "2", "1x2", "2x2"]);
        expect(
            parseMusicXmlWithReport(xml).measures.map((m) => m.beats.length),
        ).toEqual([2, 4, 2, 4, 2]);
    });
});

describe("state after a repeat or jump", () => {
    it("plays a measure again in its written meter, not the one the section ended in", () => {
        // 6/8 | ||: 2 (6/8, inherited) | 3/4 3 :|| — notation programs play m2 in 6/8 both times
        const xml = score(
            measure(
                1,
                time(6, 8) + museScoreTempo("quarter", 1, 80, 120) + rest(3),
            ) +
                measure(2, forward + rest(3)) +
                measure(3, time(3, 4) + rest(3) + backward),
        );
        const { measures, warnings } = parseMusicXmlWithReport(xml);
        expect(
            measures.map((m) => `${m.label}x${m.time} ${m.meter?.text}`),
        ).toEqual(["1x1 6/8", "2x1 6/8", "3x1 3/4", "2x2 6/8", "3x2 3/4"]);
        expect(measures.map((m) => m.beats.length)).toEqual([2, 2, 3, 2, 3]);
        expect(measures.map((m) => m.meterChanged)).toEqual([
            true,
            false,
            true,
            true,
            true,
        ]);
        expect(warnings.filter((w) => w.code === "long-measure")).toEqual([]);
    });

    it("plays a measure again at its written tempo, not the one the section ended at", () => {
        // ♩ = 120 | ||: 2 | ♩ = 90 3 :|| 4 — the second pass starts at 120 again
        const xml = score(
            measure(
                1,
                time(4, 4) + museScoreTempo("quarter", 0, 120, 120) + rest(4),
            ) +
                measure(2, forward + rest(4)) +
                measure(
                    3,
                    museScoreTempo("quarter", 0, 90, 90) + rest(4) + backward,
                ) +
                measure(4, rest(4)),
        );
        expect(order(xml)).toEqual(["1", "2", "3", "2x2", "3x2", "4"]);
        expect(seconds(xml).map((beats) => beats[0])).toEqual([
            0.5, 0.5, 0.6667, 0.5, 0.6667, 0.6667,
        ]);
        const { summary } = parseMusicXmlWithReport(xml);
        expect(summary.tempoChanges).toBe(3);
    });

    it("goes back to the segno's tempo after D.S.", () => {
        // ♩ = 100 | §2 | ♩ = 150 3 D.S. al Fine — m2 is played at 100 again
        const xml = score(
            measure(
                1,
                time(4, 4) + museScoreTempo("quarter", 0, 100, 100) + rest(4),
            ) +
                measure(
                    2,
                    `<direction><direction-type><segno/></direction-type><sound segno="segno"/></direction>` +
                        rest(4) +
                        `<direction><direction-type><words>Fine</words></direction-type><sound fine="yes"/></direction>`,
                ) +
                measure(
                    3,
                    museScoreTempo("quarter", 0, 150, 150) +
                        rest(4) +
                        `<direction><direction-type><words>D.S. al Fine</words></direction-type><sound dalsegno="segno"/></direction>`,
                ),
        );
        expect(order(xml)).toEqual(["1", "2", "3", "2x2"]);
        expect(seconds(xml).map((beats) => beats[0])).toEqual([
            0.6, 0.6, 0.4, 0.6,
        ]);
    });
});

describe("x/2 meters", () => {
    it("reports a meter change when a restated x/2 meter starts counting in quarters", () => {
        const xml = score(
            measure(1, time(3, 2) + sibeliusTempo("half", 0, 60) + rest(6)) +
                measure(
                    2,
                    sibeliusTempo("quarter", 0, 120) + time(3, 2) + rest(6),
                ),
        );
        const report = parseMusicXmlWithReport(xml);
        expect(report.measures.map((m) => m.beats.length)).toEqual([3, 6]);
        expect(report.measures[1]!.meterChanged).toBe(true);
        expect(report.summary.meterChanges).toBe(1);
    });
});

describe("unreadable first meter", () => {
    it("warns once about a first meter it can't read, naming it", () => {
        const xml = score(
            measure(
                1,
                `<attributes><divisions>480</divisions><time><senza-misura/></time></attributes>` +
                    museScoreTempo("quarter", 0, 60, 60) +
                    rest(3),
            ),
        );
        const report = parseMusicXmlWithReport(xml);
        expect(report.warnings.map((w) => w.message)).toEqual([
            "m1: senza misura isn't a meter OpenMarch can count; each measure counted in quarter notes, as long as its music",
        ]);
        expect(seconds(xml)).toEqual([[1, 1, 1]]);
    });
});

describe("divisions given late", () => {
    it("reads the measures before a part's first <divisions> with that divisions", () => {
        const whole = (n: number) =>
            `<note><rest/><duration>${n}</duration><voice>1</voice></note>`;
        const xml = score(
            measure(
                1,
                `<attributes><time><beats>2</beats><beat-type>4</beat-type></time></attributes>` +
                    museScoreTempo("quarter", 0, 60, 60) +
                    whole(480) +
                    whole(480),
            ) +
                measure(
                    2,
                    `<attributes><divisions>480</divisions></attributes>` +
                        whole(960),
                ),
        );
        expect(seconds(xml)).toEqual([
            [1, 1],
            [1, 1],
        ]);
        expect(codes(xml)).not.toContain("long-measure");
    });
});

describe("rit. targets", () => {
    it("looks past tempo words for the tempo a rit. arrives at", () => {
        const xml = score(
            measure(
                1,
                time(4, 4) + museScoreTempo("quarter", 0, 120, 120) + rest(4),
            ) +
                measure(2, words("rit.") + rest(4)) +
                measure(3, words("Maestoso") + rest(4)) +
                measure(4, museScoreTempo("quarter", 0, 80, 80) + rest(4)),
        );
        expect(parseMusicXmlWithReport(xml).ramps).toMatchObject([
            { applied: true, targetMeasureIndex: 3, toQuarterBpm: 80 },
        ]);
    });
});
