import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
    applyMeasureLinePlan,
    followingRehearsalMark,
    measureForMark,
    nextRehearsalMark,
    planMeasureLineEdit,
    previousRehearsalMark,
    type MeasureLine,
    type MeasureLineEdit,
} from "../measureLines";

const bounds = { beatCount: 33, firstBeat: 1 };

/** Lines every `size` beats from beat 1, ids from 1, with marks by index */
const linesEvery = (
    size: number,
    count: number,
    marks: Record<number, string> = {},
): MeasureLine[] =>
    Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        beat: 1 + i * size,
        mark: marks[i] ?? null,
    }));

const run = (lines: MeasureLine[], edit: MeasureLineEdit, b = bounds) =>
    applyMeasureLinePlan(lines, planMeasureLineEdit(lines, b, edit));

const beatsOf = (lines: readonly MeasureLine[]) => lines.map((l) => l.beat);

describe("followingRehearsalMark", () => {
    it.each([
        [null, "A"],
        ["", "A"],
        ["A", "B"],
        ["C", "D"],
        ["Y", "Z"],
        ["Z", "AA"],
        ["AA", "BB"],
        ["ZZ", "AAA"],
        ["c", "d"],
        ["z", "aa"],
        ["AB", "AC"],
        ["AZ", "BA"],
        ["1", "2"],
        ["9", "10"],
        ["41", "42"],
        ["B2", "B3"],
        ["Intro", "A"],
        ["  F ", "G"],
    ])("after %j comes %j", (mark, next) => {
        expect(followingRehearsalMark(mark)).toBe(next);
    });
});

describe("nextRehearsalMark", () => {
    it("skips names the show already uses", () => {
        expect(nextRehearsalMark("B", ["A", "B", "C", "D"])).toBe("E");
        expect(nextRehearsalMark("b", ["c"])).toBe("d");
        expect(nextRehearsalMark("3", ["4"])).toBe("5");
    });
    it("starts at A without a previous mark", () => {
        expect(nextRehearsalMark(null, [])).toBe("A");
        expect(nextRehearsalMark(null, ["A"])).toBe("B");
    });
    it("never offers a taken name", () => {
        fc.assert(
            fc.property(
                fc.option(fc.stringMatching(/^[A-Z]{1,2}$|^\d{1,3}$/)),
                fc.array(fc.stringMatching(/^[A-Z]{1,2}$|^\d{1,3}$/)),
                (previous, taken) => {
                    const next = nextRehearsalMark(previous, taken);
                    expect(next.length).toBeGreaterThan(0);
                    expect(taken).not.toContain(next);
                },
            ),
        );
    });
});

describe("measureForMark", () => {
    const measures = [{ atBeat: 0 }, { atBeat: 4 }, { atBeat: 8 }];
    it("paused: the measure holding the playhead", () => {
        expect(measureForMark(measures, 7, false)?.atBeat).toBe(4);
        expect(measureForMark(measures, 7.9, false)?.atBeat).toBe(4);
        expect(measureForMark(measures, 8, false)?.atBeat).toBe(8);
    });
    it("playing: the nearest downbeat, a little early or late", () => {
        expect(measureForMark(measures, 7.6, true)?.atBeat).toBe(8);
        expect(measureForMark(measures, 8.4, true)?.atBeat).toBe(8);
        expect(measureForMark(measures, 5.9, true)?.atBeat).toBe(4);
    });
    it("no measure: null", () => {
        expect(measureForMark([], 3, false)).toBeNull();
        expect(measureForMark([], 3, true)).toBeNull();
        expect(measureForMark([{ atBeat: 4 }], 2, false)).toBeNull();
    });
});

describe("previousRehearsalMark", () => {
    it("is the last mark strictly before", () => {
        const measures = [
            { atBeat: 0, rehearsalMark: "A" },
            { atBeat: 4, rehearsalMark: null },
            { atBeat: 8, rehearsalMark: "B" },
        ];
        expect(previousRehearsalMark(measures, 8)).toBe("A");
        expect(previousRehearsalMark(measures, 9)).toBe("B");
        expect(previousRehearsalMark(measures, 0)).toBeNull();
    });
});

