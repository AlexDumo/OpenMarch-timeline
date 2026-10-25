import { describe, expect, it } from "vitest";
import { rampDurations } from "../ramp";
import {
    defaultReimportTiming,
    marksAfterReimport,
    planReimport,
    reimportChangesAnything,
    syncedAfterReimport,
    type ReimportScoreMeasure,
    type ReimportShow,
} from "../reimport";

/** A bar of `counts` counts at `bpm`. */
const bar = (
    counts: number,
    bpm: number,
    mark?: string,
    number = -1,
): ReimportScoreMeasure => ({
    number,
    mark,
    durations: Array.from({ length: counts }, () => 60 / bpm),
});

/** Numbers bars from `first`. */
const numbered = (bars: ReimportScoreMeasure[], first = 1) =>
    bars.map((b, i) => ({ ...b, number: first + i }));

/** A show built from bars: beat 0, then each bar's counts, a measure per bar. Beat ids are 100 + ordinal. */
const showOf = (
    bars: ReimportScoreMeasure[],
    {
        measurementOffset = 1,
        synced = [],
    }: { measurementOffset?: number; synced?: number[] } = {},
): ReimportShow => {
    const durations = [0];
    const measures: {
        id: number;
        startOrdinal: number;
        mark: string | null;
    }[] = [];
    bars.forEach((b, i) => {
        measures.push({
            id: i + 1,
            startOrdinal: durations.length,
            mark: b.mark ?? null,
        });
        durations.push(...b.durations);
    });
    return {
        beatIds: durations.map((_, i) => 100 + i),
        durations,
        measures,
        measurementOffset,
        syncedBeatIds: synced.map((ordinal) => 100 + ordinal),
    };
};

/** Eight 4/4 bars at 132 with A at bar 1 and B at bar 5, F-style typo bars at `typoBpm`. */
const version = (typoBpm: number, extraBeforeB = 0) =>
    numbered([
        bar(4, 132, "A"),
        bar(4, 132),
        bar(4, typoBpm),
        bar(4, typoBpm),
        ...Array.from({ length: extraBeforeB }, () => bar(4, 132)),
        bar(4, 132, "B"),
        bar(4, 132),
        bar(4, 132, "C"),
        bar(4, 132),
    ]);

