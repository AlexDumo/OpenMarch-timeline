import { describe, expect, it } from "vitest";
import {
    planReimport,
    type ReimportScoreMeasure,
    type ReimportShow,
} from "@/timeline/tempo/reimport";
import { reimportLines } from "../musicXmlReimportPreview";

const bar = (bpm: number, mark?: string, counts = 4): ReimportScoreMeasure => ({
    number: -1,
    mark,
    durations: Array.from({ length: counts }, () => 60 / bpm),
});
const numbered = (bars: ReimportScoreMeasure[], first = 1) =>
    bars.map((b, i) => ({ ...b, number: first + i }));

const showOf = (
    bars: ReimportScoreMeasure[],
    synced: number[] = [],
): ReimportShow => {
    const durations = [0];
    const measures = bars.map((b, i) => {
        const m = {
            id: i + 1,
            startOrdinal: durations.length,
            mark: b.mark ?? null,
        };
        durations.push(...b.durations);
        return m;
    });
    return {
        beatIds: durations.map((_, i) => i),
        durations,
        measures,
        measurementOffset: 1,
        syncedBeatIds: synced,
    };
};

describe("reimportLines", () => {
    const v1 = numbered([
        bar(132, "A"),
        bar(138, "F"),
        bar(132, "G"),
        bar(132, "L"),
    ]);
    const v2 = numbered([
        bar(132, "A"),
        bar(132, "F"),
        bar(132, "G"),
        bar(132, "L"),
    ]);

    it("says what the file's timing changes", () => {
        const show = showOf(v1);
        const plan = planReimport(show, v2);
        expect(reimportLines(show, v2, plan, "score")).toEqual([
            { key: "same", params: {} },
            {
                key: "tempo",
                params: {
                    measures: "m2 (F)",
                    before: "138",
                    after: "132",
                },
            },
            {
                key: "end",
                params: { before: "0:07", after: "0:07", delta: "+0.1" },
            },
        ]);
    });

    it("keeping the alignment says the timing stays", () => {
        const show = showOf(v1, [5]);
        const plan = planReimport(show, v2);
        expect(reimportLines(show, v2, plan, "keep")).toEqual([
            { key: "same", params: {} },
            { key: "timingKept", params: { count: 1 } },
        ]);
    });

    it("names bars added before a mark, and marks that change", () => {
        const show = showOf(v2);
        const v3 = numbered([
            bar(132, "A"),
            bar(132, "F"),
            bar(132, "G"),
            bar(132),
            bar(132),
            bar(132, "L"),
        ]);
        const plan = planReimport(show, v3);
        const lines = reimportLines(show, v3, plan, "score");
        expect(lines[0]).toEqual({
            key: "partial",
            params: { count: 3, total: 6 },
        });
        expect(lines.at(-1)).toEqual({
            key: "moreBars",
            params: {
                where: "before",
                mark: "L",
                here: "m3",
                file: "m3–5",
                count: 2,
                showBars: 1,
                scoreBars: 3,
            },
            warning: true,
        });
    });

    it("lists added, removed and renamed marks", () => {
        const show = showOf(numbered([bar(120, "A"), bar(120, "B"), bar(120)]));
        const file = numbered([bar(120), bar(120, "C"), bar(120, "D")]);
        const plan = planReimport(show, file);
        expect(reimportLines(show, file, plan, "score")).toEqual([
            { key: "same", params: {} },
            { key: "markRemoved", params: { measure: "m1", mark: "A" } },
            {
                key: "markRenamed",
                params: { measure: "m2", from: "B", to: "C" },
            },
            { key: "markAdded", params: { measure: "m3", mark: "D" } },
        ]);
    });
});

describe("a kept rit. (FX-6)", () => {
    it("says in words that the show's rit. stays, instead of a tempo line", () => {
        const file = numbered([
            bar(132, "A"),
            bar(132),
            bar(132),
            bar(132, "B"),
        ]);
        const ritBar = (from: number, to: number): ReimportScoreMeasure => ({
            number: -1,
            durations: [0, 1, 2, 3].map(
                (k) => 60 / (from + ((to - from) * k) / 3),
            ),
        });
        const show = showOf(
            numbered([
                bar(132, "A"),
                ritBar(132, 116),
                ritBar(112, 100),
                bar(132, "B"),
            ]),
        );
        const score = file.map((b, i) =>
            i === 1 ? { ...b, rampWithoutTarget: true } : b,
        );
        const lines = reimportLines(
            show,
            score,
            planReimport(show, score),
            "score",
        );
        expect(lines).toEqual([
            { key: "same", params: {} },
            { key: "rampKept", params: { measures: "m2–3" } },
        ]);
    });
});
