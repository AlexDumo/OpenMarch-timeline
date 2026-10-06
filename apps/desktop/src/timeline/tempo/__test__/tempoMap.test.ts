import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
    addRowAt,
    confirmMeter,
    countUnits,
    deriveTempoMap,
    editRowMeter,
    editRowRamp,
    editRowTempo,
    findMeasure,
    formatUnitTempo,
    inferMeter,
    isNoOpWrite,
    markText,
    marksByMeasure,
    meterText,
    overriddenSections,
    removeRow,
    retimeArgsOf,
    rowTempoText,
    rowsAtRehearsalMarks,
    typedEdgeCounts,
    linedUpCounts,
    typedSections,
    unitTempo,
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
        // "=prev" keeps the pulse (the eighth), not the count: ♩=152.5 is ♩.=101.667
        const prev = ok(editRowTempo(s, 1, { kind: "previous" }));
        prev.durations
            .slice(5)
            .forEach((x) => expect(x).toBeCloseTo((1.5 * 60) / 152.5, 12));
        expect(prev.marks.get(1)?.bpm).toBeCloseTo((152.5 * 4) / 6, 9);
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

describe("=prev and relations carry the pulse (FX-2)", () => {
    it("e=352 then =prev on a 6/4 row is ♩=176, not ♩=352", () => {
        // m1–2 5/8 3+2 typed e=352, m3 6/4
        const measures = measuresOf([2, 2, 6]);
        const d = [
            0,
            ...rampDurations([1.5, 1], 176),
            ...rampDurations([1.5, 1], 176),
            ...Array(6).fill(0.5),
        ];
        const marks = new Map<number, TempoMapMark>([
            [0, { meter: meter("5/8 3+2"), unit: "e", bpm: 352 }],
            [2, { meter: meter("6/4"), unit: "q" }],
        ]);
        const s = state(d, measures, marks);
        expect(s.rows.map((r) => r.unit)).toEqual(["e", "q"]);
        const w = ok(editRowTempo(s, 1, { kind: "previous" }));
        w.durations
            .slice(5)
            .forEach((x) => expect(x).toBeCloseTo(60 / 176, 12));
        expect(w.marks.get(2)?.bpm).toBeCloseTo(176, 9);
        expect(markText(w.marks.get(2)!, { withMeter: false })).toBe("♩=176");
    });

    it("=prev keeps the pulse whatever the units, as a property", () => {
        const units = ["e", "q", "dq", "h"] as const;
        fc.assert(
            fc.property(
                fc.constantFrom(...units),
                fc.constantFrom(...units),
                fc.double({ min: 60, max: 200, noNaN: true }),
                (a, b, bpm) => {
                    const measures = measuresOf([2, 2]);
                    const d = [0, 0.5, 0.5, 0.5, 0.5];
                    const marks = new Map<number, TempoMapMark>([
                        [0, { unit: a }],
                        [1, { unit: b }],
                    ]);
                    const s0 = state(d, measures, marks);
                    const first = editRowTempo(s0, 0, {
                        kind: "tempo",
                        bpm,
                        unit: a,
                    });
                    fc.pre(first.ok);
                    const typed = ok(first);
                    const s1 = state(typed.durations, measures, typed.marks);
                    // Past the 40–400 limits in the other unit, it is refused
                    const next = editRowTempo(s1, 1, { kind: "previous" });
                    fc.pre(next.ok);
                    const w = ok(next);
                    const sixteenths = { e: 2, q: 4, dq: 6, h: 8 };
                    // The same note lasts as long in both rows
                    const before = (60 / bpm) * (1 / sixteenths[a]);
                    const after =
                        (60 / w.marks.get(1)!.bpm!) * (1 / sixteenths[b]);
                    return Math.abs(before - after) < 1e-12;
                },
            ),
        );
    });
});