describe("planReimport", () => {
    it("same structure: only the corrected bars get new lengths, and nothing else changes", () => {
        const show = showOf(version(138));
        const plan = planReimport(show, version(132));
        expect(plan.sameStructure).toBe(true);
        expect(plan.differing).toEqual([]);
        expect(plan.pairs).toHaveLength(8);
        // Bars 3 and 4 are ordinals 9..16
        expect(plan.retimedOrdinals).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
        expect(plan.durations.length).toBe(show.durations.length);
        expect(plan.tempoChanges).toEqual([
            {
                from: 2,
                to: 4,
                mark: undefined,
                before: { bpm: 138, even: true },
                after: { bpm: 132, even: true },
            },
        ]);
        expect(plan.markChanges).toEqual([]);
        expect(plan.measurementOffset).toBeNull();
        expect(plan.end.after).toBeGreaterThan(plan.end.before);
    });

    it("a file identical to the show changes nothing", () => {
        const plan = planReimport(showOf(version(132)), version(132));
        expect(reimportChangesAnything(plan, "score")).toBe(false);
        expect(reimportChangesAnything(plan, "keep")).toBe(false);
    });

    it("updates marks and the first measure's number as labels", () => {
        const file = numbered(version(132), 0);
        const show = showOf(
            version(132).map((b, i) =>
                i === 6 ? { ...b, mark: undefined } : b,
            ),
        );
        const plan = planReimport(show, [
            ...file.slice(0, 1),
            { ...file[1], mark: "A2" },
            ...file.slice(2),
        ]);
        expect(plan.sameStructure).toBe(true);
        expect(plan.markChanges).toEqual([
            { measureIndex: 1, measureId: 2, from: null, to: "A2" },
            { measureIndex: 6, measureId: 7, from: null, to: "C" },
        ]);
        expect(plan.measurementOffset).toEqual({ from: 1, to: 0 });
        expect(plan.retimedOrdinals).toEqual([]);
        expect(reimportChangesAnything(plan, "keep")).toBe(true);
    });

    it("two bars added before B: reported, the bars between A and B are left alone, the rest is updated", () => {
        const show = showOf(version(138));
        const file = version(132, 2);
        // The file also fixes the last bar's tempo
        const last = file.length - 1;
        const fixed = [
            ...file.slice(0, last),
            { ...file[last], durations: bar(4, 120).durations },
        ];
        const plan = planReimport(show, fixed);
        expect(plan.sameStructure).toBe(false);
        expect(plan.differing).toEqual([
            {
                show: { from: 0, to: 4 },
                score: { from: 0, to: 6 },
                afterMark: "A",
                beforeMark: "B",
            },
        ]);
        // Bars A..B (ordinals 1..16) keep their lengths even though the file fixed the typo there
        expect(plan.retimedOrdinals.every((o) => o > 16)).toBe(true);
        // The last bar (show bar 7, ordinals 29..32) pairs with the file's last bar
        expect(plan.pairs).toContainEqual({ show: 7, score: 9 });
        expect(plan.retimedOrdinals).toEqual([29, 30, 31, 32]);
        expect(plan.durations).toHaveLength(show.durations.length);
    });

    it("a bar with a different number of counts is reported and left alone; the bars around it pair", () => {
        const show = showOf(version(132));
        const file = version(132);
        file[5] = { ...bar(3, 100), number: 6 };
        const plan = planReimport(show, file);
        expect(plan.differing).toEqual([
            {
                show: { from: 5, to: 6 },
                score: { from: 5, to: 6 },
                afterMark: "B",
                beforeMark: "C",
            },
        ]);
        expect(plan.pairs.map((p) => p.show)).toEqual([0, 1, 2, 3, 4, 6, 7]);
        expect(plan.retimedOrdinals).toEqual([]);
    });

    it("a file without marks and with a different bar count updates nothing", () => {
        const strip = (bars: ReimportScoreMeasure[]) =>
            bars.map((b) => ({ ...b, mark: undefined }));
        const plan = planReimport(
            showOf(strip(version(138))),
            strip(version(132, 2)),
        );
        expect(plan.pairs).toEqual([]);
        expect(plan.differing).toHaveLength(1);
        expect(plan.retimedOrdinals).toEqual([]);
    });

    it("a pickup added in the file lines up by measure number", () => {
        const show = showOf(version(138));
        const file = [{ ...bar(1, 132), number: 0 }, ...version(132)];
        const plan = planReimport(show, file);
        expect(plan.differing).toEqual([
            {
                show: { from: 0, to: 0 },
                score: { from: 0, to: 1 },
                beforeMark: "A",
            },
        ]);
        expect(plan.pairs[0]).toEqual({ show: 0, score: 1 });
        expect(plan.retimedOrdinals).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
        // The show's first bar isn't the file's first bar, so its number stays
        expect(plan.measurementOffset).toBeNull();
    });

    it("a mark that moved backwards isn't used to line bars up", () => {
        const show = showOf(
            numbered([bar(4, 120, "A"), bar(4, 120, "B"), bar(4, 120)]),
        );
        const file = numbered([
            bar(4, 120, "B"),
            bar(4, 120, "A"),
            bar(4, 120),
        ]);
        const plan = planReimport(show, file);
        expect(plan.pairs).toHaveLength(3);
        expect(plan.markChanges.map((c) => c.to)).toEqual(["B", "A"]);
    });
});

describe("synced counts", () => {
    it("counts the synced counts the file's timing would move, and keeps the rest", () => {
        // Synced at the start of bar 2 (ordinal 5, before the typo) and bar 7 (ordinal 25, after it)
        const show = showOf(version(138), { synced: [5, 25] });
        const plan = planReimport(show, version(132));
        expect(plan.synced).toEqual({ total: 2, moved: [125] });
        expect(defaultReimportTiming(plan)).toBe("keep");
        expect(syncedAfterReimport(show, plan, "keep")).toEqual([105, 125]);
        expect(syncedAfterReimport(show, plan, "score")).toEqual([105]);
        expect(reimportChangesAnything(plan, "keep")).toBe(false);
    });

    it("uses the file's timing by default when nothing is synced", () => {
        const plan = planReimport(showOf(version(138)), version(132));
        expect(defaultReimportTiming(plan)).toBe("score");
    });
});

