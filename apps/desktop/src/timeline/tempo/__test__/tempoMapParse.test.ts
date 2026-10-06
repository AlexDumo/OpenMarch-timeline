import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
    BEAT_UNITS,
    convertBpm,
    defaultUnit,
    formatBpm,
    formatMeter,
    formatTempo,
    MAX_TYPED_BPM,
    meterCounts,
    meterFromWeights,
    meterWeights,
    parseBeatUnit,
    parseMeterCell,
    parseRampCell,
    parseTempoCell,
    UNIT_GLYPH,
    type BeatUnit,
} from "../tempoMapParse";

/** Tempos as people type them: up to three decimals. */
const typedBpm = fc
    .integer({ min: 1, max: MAX_TYPED_BPM * 1000 })
    .map((n) => n / 1000);
const unit = fc.constantFrom<BeatUnit>(...BEAT_UNITS);

describe("parseBeatUnit", () => {
    it.each([
        ["q", "q"],
        ["♩", "q"],
        ["Q", "q"],
        ["quarter", "q"],
        ["♩.", "dq"],
        ["q.", "dq"],
        ["dq", "dq"],
        ["dotted quarter", "dq"],
        ["e", "e"],
        ["♪", "e"],
        ["8th", "e"],
        ["♪.", "de"],
        ["h", "h"],
        ["dh", "dh"],
        ["s", "s"],
    ] as const)("reads %s as %s", (text, expected) => {
        expect(parseBeatUnit(text)).toBe(expected);
    });

    it.each(["", "x", "ds", "s.", "dd", "152"])("rejects %j", (text) => {
        expect(parseBeatUnit(text)).toBeNull();
    });

    it("reads every unit's glyph back", () => {
        for (const u of BEAT_UNITS)
            if (u !== "s") expect(parseBeatUnit(UNIT_GLYPH[u])).toBe(u);
    });
});

describe("parseTempoCell", () => {
    it.each([
        ["152.5", { kind: "tempo", bpm: 152.5, unit: null }],
        ["152,5", { kind: "tempo", bpm: 152.5, unit: null }],
        [" 152.5 bpm ", { kind: "tempo", bpm: 152.5, unit: null }],
        ["♩=152.5", { kind: "tempo", bpm: 152.5, unit: "q" }],
        ["q=152.5", { kind: "tempo", bpm: 152.5, unit: "q" }],
        ["q = 152.5", { kind: "tempo", bpm: 152.5, unit: "q" }],
        ["dq=176", { kind: "tempo", bpm: 176, unit: "dq" }],
        ["♩.=176", { kind: "tempo", bpm: 176, unit: "dq" }],
        ["e=352", { kind: "tempo", bpm: 352, unit: "e" }],
        ["♪=352", { kind: "tempo", bpm: 352, unit: "e" }],
        ["=152.5", { kind: "tempo", bpm: 152.5, unit: null }],
        ["♩.=♩", { kind: "relation", unit: "dq", previousUnit: "q" }],
        ["dq=q", { kind: "relation", unit: "dq", previousUnit: "q" }],
        ["e=e", { kind: "relation", unit: "e", previousUnit: "e" }],
        ["=prev", { kind: "previous" }],
        ["prev", { kind: "previous" }],
        ["=", { kind: "previous" }],
    ] as const)("reads %j", (text, expected) => {
        expect(parseTempoCell(text)).toEqual(expected);
    });

    it.each([
        ["", "empty"],
        ["fast", "unreadable"],
        ["x=120", "unreadable"],
        ["=♩", "unreadable"],
        ["0", "notPositive"],
        ["120.5.5", "unreadable"],
        ["-5", "unreadable"],
        [String(MAX_TYPED_BPM + 1), "tooFast"],
    ])("refuses %j (%s)", (text, error) => {
        expect(parseTempoCell(text)).toEqual({ kind: "error", error });
    });

    it("reads any typed decimal back exactly, alone or with a unit", () => {
        fc.assert(
            fc.property(typedBpm, unit, (bpm, u) => {
                expect(parseTempoCell(String(bpm))).toEqual({
                    kind: "tempo",
                    bpm,
                    unit: null,
                });
                expect(parseTempoCell(`${u}=${bpm}`)).toEqual({
                    kind: "tempo",
                    bpm,
                    unit: u,
                });
            }),
        );
    });

    it("reads what formatTempo shows for an exact tempo", () => {
        fc.assert(
            fc.property(
                typedBpm,
                unit.filter((u) => u !== "s"),
                (bpm, u) => {
                    const cell = parseTempoCell(formatTempo(u, bpm, true));
                    expect(cell).toEqual({
                        kind: "tempo",
                        bpm: Number(formatBpm(bpm)),
                        unit: u,
                    });
                },
            ),
        );
    });

    it("never throws, whatever is typed", () => {
        fc.assert(
            fc.property(fc.string(), (text) => {
                const cell = parseTempoCell(text);
                if (cell.kind === "tempo") {
                    expect(cell.bpm).toBeGreaterThan(0);
                    expect(cell.bpm).toBeLessThanOrEqual(MAX_TYPED_BPM);
                }
            }),
        );
    });
});