describe("typed rows stay typed until something else changes them (FX-4)", () => {
    it("shows = while a typed row plays at its tempo, ≈ once a drag moved it", () => {
        const d = [0, ...Array(8).fill(0.5)];
        const measures = measuresOf([4, 4]);
        const s = state(d, measures);
        const w = ok(
            editRowTempo(s, 0, { kind: "tempo", bpm: 176, unit: null }),
        );
        expect(w.marks.get(0)).toMatchObject({ bpm: 176, source: "typed" });
        const typed = deriveTempoMap({
            durations: w.durations,
            measures,
            marks: w.marks,
        });
        expect(typed[0].exact).toBe(true);
        expect(rowTempoText(typed[0])).toBe("♩=176");
        // A drag rescales the row: still steady, but not what was typed
        const dragged = w.durations.map((x, i) =>
            i >= 1 && i <= 8 ? x * 0.95 : x,
        );
        const after = deriveTempoMap({
            durations: dragged,
            measures,
            marks: w.marks,
        });
        expect(after[0].exact).toBe(false);
        expect(after[0].markedBpm).toBe(176);
        expect(rowTempoText(after[0])).toBe("♩≈185.3");
    });

    it("never shows = for a drag's tempo on a row nobody typed", () => {
        const d = [0, ...Array(4).fill(60 / 185.035)];
        const rows = deriveTempoMap({
            durations: d,
            measures: measuresOf([4]),
        });
        expect(rows[0].exact).toBe(false);
        expect(rowTempoText(rows[0])).toBe("♩≈185");
        const plain = deriveTempoMap({
            durations: [0, ...Array(4).fill(60 / 152.5)],
            measures: measuresOf([4]),
        });
        expect(rowTempoText(plain[0])).toBe("♩=152.5");
    });

    it("protects typed rows that still play as typed, and names what a drag overrides", () => {
        const d = [0, ...Array(8).fill(0.5)];
        const measures = measuresOf([4, 4]);
        const s = state(d, measures, new Map([[1, {}]]));
        const w = ok(
            editRowTempo(s, 0, { kind: "tempo", bpm: 176, unit: null }),
        );
        const rows = deriveTempoMap({
            durations: w.durations,
            measures,
            marks: w.marks,
        });
        const sections = typedSections(rows).slice(0, 1);
        // A row added in the map (a mark without a source, as files before FX-4 saved them) is
        // typed too (DE-2)
        expect(typedSections(rows)).toEqual([
            { from: 1, to: 5, tempo: "♩=176", measures: "m1" },
            { from: 5, to: 9, tempo: "♩=120", measures: "m2" },
        ]);
        const inside = [...w.durations];
        inside[2] *= 1.1;
        expect(overriddenSections(sections, w.durations, inside)).toEqual(
            sections,
        );
        const later = [...w.durations];
        later[6] *= 1.1;
        expect(overriddenSections(sections, w.durations, later)).toEqual([]);
        // An imported row isn't protected
        const imported = new Map<number, TempoMapMark>([
            [0, { ...w.marks.get(0)!, source: "import" }],
            [1, { source: "import" }],
        ]);
        expect(
            typedSections(
                deriveTempoMap({
                    durations: w.durations,
                    measures,
                    marks: imported,
                }),
            ),
        ).toEqual([]);
    });
});

