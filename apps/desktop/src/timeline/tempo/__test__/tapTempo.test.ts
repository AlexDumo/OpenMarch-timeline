import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { tempoFromTaps } from "../tapTempo";
import { bpmOfRange, isEvenRange, pageTempos } from "../tempoReadout";

const taps = (n: number, period: number, start = 1) =>
    Array.from({ length: n }, (_, i) => start + i * period);

describe("tempoFromTaps", () => {
    it("needs two taps", () => {
        expect(tempoFromTaps([])).toBeNull();
        expect(tempoFromTaps([1])).toBeNull();
    });
    it("fits steady taps exactly", () => {
        const r = tempoFromTaps(taps(8, 0.5, 2))!;
        expect(r.bpm).toBeCloseTo(120, 6);
        expect(r.firstBeatTime).toBeCloseTo(2, 6);
        expect(r.confidence).toBeCloseTo(1, 6);
        expect(r.rejected).toEqual([]);
    });
    it("ignores a late first tap", () => {
        const t = taps(8, 0.5, 2);
        t[0] += 0.08;
        const r = tempoFromTaps(t)!;
        expect(r.bpm).toBeCloseTo(120, 6);
        expect(r.firstBeatTime).toBeCloseTo(2, 6);
    });
    it("counts a missed tap as two beats", () => {
        const t = taps(9, 0.4);
        t.splice(4, 1);
        const r = tempoFromTaps(t)!;
        expect(r.bpm).toBeCloseTo(150, 6);
        expect(r.beats[4]).toBe(5);
    });
    it("drops a double tap and a stray tap", () => {
        const t = taps(10, 0.5);
        t.splice(5, 0, t[4] + 0.03); // double tap
        t[8] += 0.2; // stray
        const r = tempoFromTaps(t)!;
        expect(r.bpm).toBeCloseTo(120, 6);
        expect(r.rejected).toContain(5);
        expect(r.rejected).toContain(8);
    });
    it("is close for jittery taps", () => {
        fc.assert(
            fc.property(
                fc.double({ min: 60, max: 200, noNaN: true }),
                fc.array(fc.double({ min: -0.015, max: 0.015, noNaN: true }), {
                    minLength: 8,
                    maxLength: 16,
                }),
                (bpm, jitter) => {
                    const period = 60 / bpm;
                    const t = jitter.map((j, i) => 3 + i * period + j);
                    const r = tempoFromTaps(t)!;
                    expect(Math.abs(r.bpm - bpm) / bpm).toBeLessThan(0.02);
                    expect(Math.abs(r.firstBeatTime - 3)).toBeLessThan(0.03);
                },
            ),
        );
    });
    it("is less confident with fewer or uneven taps", () => {
        expect(tempoFromTaps(taps(3, 0.5))!.confidence).toBeLessThan(0.5);
        const uneven = [0, 0.5, 1.08, 1.45, 2.06, 2.47, 3.04, 3.5];
        expect(tempoFromTaps(uneven)!.confidence).toBeLessThan(0.8);
    });
});

describe("read-outs", () => {
    it("averages a range", () => {
        expect(bpmOfRange([0, 0.5, 0.5], 1, 3)).toBeCloseTo(120, 9);
        expect(bpmOfRange([0, 0.5], 0, 1)).toBeNull();
        expect(bpmOfRange([0, 0.5], 1, 1)).toBeNull();
    });
    it("knows exact from approximate", () => {
        expect(isEvenRange([0, 0.4, 0.4, 0.4], 1, 4)).toBe(true);
        expect(isEvenRange([0, 0.4, 0.5], 1, 3)).toBe(false);
    });
    it("lists page tempos", () => {
        const ds = [0, 0.5, 0.5, 0.4, 0.6];
        expect(pageTempos(ds, [1, 3])).toEqual([
            { from: 1, to: 3, bpm: 120, even: true },
            { from: 3, to: 5, bpm: 120, even: false },
        ]);
    });
});
