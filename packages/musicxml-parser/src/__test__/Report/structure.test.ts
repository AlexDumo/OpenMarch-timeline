import { describe, expect, it } from "vitest";
import { parseMusicXmlWithReport } from "../../parser";
import {
    measure,
    museScoreTempo,
    rehearsal,
    rest,
    score,
    time,
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
});

describe("tempo marks", () => {
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