describe("meters as the score writes them (FX-3)", () => {
    it("shows a pickup with its meter, and the next bar starts its own row", () => {
        const d = [0, ...Array(9).fill(60 / 132)];
        const measures = measuresOf([1, 4, 4], 0);
        const marks = new Map<number, TempoMapMark>([
            [0, { meter: meter("4/4"), unit: "q", bpm: 132, source: "import" }],
        ]);
        const rows = deriveTempoMap({ durations: d, measures, marks });
        expect(rows.map(meterText)).toEqual(["4/4 pickup", "4/4"]);
        expect(rows[0].exact).toBe(true);
        expect(rows[1].meterInferred).toBe(false);
    });

    it("keeps 3/2 counted in ♩ as 3/2, and 6/8 as ♩.", () => {
        const d = [0, ...Array(6).fill(0.5), ...Array(4).fill(60 / 88)];
        const measures = measuresOf([6, 2, 2]);
        const marks = new Map<number, TempoMapMark>([
            [0, { meter: meter("6/4"), unit: "q", label: "3/2", bpm: 120 }],
            [1, { meter: meter("6/8"), unit: "dq", bpm: 88, source: "import" }],
        ]);
        const rows = deriveTempoMap({ durations: d, measures, marks });
        expect(rows.map((r) => `${meterText(r)} ${rowTempoText(r)}`)).toEqual([
            "3/2 ♩=120",
            "6/8 ♩.=88",
        ]);
    });

    it("reads ♩.=86 typed over a section counted as 2/4 as 6/8, not 1.5× too fast", () => {
        const d = [0, ...Array(4).fill(60 / 88)];
        const measures = measuresOf([2, 2]);
        const s = state(d, measures);
        expect(formatMeter(s.rows[0].meter)).toBe("2/4");
        const w = ok(
            editRowTempo(s, 0, { kind: "tempo", bpm: 86, unit: "dq" }),
        );
        w.durations.slice(1).forEach((x) => expect(x).toBeCloseTo(60 / 86, 12));
        expect(markText(w.marks.get(0)!, { withMeter: true })).toBe(
            "6/8 ♩.=86",
        );
    });
});

describe("tempos in their units for Align and the readout (FX-7)", () => {
    it("reads a 6/8 page as ♩.=88 and a plain page as a number", () => {
        const d = [0, ...Array(4).fill(0.5), ...Array(4).fill(60 / 88)];
        const measures = measuresOf([4, 2, 2]);
        const marks = new Map<number, TempoMapMark>([
            [1, { meter: meter("6/8"), unit: "dq" }],
        ]);
        const rows = deriveTempoMap({ durations: d, measures, marks });
        const units = countUnits(rows, d.length);
        expect(formatUnitTempo(unitTempo(d, units, 1, 5)!)).toBe("120");
        expect(formatUnitTempo(unitTempo(d, units, 5, 9)!)).toBe("♩.=88");
        // A page from 4/4 into 6/8 reads the tempo where it starts, not an average
        expect(formatUnitTempo(unitTempo(d, units, 3, 9)!)).toBe("120");
        const slower = d.map((x, i) => (i >= 5 ? x * 1.03 : x));
        expect(formatUnitTempo(unitTempo(slower, units, 5, 9)!)).toBe("♩.≈85");
    });

    it("reads a 5/8 3+2 section at ♩=176 as ♩=176, not an average", () => {
        const d = [
            0,
            ...rampDurations([1.5, 1], 176),
            ...rampDurations([1.5, 1], 176),
        ];
        const rows = deriveTempoMap({
            durations: d,
            measures: measuresOf([2, 2]),
        });
        const units = countUnits(rows, d.length);
        expect(formatUnitTempo(unitTempo(d, units, 1, 5)!)).toBe("♩=176");
    });
});

describe("an edit that changes nothing writes nothing (DE-4)", () => {
    it("Marcus: ♩.=86, then 86, then 6/8 on the same row: only the first is an edit", () => {
        // m1–2 of 2/4 at ♩=88 (an imported 6/8 shown as 2/4)
        const measures = measuresOf([2, 2]);
        let d = [0, ...Array<number>(4).fill(60 / 88)];
        let marks = new Map<number, TempoMapMark>();
        let synced: number[] = [];
        const apply = (w: ReturnType<typeof ok>) => {
            d = w.durations;
            marks = w.marks;
            synced = [...new Set([...synced, ...w.sync])].sort((a, b) => a - b);
        };
        const noOp = (w: ReturnType<typeof ok>) =>
            isNoOpWrite({ write: w, durations: d, marks, synced });

        const first = ok(
            editRowTempo(state(d, measures, marks), 0, {
                kind: "tempo",
                bpm: 86,
                unit: "dq",
            }),
        );
        expect(noOp(first)).toBe(false);
        apply(first);
        const again = ok(
            editRowTempo(state(d, measures, marks), 0, {
                kind: "tempo",
                bpm: 86,
                unit: null,
            }),
        );
        expect(noOp(again)).toBe(true);
        const sameMeter = ok(
            editRowMeter(state(d, measures, marks), 0, meter("6/8")),
        );
        expect(noOp(sameMeter)).toBe(true);
        // A real change still is one
        const faster = ok(
            editRowTempo(state(d, measures, marks), 0, {
                kind: "tempo",
                bpm: 90,
                unit: null,
            }),
        );
        expect(noOp(faster)).toBe(false);
    });

    it("adding a synced count or a mark is a change", () => {
        const measures = measuresOf([4, 4]);
        const d = [0, ...Array<number>(8).fill(0.5)];
        const w = ok(addRowAt(state(d, measures), 1));
        expect(
            isNoOpWrite({
                write: w,
                durations: d,
                marks: new Map(),
                synced: [],
            }),
        ).toBe(false);
        expect(
            isNoOpWrite({
                write: w,
                durations: d,
                marks: w.marks,
                synced: [5],
            }),
        ).toBe(true);
    });
});

