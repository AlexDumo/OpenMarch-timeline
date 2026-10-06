import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
    addRowAt,
    deriveTempoMap,
    editRowMeter,
    editRowRamp,
    editRowTempo,
    findMeasure,
    inferMeter,
    marksByMeasure,
    removeRow,
    retimeArgsOf,
    type TempoMapMark,
    type TempoMapMeasure,
} from "../tempoMap";
import { countBpms, rampDurations, setRangeRamp } from "../ramp";
import { formatMeter, parseMeterCell, type Meter } from "../tempoMapParse";
import { countTimes, MIN_COUNT_SECONDS } from "../retime";

/** Measures of `counts` counts each, from count 1, numbered from `first`. */
const measuresOf = (
    countsEach: readonly number[],
    first = 1,
    marks: Record<number, string> = {},
): TempoMapMeasure[] => {
    let at = 1;
    return countsEach.map((counts, i) => {
        const m = {
            number: first + i,
            rehearsalMark: marks[first + i] ?? null,
            firstCount: at,
            counts,
        };
        at += counts;
        return m;
    });
};

const meter = (text: string): Meter => {
    const cell = parseMeterCell(text);
    if (cell.kind !== "meter") throw new Error(text);
    return cell.meter;
};

const state = (
    durations: number[],
    measures: TempoMapMeasure[],
    marks: Map<number, TempoMapMark> = new Map(),
) => ({
    durations,
    measures,
    marks,
    rows: deriveTempoMap({ durations, measures, marks }),
});

const ok = <T extends { ok: boolean }>(r: T) => {
    if (!r.ok) throw new Error(JSON.stringify(r));
    return (r as T & { ok: true; write: unknown }).write as {
        durations: number[];
        marks: Map<number, TempoMapMark>;
        sync: number[];
        unsync: number[];
    };
};

/**
 * Sam's corps chart (the kit's `corps` map, shortened): 4 bars 4/4 ♩=176, 2 bars 7/8 2+2+3,
 * 2 bars 5/8 3+2, 2 bars of 4/4 at ♩=152.5, then 2 bars of 12/8 at ♩.=152.5.
 */
const corps = () => {
    const d: number[] = [0];
    const push = (weights: number[], bpm: number, bars: number) => {
        for (let b = 0; b < bars; b++) d.push(...rampDurations(weights, bpm));
    };
    push([1, 1, 1, 1], 176, 4);
    push([1, 1, 1.5], 176, 2);
    push([1.5, 1], 176, 2);
    push([1, 1, 1, 1], 152.5, 2);
    push([1, 1, 1, 1], 152.5, 2);
    const measures = measuresOf([4, 4, 4, 4, 3, 3, 2, 2, 4, 4, 4, 4], 1, {
        1: "A",
        5: "C",
        7: "D",
        9: "F",
        11: "G",
    });
    return { durations: d, measures };
};

describe("inferMeter", () => {
    it("reads equal counts as n/4", () => {
        expect(inferMeter([0.5, 0.5, 0.5])).toEqual({
            top: 3,
            bottom: 4,
            groups: null,
        });
    });

    it("reads 2:2:3 and 3:2 as groupings in eighths", () => {
        expect(formatMeter(inferMeter([0.4, 0.4, 0.6]))).toBe("7/8 2+2+3");
        expect(formatMeter(inferMeter([0.6, 0.4]))).toBe("5/8 3+2");
    });

    it("doesn't read a rit. or a fermata as a grouping", () => {
        expect(inferMeter(rampDurations([1, 1, 1, 1], 132, 100)).groups).toBe(
            null,
        );
        expect(inferMeter([0.83, 0.83, 0.83, 3.2]).groups).toBe(null);
        expect(inferMeter([0.5, 0.5, 0.5, 4]).groups).toBe(null);
    });
});

describe("rampDurations and setRangeRamp", () => {
    it("plays the first count at the start tempo and the last at the end tempo", () => {
        const d = rampDurations([1, 1, 1, 1, 1, 1, 1, 1], 72, 44);
        const bpms = countBpms(d, Array(8).fill(1));
        expect(bpms[0]).toBeCloseTo(72, 9);
        expect(bpms[7]).toBeCloseTo(44, 9);
        bpms.slice(1).forEach((b, i) => expect(b - bpms[i]).toBeCloseTo(-4, 9));
    });

    it("weights counts by their note value", () => {
        expect(rampDurations([1, 1, 1.5], 120)).toEqual([0.5, 0.5, 0.75]);
    });

    it("changes only the range, so later counts shift", () => {
        const before = [0, 0.5, 0.5, 0.5, 0.5];
        const after = setRangeRamp(before, 1, 3, 120, 60);
        expect(after).toEqual([0, 0.5, 1, 0.5, 0.5]);
        expect(after).toHaveLength(before.length);
    });

    it("is the inverse of countBpms", () => {
        fc.assert(
            fc.property(
                fc.array(fc.constantFrom(0.5, 1, 1.5, 2), {
                    minLength: 1,
                    maxLength: 12,
                }),
                fc.integer({ min: 40, max: 300 }),
                fc.integer({ min: 40, max: 300 }),
                (weights, start, end) => {
                    const bpms = countBpms(
                        rampDurations(weights, start, end),
                        weights,
                    );
                    expect(bpms[0]).toBeCloseTo(start, 6);
                    if (weights.length > 1)
                        expect(bpms[bpms.length - 1]).toBeCloseTo(end, 6);
                },
            ),
        );
    });

    it("refuses a tempo of zero", () => {
        expect(() => rampDurations([1], 0)).toThrow(RangeError);
    });
});