describe("parseRampCell", () => {
    it.each([
        ["", { kind: "clear" }],
        ["-", { kind: "clear" }],
        ["a tempo", { kind: "clear" }],
        ["100", { kind: "ramp", bpm: 100, unit: null }],
        ["rit. to ♩=100", { kind: "ramp", bpm: 100, unit: "q" }],
        ["rit 100", { kind: "ramp", bpm: 100, unit: null }],
        ["rall. to 90", { kind: "ramp", bpm: 90, unit: null }],
        ["accel. to 141", { kind: "ramp", bpm: 141, unit: null }],
        ["to q.=60", { kind: "ramp", bpm: 60, unit: "dq" }],
    ] as const)("reads %j", (text, expected) => {
        expect(parseRampCell(text)).toEqual(expected);
    });

    it("refuses relations and nonsense", () => {
        expect(parseRampCell("rit. to ♩.=♩").kind).toBe("error");
        expect(parseRampCell("slower").kind).toBe("error");
    });
});

describe("meters", () => {
    it.each([
        ["4/4", { top: 4, bottom: 4, groups: null }, "4/4", 4],
        ["3/2", { top: 3, bottom: 2, groups: null }, "3/2", 3],
        ["6/8", { top: 6, bottom: 8, groups: [3, 3] }, "6/8", 2],
        ["12/8", { top: 12, bottom: 8, groups: [3, 3, 3, 3] }, "12/8", 4],
        ["7/8 2+2+3", { top: 7, bottom: 8, groups: [2, 2, 3] }, "7/8 2+2+3", 3],
        [
            "7/8 (2+2+3)",
            { top: 7, bottom: 8, groups: [2, 2, 3] },
            "7/8 2+2+3",
            3,
        ],
        ["3+2", { top: 5, bottom: 8, groups: [3, 2] }, "5/8 3+2", 2],
        ["5/8", { top: 5, bottom: 8, groups: [1, 1, 1, 1, 1] }, "5/8", 5],
    ] as const)("reads %j", (text, meter, shown, counts) => {
        const cell = parseMeterCell(text);
        expect(cell).toEqual({ kind: "meter", meter });
        if (cell.kind !== "meter") return;
        expect(formatMeter(cell.meter)).toBe(shown);
        expect(meterCounts(cell.meter)).toBe(counts);
    });

    it.each([
        ["", "empty"],
        ["four", "unreadable"],
        ["4/3", "unreadable"],
        ["7/8 2+2+2", "groupsDoNotAdd"],
    ])("refuses %j (%s)", (text, error) => {
        expect(parseMeterCell(text)).toEqual({ kind: "error", error });
    });

    it("re-reads what it shows, with the same counts", () => {
        const groups = fc.array(fc.integer({ min: 1, max: 4 }), {
            minLength: 2,
            maxLength: 6,
        });
        fc.assert(
            fc.property(groups, (g) => {
                const top = g.reduce((a, b) => a + b, 0);
                const cell = parseMeterCell(`${top}/8 ${g.join("+")}`);
                if (cell.kind !== "meter") throw new Error("unread");
                const again = parseMeterCell(formatMeter(cell.meter));
                if (again.kind !== "meter") throw new Error("unread");
                expect(meterWeights(again.meter)).toEqual(
                    meterWeights(cell.meter),
                );
            }),
        );
    });

    it("names counts from their lengths in sixteenths", () => {
        expect(formatMeter(meterFromWeights([4, 4, 4]))).toBe("3/4");
        expect(formatMeter(meterFromWeights([4, 4, 6]))).toBe("7/8 2+2+3");
        expect(formatMeter(meterFromWeights([6, 4]))).toBe("5/8 3+2");
    });

    it("counts compound meters in dotted units", () => {
        const twelve = parseMeterCell("12/8");
        if (twelve.kind !== "meter") throw new Error("unread");
        expect(defaultUnit(twelve.meter)).toBe("dq");
        const seven = parseMeterCell("7/8 2+2+3");
        if (seven.kind !== "meter") throw new Error("unread");
        expect(defaultUnit(seven.meter)).toBe("q");
    });
});

describe("formatting", () => {
    it("shows exact decimals and ≈ for averages", () => {
        expect(formatTempo("q", 152.5, true)).toBe("♩=152.5");
        expect(formatTempo("dq", 176, true)).toBe("♩.=176");
        expect(formatTempo("e", 352, true)).toBe("♪=352");
        expect(formatTempo("q", 131.4321, false)).toBe("♩≈131.4");
        expect(formatBpm(117.33333)).toBe("117.333");
    });

    it("converts between units at the same pulse", () => {
        expect(convertBpm(152.5, "dq", "q")).toBeCloseTo(228.75, 9);
        expect(convertBpm(176, "q", "e")).toBe(352);
    });
});