/**
 * Meters as written for shows without marks (DE-5): Marcus's score imported before marks
 * existed. m0 one count, m1–4 4/4 ♩=132, m5–6 two counts of 60/88 s (6/8 ♩.=88 after ♩.=♩),
 * m7 two counts at ♩.=85, m8 3/4 ♩=132.
 */
describe("meters read from the counts (DE-5)", () => {
    const q = 60 / 132;
    const d = [
        0,
        q,
        ...Array<number>(16).fill(q),
        ...Array<number>(4).fill(60 / 88),
        ...Array<number>(2).fill(60 / 85),
        ...Array<number>(3).fill(q),
    ];
    const measures = measuresOf([1, 4, 4, 4, 4, 2, 2, 2, 3], 0, {
        1: "A",
        5: "I",
    });
    const rows = deriveTempoMap({ durations: d, measures });

    it("reads a one-count first measure as the next measure's pickup", () => {
        expect(meterText(rows[0])).toBe("4/4 pickup");
        expect(rows[0].meterGuess).toBe("pickup");
        expect(rowTempoText(rows[0])).toBe("♩=132");
    });

    it("reads counts 1.5× the ♩ before as compound, and carries it on", () => {
        const six = rows.filter((r) => meterText(r) === "6/8");
        expect(six.map((r) => [r.measureNumber, rowTempoText(r)])).toEqual([
            [5, "♩.=88"],
            [7, "♩.=85"],
        ]);
        expect(six.every((r) => r.meterGuess === "compound")).toBe(true);
        const last = rows[rows.length - 1];
        expect(meterText(last)).toBe("3/4");
        expect(last.meterGuess).toBeUndefined();
    });

    it("never changes when a count lands", () => {
        for (const r of rows)
            expect(r.startTime).toBeCloseTo(countTimes(d)[r.from], 12);
        const w = ok(confirmMeter(state(d, measures), 2));
        expect(w.durations).toEqual(d);
        expect(w.sync).toEqual([]);
        expect(w.marks.get(rows[2].measureIndex)).toMatchObject({
            meter: meter("6/8"),
            unit: "dq",
            source: "import",
        });
        // Confirmed, it reads the same without the "?" and protects no tempo
        const after = deriveTempoMap({
            durations: d,
            measures,
            marks: w.marks,
        });
        expect(meterText(after[2])).toBe("6/8");
        expect(after[2].meterInferred).toBe(false);
        expect(typedSections(after)).toEqual([]);
    });

    it("doesn't guess where the counts say nothing new", () => {
        const plain = deriveTempoMap({
            durations: [0, ...Array<number>(8).fill(0.5)],
            measures: measuresOf([4, 4]),
        });
        expect(plain.map((r) => r.meterGuess)).toEqual([undefined]);
        // A two-count first measure could be a 2/4 bar: not a guessed pickup
        const two = deriveTempoMap({
            durations: [0, ...Array<number>(6).fill(0.5)],
            measures: measuresOf([2, 4]),
        });
        expect(two[0].meterGuess).toBeUndefined();
    });
});