describe("deriveTempoMap", () => {
    it("gives Sam's chart one row per tempo or meter change, exact", () => {
        const { durations, measures } = corps();
        const rows = deriveTempoMap({ durations, measures });
        expect(
            rows.map((r) => [
                r.measureNumber,
                r.rehearsalMark,
                formatMeter(r.meter),
                r.unit,
                r.shape,
                Number(r.startBpm.toFixed(6)),
            ]),
        ).toEqual([
            [1, "A", "4/4", "q", "steady", 176],
            [5, "C", "7/8 2+2+3", "q", "steady", 176],
            [7, "D", "5/8 3+2", "q", "steady", 176],
            // 12/8 at ♩.=152.5 has the same counts as 4/4 at ♩=152.5: one row until it's typed
            [9, "F", "4/4", "q", "steady", 152.5],
        ]);
        expect(rows[1].from).toBe(17);
        expect(rows[1].to).toBe(23);
        expect(rows[1].startTime).toBeCloseTo((16 * 60) / 176, 9);
        expect(rows[3].to).toBe(durations.length);
    });

    it("keeps a typed meter and unit for the measures after the mark", () => {
        const { durations, measures } = corps();
        const marks = new Map([
            [10, { meter: meter("12/8"), unit: "dq" as const }],
        ]);
        const rows = deriveTempoMap({ durations, measures, marks });
        const g = rows[rows.length - 1];
        expect([
            g.measureNumber,
            formatMeter(g.meter),
            g.unit,
            g.typed,
        ]).toEqual([11, "12/8", "dq", true]);
        expect(g.startBpm).toBeCloseTo(152.5, 9);
        expect(g.meterInferred).toBe(false);
    });

    it("stops a mark's meter at a measure with other counts", () => {
        const durations = [0, ...Array(4 + 3).fill(0.5)];
        const measures = measuresOf([4, 3]);
        const marks = new Map([
            [0, { meter: meter("12/8"), unit: "dq" as const }],
        ]);
        const rows = deriveTempoMap({ durations, measures, marks });
        expect(rows.map((r) => formatMeter(r.meter))).toEqual(["12/8", "3/4"]);
    });

    it("reads a rit. as one ramp row between steady rows", () => {
        const d = [0, ...Array(8).fill(60 / 132)];
        d.push(...rampDurations(Array(8).fill(1), 132, 100));
        d.push(...Array(4).fill(60 / 100));
        const rows = deriveTempoMap({
            durations: d,
            measures: measuresOf([4, 4, 4, 4, 4]),
        });
        expect(rows.map((r) => [r.measureNumber, r.shape])).toEqual([
            [1, "steady"],
            [3, "ramp"],
            [5, "steady"],
        ]);
        expect(rows[1].startBpm).toBeCloseTo(132, 9);
        expect(rows[1].endBpm).toBeCloseTo(100, 9);
    });

    it("averages an uneven row (a fermata)", () => {
        const d = [0, 0.5, 0.5, 0.5, 2, ...Array(4).fill(0.5)];
        const rows = deriveTempoMap({
            durations: d,
            measures: measuresOf([4, 4]),
        });
        expect(rows.map((r) => r.shape)).toEqual(["uneven", "steady"]);
        expect(rows[0].averageBpm).toBeCloseTo((4 * 60) / 3.5, 9);
    });

    it("rows cover every measure's counts in order, whatever the durations", () => {
        fc.assert(
            fc.property(
                fc.array(fc.integer({ min: 1, max: 5 }), {
                    minLength: 1,
                    maxLength: 12,
                }),
                fc.array(fc.constantFrom(0.4, 0.5, 0.6, 0.75), {
                    minLength: 60,
                    maxLength: 60,
                }),
                (counts, pool) => {
                    const measures = measuresOf(counts);
                    const total = counts.reduce((a, b) => a + b, 0);
                    const d = [0, ...pool.slice(0, total)];
                    while (d.length < total + 1) d.push(0.5);
                    const rows = deriveTempoMap({ durations: d, measures });
                    expect(rows[0].from).toBe(1);
                    expect(rows[rows.length - 1].to).toBe(total + 1);
                    rows.slice(1).forEach((r, i) => {
                        expect(r.from).toBe(rows[i].to);
                        expect(r.measureIndex).toBe(rows[i].endMeasureIndex);
                    });
                    const times = countTimes(d);
                    rows.forEach((r) =>
                        expect(r.startTime).toBe(times[r.from]),
                    );
                },
            ),
        );
    });
});