describe("a rit. the file gives no target for (FX-6)", () => {
    /** The show's own rit. over bars 3–4 (132 → 100), the file flat at 132 with "rit." at bar 3 */
    const withRit = () => {
        const file = version(132);
        const showBars = version(132).map((b, i) =>
            i === 2
                ? { ...b, durations: rampDurations([1, 1, 1, 1], 132, 116) }
                : i === 3
                  ? { ...b, durations: rampDurations([1, 1, 1, 1], 112, 100) }
                  : b,
        );
        return {
            show: showOf(showBars),
            score: file.map((b, i) =>
                i === 2 ? { ...b, rampWithoutTarget: true } : b,
            ),
        };
    };

    it("leaves the show's rit. bars as they are and says so", () => {
        const { show, score } = withRit();
        const plan = planReimport(show, score);
        expect(plan.keptRamps).toEqual([{ from: 2, to: 4 }]);
        expect(plan.retimedOrdinals).toEqual([]);
        expect(plan.tempoChanges).toEqual([]);
        expect(reimportChangesAnything(plan, "score")).toBe(false);
    });

    it("still applies the file where the show has no rit.", () => {
        const { score } = withRit();
        const show = showOf(version(138));
        const plan = planReimport(show, score);
        expect(plan.keptRamps).toEqual([]);
        expect(plan.retimedOrdinals.length).toBeGreaterThan(0);
    });
});

describe("tempos typed in the map aren't alignment (FX-6)", () => {
    it("doesn't count a typed row's synced edges as lined up with the recording", () => {
        const bars = version(138);
        const base = showOf(bars, { synced: [9, 17] });
        // Bar 3 (ordinal 9) was typed in the tempo map; its edges 9 and 17 got synced
        const show = {
            ...base,
            tempoMapMarks: [
                {
                    beatId: 109,
                    unit: "q" as const,
                    bpm: 138,
                    source: "typed" as const,
                },
            ],
        };
        const plan = planReimport(show, version(132));
        expect(plan.synced.total).toBe(0);
        expect(defaultReimportTiming(plan)).toBe("score");
        // A count synced in Align still counts
        const aligned = planReimport(
            { ...show, syncedBeatIds: [109, 117, 121] },
            version(132),
        );
        expect(aligned.synced.total).toBe(1);
    });
});

describe("tempo map marks on re-import (FX-3)", () => {
    it("takes the file's meters and tempos, and keeps a typed row when keeping the timing", () => {
        const file = version(132).map((b, i) =>
            i === 0
                ? {
                      ...b,
                      tempoMark: {
                          unit: "q" as const,
                          bpm: 132,
                          source: "import" as const,
                      },
                  }
                : b,
        );
        const show = {
            ...showOf(version(132)),
            tempoMapMarks: [
                {
                    beatId: 101,
                    unit: "q" as const,
                    bpm: 120,
                    source: "typed" as const,
                },
                {
                    beatId: 109,
                    unit: "q" as const,
                    bpm: 132,
                    source: "import" as const,
                },
            ],
        };
        const plan = planReimport(show, file);
        expect(marksAfterReimport(show, file, plan, "score")).toEqual([
            { beatId: 101, unit: "q", bpm: 132, source: "import" },
        ]);
        expect(marksAfterReimport(show, file, plan, "keep")).toEqual([
            { beatId: 101, unit: "q", bpm: 120, source: "typed" },
        ]);
        expect(
            marksAfterReimport(
                {
                    ...show,
                    tempoMapMarks: [
                        { beatId: 101, unit: "q", bpm: 132, source: "import" },
                    ],
                },
                file,
                plan,
                "score",
            ),
        ).toBeNull();
    });
});