describe("the map's rows at every rehearsal mark (D7)", () => {
    it("adds a row at each letter inside a row, with its own counts and start", () => {
        const d = [0, ...Array<number>(16).fill(0.5)];
        const measures = measuresOf([4, 4, 4, 4], 1, {
            1: "A",
            3: "B",
            4: "C",
        });
        const rows = deriveTempoMap({ durations: d, measures });
        expect(rows).toHaveLength(1);
        const shown = rowsAtRehearsalMarks(rows, measures, d);
        expect(
            shown.map((r) => [r.rehearsalMark, r.from, r.to, rowTempoText(r)]),
        ).toEqual([
            ["A", 1, 9, "♩=120"],
            ["B", 9, 13, "♩=120"],
            ["C", 13, 17, "♩=120"],
        ]);
        expect(shown[1]!.startTime).toBe(4);
        expect(shown[1]!.continues).toBe(true);
        expect(shown[1]!.typed).toBe(false);
        // Typing at B changes B only
        const w = ok(
            editRowTempo({ ...state(d, measures), rows: shown }, 1, {
                kind: "tempo",
                bpm: 100,
                unit: null,
            }),
        );
        expect(w.durations.slice(9, 13)).toEqual(Array(4).fill(0.6));
        expect(w.durations[13]).toBe(0.5);
    });
});

describe("meters written another way (D7)", () => {
    it("3/2 over six ♩ counts is kept as written, counted in ♩", () => {
        const d = [0, ...Array<number>(12).fill(0.5)];
        const measures = measuresOf([6, 6]);
        const w = ok(editRowMeter(state(d, measures), 0, meter("3/2")));
        expect(w.durations).toEqual(d);
        expect(w.marks.get(0)).toMatchObject({
            meter: meter("6/4"),
            unit: "q",
            label: "3/2",
        });
        const rows = deriveTempoMap({ durations: d, measures, marks: w.marks });
        expect(meterText(rows[0])).toBe("3/2");
    });

    it("regroups 7/8 2+2+3 as 3+2+2 and back from the map", () => {
        const e = 60 / 352;
        const bar = [2 * e, 2 * e, 3 * e];
        const d = [0, ...bar, ...bar];
        const measures = measuresOf([3, 3]);
        const before = deriveTempoMap({ durations: d, measures });
        expect(meterText(before[0])).toBe("7/8 2+2+3");
        const w = ok(editRowMeter(state(d, measures), 0, meter("7/8 3+2+2")));
        const rows = deriveTempoMap({
            durations: w.durations,
            measures,
            marks: w.marks,
        });
        expect(rows.map(meterText)).toEqual(["7/8 3+2+2"]);
        expect(w.durations[1]).toBeCloseTo(3 * e, 12);
        expect(w.durations[3]).toBeCloseTo(2 * e, 12);
        // The measure keeps its length: the long count only moved
        expect(w.durations.slice(1, 4).reduce((a, b) => a + b)).toBeCloseTo(
            7 * e,
            12,
        );
        const back = ok(
            editRowMeter(
                state(w.durations, measures, w.marks),
                0,
                meter("7/8 2+2+3"),
            ),
        );
        expect(back.durations[1]).toBeCloseTo(2 * e, 12);
    });
});

describe("● edges aren't lined up (DE-6)", () => {
    it("leaves a typed row's edges out of the lined-up counts", () => {
        const d = [0, ...Array<number>(8).fill(0.5)];
        const measures = measuresOf([4, 4]);
        const w = ok(
            editRowTempo(state(d, measures, new Map([[1, {}]])), 1, {
                kind: "tempo",
                bpm: 100,
                unit: null,
            }),
        );
        const rows = deriveTempoMap({
            durations: w.durations,
            measures,
            marks: w.marks,
        });
        expect([...typedEdgeCounts(rows)].sort((a, b) => a - b)).toEqual([
            5, 9,
        ]);
        expect(linedUpCounts([5, 7], rows)).toEqual([7]);
    });
});
