import { describe, expect, it } from "vitest";
import {
    assignTaps,
    moveBeatTo,
    pinBeats,
    rampLengths,
    regroupMeasures,
    retime,
    startsOf,
    tempoSegments,
} from "../tempoMath";

/** beat 0 plus n counts of `len` seconds */
const even = (n: number, len = 0.5) => [0, ...Array<number>(n).fill(len)];

describe("moveBeatTo", () => {
    it("stretches the counts before and slides the rest when nothing is locked after", () => {
        const r = moveBeatTo(even(8), new Set(), 5, 2.4)!;
        const s = startsOf(r.durations);
        expect(s[5]).toBeCloseTo(2.4);
        expect(s[3]).toBeCloseTo(1.2);
        expect(r.durations[6]).toBeCloseTo(0.5);
        expect(r.locks.has(5)).toBe(true);
    });
    it("keeps the next lock where it is", () => {
        const r = moveBeatTo(even(8), new Set([7]), 5, 2.4)!;
        const s = startsOf(r.durations);
        expect(s[7]).toBeCloseTo(3);
        expect(s[6]).toBeCloseTo(2.7);
    });
    it("refuses a move past 400 BPM", () => {
        expect(moveBeatTo(even(8), new Set([4]), 5, 1.55)).toBeNull();
    });
});

describe("retime", () => {
    it("absorbs a tempo change before the next lock", () => {
        const r = retime(even(8), new Set([8]), 1, 3, rampLengths(2, 100));
        expect(startsOf(r.durations)[8]).toBeCloseTo(3.5);
        expect(r.note).toBeUndefined();
    });
    it("scales the edit when the lock is right after it", () => {
        const r = retime(even(8), new Set([3]), 1, 3, rampLengths(2, 100));
        expect(startsOf(r.durations)[3]).toBeCloseTo(1);
        expect(r.note).toBeDefined();
    });
    it("slides everything with no lock after", () => {
        const r = retime(even(8), new Set(), 1, 3, rampLengths(2, 60));
        expect(startsOf(r.durations)[8]).toBeCloseTo(4.5);
    });
});

describe("taps", () => {
    it("assigns taps to consecutive counts and to every other count", () => {
        const s = startsOf(even(16));
        expect(assignTaps(s, [1.02, 1.5, 2.01]).map((p) => p.beat)).toEqual([
            3, 4, 5,
        ]);
        expect(assignTaps(s, [0.02, 1.0, 2.0]).map((p) => p.beat)).toEqual([
            1, 3, 5,
        ]);
    });
    it("pins tapped counts", () => {
        const r = pinBeats(even(16), new Set(), [
            { beat: 3, seconds: 1.1 },
            { beat: 4, seconds: 1.7 },
        ]);
        const s = startsOf(r.durations);
        expect(s[3]).toBeCloseTo(1.1);
        expect(s[4]).toBeCloseTo(1.7);
    });
});

describe("tempoSegments", () => {
    it("finds steady runs and ramps", () => {
        const d = [
            0,
            ...rampLengths(8, 120),
            ...rampLengths(8, 120, 80),
            ...rampLengths(8, 80),
        ];
        const segs = tempoSegments(d);
        expect(segs[0]).toMatchObject({ from: 1, to: 10, ramp: false });
        expect(segs.some((s) => s.ramp)).toBe(true);
        expect(segs[segs.length - 1]!.to).toBe(25);
    });
});

describe("regroupMeasures", () => {
    it("regroups a run of 4-count measures into 3s", () => {
        const r = regroupMeasures([1, 5, 9, 13, 17, 19], 21, 5, 3);
        expect(r).toEqual({
            from: 5,
            to: 17,
            starts: [5, 8, 11, 14],
            leftover: 0,
        });
    });
});