describe("planMeasureLineEdit", () => {
    describe("start", () => {
        it("adds a line, renumbering nothing but what follows", () => {
            const lines = linesEvery(4, 4);
            expect(beatsOf(run(lines, { kind: "start", beat: 3 }))).toEqual([
                1, 3, 5, 9, 13,
            ]);
        });
        it("on an existing line only sets the mark", () => {
            const lines = linesEvery(4, 4);
            const plan = planMeasureLineEdit(lines, bounds, {
                kind: "start",
                beat: 5,
                mark: "C",
            });
            expect(plan.creates).toEqual([]);
            expect(plan.updates).toEqual([{ id: 2, mark: "C" }]);
        });
        it("with a mark in a show without measures", () => {
            const plan = planMeasureLineEdit([], bounds, {
                kind: "start",
                beat: 9,
                mark: " C ",
            });
            expect(plan.creates).toEqual([{ beat: 9, mark: "C" }]);
        });
        it("throws outside the show or on the zero-length beat", () => {
            for (const beat of [0, 33, 2.5, -1])
                expect(() =>
                    planMeasureLineEdit([], bounds, { kind: "start", beat }),
                ).toThrow();
        });
    });

    describe("remove", () => {
        it("joins with the previous measure and names a dropped mark", () => {
            const lines = linesEvery(4, 4, { 2: "B" });
            const plan = planMeasureLineEdit(lines, bounds, {
                kind: "remove",
                measureId: 3,
            });
            expect(plan.deletes).toEqual([3]);
            expect(plan.droppedMarks).toEqual(["B"]);
        });
        it("refuses measure 1", () => {
            expect(() =>
                planMeasureLineEdit(linesEvery(4, 2), bounds, {
                    kind: "remove",
                    measureId: 1,
                }),
            ).toThrow();
        });
    });

    describe("mark", () => {
        it("renames, removes on empty, and skips no-ops", () => {
            const lines = linesEvery(4, 2, { 1: "C" });
            expect(
                planMeasureLineEdit(lines, bounds, {
                    kind: "mark",
                    measureId: 2,
                    mark: "D",
                }).updates,
            ).toEqual([{ id: 2, mark: "D" }]);
            expect(
                planMeasureLineEdit(lines, bounds, {
                    kind: "mark",
                    measureId: 2,
                    mark: "  ",
                }).updates,
            ).toEqual([{ id: 2, mark: null }]);
            expect(
                planMeasureLineEdit(lines, bounds, {
                    kind: "mark",
                    measureId: 2,
                    mark: "C",
                }).updates,
            ).toEqual([]);
        });
    });

    describe("setBeats", () => {
        // m1..m8 of 4 beats over beats 1–32, D at m6
        const lines = linesEvery(4, 8, { 5: "D" });
        it("later measures keep their beats: every later line moves", () => {
            const after = run(lines, {
                kind: "setBeats",
                measureId: 3,
                beats: 3,
                laterKeep: true,
            });
            expect(beatsOf(after)).toEqual([1, 5, 9, 12, 16, 20, 24, 28]);
            // D stays on m6
            expect(after[5]).toMatchObject({ id: 6, mark: "D" });
        });
        it("later measures keep their beats: lines pushed past the end go", () => {
            const plan = planMeasureLineEdit(
                linesEvery(4, 8, { 7: "H" }),
                bounds,
                { kind: "setBeats", measureId: 3, beats: 8, laterKeep: true },
            );
            expect(plan.deletes).toEqual([8]);
            expect(plan.droppedMarks).toEqual(["H"]);
        });
        it("unchecked: the next measure absorbs the difference", () => {
            const after = run(lines, {
                kind: "setBeats",
                measureId: 3,
                beats: 3,
                laterKeep: false,
            });
            expect(beatsOf(after)).toEqual([1, 5, 9, 12, 17, 21, 25, 29]);
        });
        it("unchecked: a longer measure merges the lines it passes", () => {
            const after = run(lines, {
                kind: "setBeats",
                measureId: 3,
                beats: 9,
                laterKeep: false,
            });
            expect(beatsOf(after)).toEqual([1, 5, 9, 18, 21, 25, 29]);
            // m4's line moved to 18; m5 (at 17) was merged into it
            expect(after[3]!.id).toBe(4);
        });
        it("unchecked: landing on a line keeps that line and the moved mark", () => {
            const marked = linesEvery(4, 8, { 3: "C" });
            const plan = planMeasureLineEdit(marked, bounds, {
                kind: "setBeats",
                measureId: 3,
                beats: 8,
                laterKeep: false,
            });
            expect(plan.deletes).toEqual([4]);
            expect(plan.updates).toEqual([{ id: 5, mark: "C" }]);
            expect(plan.droppedMarks).toEqual([]);
        });
        it("the last measure gets a line after it", () => {
            const after = run(lines, {
                kind: "setBeats",
                measureId: 8,
                beats: 2,
                laterKeep: true,
            });
            expect(beatsOf(after).slice(-2)).toEqual([29, 31]);
        });
        it("the same number of beats changes nothing", () => {
            const plan = planMeasureLineEdit(lines, bounds, {
                kind: "setBeats",
                measureId: 3,
                beats: 4,
                laterKeep: true,
            });
            expect(plan).toMatchObject({
                creates: [],
                updates: [],
                deletes: [],
            });
        });
    });

    describe("beatsFrom", () => {
        it("re-bars up to the next rehearsal mark", () => {
            // D at m6 (beat 21)
            const lines = linesEvery(4, 8, { 5: "D" });
            const after = run(lines, {
                kind: "beatsFrom",
                measureId: 2,
                beats: 6,
                until: "mark",
            });
            // 5, 11, 17 (4 beats before D), then D and after unchanged
            expect(beatsOf(after)).toEqual([1, 5, 11, 17, 21, 25, 29]);
            expect(after[4]).toMatchObject({ id: 6, mark: "D" });
        });
        it("re-bars to the end, adding lines when measures get shorter", () => {
            const after = run(linesEvery(4, 8), {
                kind: "beatsFrom",
                measureId: 7,
                beats: 2,
                until: "end",
            });
            expect(beatsOf(after).slice(6)).toEqual([25, 27, 29, 31]);
        });
    });

    it("never moves a line outside the show or onto another line", () => {
        const editArb = (ids: number[]) =>
            fc.oneof(
                fc.record({
                    kind: fc.constant("setBeats" as const),
                    measureId: fc.constantFrom(...ids),
                    beats: fc.integer({ min: 1, max: 12 }),
                    laterKeep: fc.boolean(),
                }),
                fc.record({
                    kind: fc.constant("beatsFrom" as const),
                    measureId: fc.constantFrom(...ids),
                    beats: fc.integer({ min: 1, max: 12 }),
                    until: fc.constantFrom("mark" as const, "end" as const),
                }),
            );
        fc.assert(
            fc.property(
                fc
                    .uniqueArray(fc.integer({ min: 2, max: 32 }), {
                        maxLength: 12,
                    })
                    .chain((starts) => {
                        const lines = [1, ...starts]
                            .sort((a, b) => a - b)
                            .map((beat, i) => ({
                                id: i + 1,
                                beat,
                                mark: i % 3 === 0 ? `M${i}` : null,
                            }));
                        return fc.tuple(
                            fc.constant(lines),
                            editArb(lines.map((l) => l.id)),
                        );
                    }),
                ([lines, edit]) => {
                    const after = run(lines, edit);
                    const beats = beatsOf(after);
                    expect(new Set(beats).size).toBe(beats.length);
                    for (const beat of beats) {
                        expect(beat).toBeGreaterThanOrEqual(1);
                        expect(beat).toBeLessThan(bounds.beatCount);
                    }
                    // Measure 1 never moves, and nothing before the edited measure does
                    expect(after[0]).toEqual(lines[0]);
                    const index = lines.findIndex(
                        (l) => l.id === edit.measureId,
                    );
                    expect(after.slice(0, index + 1)).toEqual(
                        lines.slice(0, index + 1),
                    );
                    // The edited measure gets its beats when the show has room
                    const next = after[index + 1];
                    if (next)
                        expect(
                            next.beat - lines[index]!.beat,
                        ).toBeLessThanOrEqual(edit.beats);
                },
            ),
        );
    });
});