describe("tempo map edits", () => {
    it("types ♩=152.5 over a flat show: the row's counts change, later counts shift", () => {
        const d = [0, ...Array(12).fill(0.5)];
        const s = state(d, measuresOf([4, 4, 4]));
        const split = ok(addRowAt(s, 1));
        expect(split.durations).toEqual(d);
        expect(split.sync).toEqual([5]);
        const s2 = state(d, s.measures, split.marks);
        expect(s2.rows.map((r) => r.measureNumber)).toEqual([1, 2]);
        const w = ok(
            editRowTempo(s2, 1, { kind: "tempo", bpm: 152.5, unit: null }),
        );
        expect(w.durations.slice(1, 5)).toEqual([0.5, 0.5, 0.5, 0.5]);
        w.durations.slice(5).forEach((x) => expect(x).toBe(60 / 152.5));
        expect(w.durations).toHaveLength(d.length);
        expect(w.sync).toEqual([5]);
        const rows = deriveTempoMap({
            durations: w.durations,
            measures: s.measures,
            marks: w.marks,
        });
        expect(rows[1].shape).toBe("steady");
        expect(rows[1].startBpm).toBeCloseTo(152.5, 9);
    });

    it("syncs both edges of a row that isn't last", () => {
        const d = [0, ...Array(12).fill(0.5)];
        const marks = new Map<number, TempoMapMark>([
            [1, {}],
            [2, {}],
        ]);
        const s = state(d, measuresOf([4, 4, 4]), marks);
        const w = ok(
            editRowTempo(s, 1, { kind: "tempo", bpm: 100, unit: null }),
        );
        expect(w.sync).toEqual([5, 9]);
    });

    it("regroups 3/4 into 7/8 2+2+3, keeping the tempo's number", () => {
        const d = [0, ...Array(6).fill(0.5)];
        const s = state(d, measuresOf([3, 3]));
        const w = ok(editRowMeter(s, 0, meter("7/8 2+2+3")));
        expect(w.durations).toEqual([0, 0.5, 0.5, 0.75, 0.5, 0.5, 0.75]);
        expect(w.marks.get(0)?.unit).toBe("q");
    });

    it("refuses a meter that changes the number of counts", () => {
        const s = state([0, ...Array(8).fill(0.5)], measuresOf([4, 4]));
        expect(editRowMeter(s, 0, meter("3/4"))).toEqual({
            ok: false,
            error: "changesCounts",
        });
    });

    it("resolves ♩.=♩ once, from the previous row's tempo", () => {
        const d = [0, ...Array(4).fill(60 / 152.5), ...Array(4).fill(0.5)];
        const measures = measuresOf([4, 4]);
        const marks = new Map<number, TempoMapMark>([
            [1, { meter: meter("12/8"), unit: "dq" }],
        ]);
        const s = state(d, measures, marks);
        const w = ok(
            editRowTempo(s, 1, {
                kind: "relation",
                unit: "dq",
                previousUnit: "q",
            }),
        );
        // ♩. lasts as long as the previous ♩: the same count lengths
        w.durations
            .slice(5)
            .forEach((x) => expect(x).toBeCloseTo(60 / 152.5, 12));
        expect(w.marks.get(1)?.unit).toBe("dq");
        const prev = ok(editRowTempo(s, 1, { kind: "previous" }));
        expect(prev.durations).toEqual(w.durations);
    });

    it("needs a previous row for relations", () => {
        const s = state([0, 0.5, 0.5], measuresOf([2]));
        expect(editRowTempo(s, 0, { kind: "previous" })).toEqual({
            ok: false,
            error: "noPreviousRow",
        });
    });

    it("reads e=352 as the row's tempo in eighths", () => {
        const s = state([0, 0.5, 0.5, 0.5, 0.5], measuresOf([4]));
        const w = ok(
            editRowTempo(s, 0, { kind: "tempo", bpm: 352, unit: "e" }),
        );
        // a 4/4 count is two eighths
        w.durations
            .slice(1)
            .forEach((x) => expect(x).toBeCloseTo(120 / 352, 12));
    });

    it("adds a rit. that ends at the typed tempo, and clears it", () => {
        const d = [0, ...Array(8).fill(60 / 132)];
        const s = state(d, measuresOf([4, 4]));
        const w = ok(editRowRamp(s, 0, { kind: "ramp", bpm: 100, unit: "q" }));
        const bpms = countBpms(w.durations.slice(1), Array(8).fill(1));
        expect(bpms[0]).toBeCloseTo(132, 9);
        expect(bpms[7]).toBeCloseTo(100, 9);
        const rows = deriveTempoMap({
            durations: w.durations,
            measures: s.measures,
            marks: w.marks,
        });
        expect(rows.map((r) => r.shape)).toEqual(["ramp"]);
        const back = ok(
            editRowRamp(state(w.durations, s.measures, w.marks), 0, {
                kind: "clear",
            }),
        );
        back.durations
            .slice(1)
            .forEach((x) => expect(x).toBeCloseTo(60 / 132, 12));
    });

    it("keeps a rit.'s end tempo when its start is typed", () => {
        const d = [0, ...rampDurations(Array(8).fill(1), 132, 100)];
        const s = state(d, measuresOf([4, 4]));
        const w = ok(
            editRowTempo(s, 0, { kind: "tempo", bpm: 140, unit: null }),
        );
        const bpms = countBpms(w.durations.slice(1), Array(8).fill(1));
        expect(bpms[0]).toBeCloseTo(140, 9);
        expect(bpms[7]).toBeCloseTo(100, 9);
    });

    it("refuses tempos past the count limits and under 40", () => {
        const s = state([0, 0.5, 0.5], measuresOf([2]));
        expect(
            editRowTempo(s, 0, { kind: "tempo", bpm: 39, unit: null }),
        ).toEqual({
            ok: false,
            error: "tooSlow",
        });
        expect(
            editRowTempo(s, 0, {
                kind: "tempo",
                bpm: 60 / MIN_COUNT_SECONDS + 1,
                unit: null,
            }),
        ).toEqual({ ok: false, error: "tooFast" });
    });

    it("never changes the number of counts", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 40, max: 300 }),
                fc.integer({ min: 40, max: 300 }),
                fc.integer({ min: 0, max: 2 }),
                (bpm, end, row) => {
                    const d = [0, ...Array(12).fill(0.5)];
                    const marks = new Map<number, TempoMapMark>([
                        [1, {}],
                        [2, {}],
                    ]);
                    const s = state(d, measuresOf([4, 4, 4]), marks);
                    for (const r of [
                        editRowTempo(s, row, {
                            kind: "tempo",
                            bpm,
                            unit: null,
                        }),
                        editRowRamp(s, row, {
                            kind: "ramp",
                            bpm: end,
                            unit: null,
                        }),
                    ]) {
                        const w = ok(r);
                        expect(w.durations).toHaveLength(d.length);
                        expect(w.durations[0]).toBe(0);
                    }
                },
            ),
        );
    });

    it("adds a row only where there isn't one, and removes typed rows", () => {
        const s = state([0, ...Array(8).fill(0.5)], measuresOf([4, 4]));
        expect(addRowAt(s, 0)).toEqual({ ok: false, error: "rowExists" });
        expect(addRowAt(s, 5)).toEqual({ ok: false, error: "noSuchMeasure" });
        expect(removeRow(s, 0)).toEqual({ ok: false, error: "notTyped" });
        const added = ok(addRowAt(s, 1));
        const s2 = state(s.durations, s.measures, added.marks);
        const removed = ok(removeRow(s2, 1));
        expect(removed.unsync).toEqual([5]);
        expect(removed.marks.size).toBe(0);
    });
});

