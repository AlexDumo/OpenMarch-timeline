import { describe, expect, it } from "vitest";
import { defaultGroups, meterFromTimeSignature } from "../../meter";
import {
    formatTempoMarking,
    markingFromQuarterBpm,
    readPerMinute,
    readTempoWords,
    unitQuarters,
} from "../../tempo";

describe("defaultGroups", () => {
    it.each([
        [1, [1]],
        [2, [2]],
        [3, [3]],
        [4, [2, 2]],
        [5, [3, 2]],
        [6, [3, 3]],
        [7, [2, 2, 3]],
        [8, [3, 3, 2]],
        [9, [3, 3, 3]],
        [10, [3, 3, 2, 2]],
        [11, [3, 3, 3, 2]],
        [13, [3, 3, 3, 2, 2]],
    ])("splits %i eighths into %j", (n, groups) => {
        expect(defaultGroups(n)).toEqual(groups);
        expect(groups.reduce((a, b) => a + b, 0)).toBe(n);
    });
});

describe("meterFromTimeSignature", () => {
    it("counts each part of a composite signature in order", () => {
        expect(
            meterFromTimeSignature([
                { beats: "3", beatType: "4" },
                { beats: "3", beatType: "8" },
            ]),
        ).toEqual({
            text: "3/4+3/8",
            counts: [1, 1, 1, 1.5],
            grouping: "1+1+1+3",
            assumedGrouping: false,
        });
    });

    it("rejects what the rule doesn't cover", () => {
        expect(meterFromTimeSignature([{ beats: "4", beatType: "3" }])).toBe(
            undefined,
        );
        expect(meterFromTimeSignature([{ beats: "x", beatType: "4" }])).toBe(
            undefined,
        );
        expect(meterFromTimeSignature([])).toBe(undefined);
    });
});

describe("tempo reading", () => {
    it.each([
        ["132", { ok: true, value: 132, approximate: false }],
        ["127.5", { ok: true, value: 127.5, approximate: false }],
        ["127,5", { ok: true, value: 127.5, approximate: false }],
        ["c. 132", { ok: true, value: 132, approximate: true }],
        ["126-132", { ok: true, value: 126, approximate: true }],
        ["fast", { ok: false }],
        ["0", { ok: false }],
        ["", { ok: false }],
    ])("reads per-minute %j", (text, expected) => {
        expect(readPerMinute(text)).toEqual(expected);
    });

    it("gives dotted and double-dotted lengths in quarters", () => {
        expect(unitQuarters("quarter", 1)).toBe(1.5);
        expect(unitQuarters("half", 2)).toBe(3.5);
        expect(unitQuarters("eighth")).toBe(0.5);
    });

    it("shows a quarter tempo in the meter's own count when the file has no unit", () => {
        expect(formatTempoMarking(markingFromQuarterBpm(132, [1.5, 1.5]))).toBe(
            "♩. = 88",
        );
        expect(formatTempoMarking(markingFromQuarterBpm(132, [2, 2]))).toBe(
            "half = 66",
        );
        expect(
            formatTempoMarking(markingFromQuarterBpm(176, [1, 1, 1.5])),
        ).toBe("♩ = 176");
    });

    it.each([
        ["rit.", "slower"],
        ["poco a poco rall.", "slower"],
        ["molto ritard.", "slower"],
        ["accel.", "faster"],
        ["a tempo", "a-tempo"],
        ["Tempo I", "tempo-primo"],
        ["Allegro", "tempo-word"],
        ["cresc.", undefined],
        ["Strings only", undefined],
    ])("classifies %j", (text, kind) => {
        expect(readTempoWords(text)?.kind).toBe(kind);
    });
});