describe("findMeasure", () => {
    const measures = measuresOf([4, 4, 4], 44, { 45: "C" });
    it.each([
        ["m45", 1],
        ["45", 1],
        ["M 46", 2],
        ["c", 1],
        ["m99", -1],
        ["Z", -1],
    ])("finds %j", (text, index) => {
        expect(findMeasure(measures, text)).toBe(index);
    });
});

describe("storing typed rows", () => {
    it("maps measure indexes to beat ids and back, with the synced counts", () => {
        const d = [0, ...Array(8).fill(0.5)];
        const measures = measuresOf([4, 4]);
        const s = state(d, measures);
        const write = ok(addRowAt(s, 1));
        const beatIds = d.map((_, i) => 100 + i);
        const starts = [101, 105];
        const args = retimeArgsOf({
            write,
            beatIds,
            measureStartBeatIds: starts,
            syncedBeatIds: [103],
        });
        expect(args.syncedBeatIds).toEqual([103, 105]);
        expect(args.tempoMapMarks).toEqual([
            {
                beatId: 105,
                meter: { top: 4, bottom: 4, groups: null },
                unit: "q",
            },
        ]);
        expect(args.newDurationsByBeatId.get(105)).toBe(0.5);
        expect(marksByMeasure(args.tempoMapMarks, starts)).toEqual(write.marks);
        expect(marksByMeasure([{ beatId: 999 }], starts).size).toBe(0);
    });
});
