import { describe, expect, it } from "vitest";
import { countWeights, lostAt, planFit } from "../fitMusic";
import type { OnsetEnvelope } from "../onsets";
import { startsOf } from "../tempoMath";

const RATE = 200;

/** An envelope with a sharp peak of `strength` at each `[time, strength]` */
function envelope(
    hits: readonly (readonly [number, number])[],
    seconds: number,
): OnsetEnvelope {
    const values = new Float32Array(Math.ceil(seconds * RATE));
    for (const [t, s] of hits) {
        const i = Math.round(t * RATE);
        values[i - 1] = Math.max(values[i - 1] ?? 0, s * 0.4);
        values[i] = Math.max(values[i] ?? 0, s);
        values[i + 1] = Math.max(values[i + 1] ?? 0, s * 0.4);
    }
    return { rate: RATE, values, startSeconds: 0 };
}

const steady = (from: number, count: number, len: number, s = 1) =>
    Array.from({ length: count }, (_, k) => [from + k * len, s] as const);

describe("lostAt", () => {
    it("treats faint ticks under a held note as no hits", () => {
        // strong hits each second to 5 s, then faint ticks every 0.45 s
        const env = envelope(
            [...steady(1, 5, 1), ...steady(5.45, 8, 0.45, 0.12)],
            12,
        );
        // counts at 1 s that land on the ticks' times after 5 s
        const times = [1, 2, 3, 4, 5, 5.9, 6.8, 7.7];
        expect(lostAt(env, times)).toBe(4);
    });

    it("never loses steady music", () => {
        const env = envelope(steady(1, 20, 0.5), 12);
        const times = Array.from({ length: 20 }, (_, k) => 1 + k * 0.5);
        expect(lostAt(env, times)).toBe(-1);
    });
});

describe("planFit toEnd", () => {
    // music at 0.5 s counts from 1 s to 21 s (41 hits); the show guessed 0.6 s counts. Fitting
    // from the start moves the music 1 s earlier, so its first hit is on count 1.
    const env = envelope(steady(1, 41, 0.5), 24);
    const durations = [0, ...Array<number>(60).fill(0.6)];
    // where the old counts put the music's end: count 36 (0.6 × 35 = 21 s)
    const guessEnd = 36;

    it("stops at the guessed end without it", () => {
        const plan = planFit({
            env,
            durations,
            locks: new Set(),
            from: 1,
            to: guessEnd,
        });
        expect(plan.fittedTo).toBe(guessEnd);
    });

    it("goes on to the music's last hit, and the stored counts after it keep the tempo", () => {
        const plan = planFit({
            env,
            durations,
            locks: new Set(),
            from: 1,
            to: guessEnd,
            toEnd: { carryTo: 50 },
        });
        expect(plan.fittedTo).toBeGreaterThanOrEqual(41);
        const s = startsOf(plan.result.durations);
        for (let k = 1; k <= 41; k++)
            expect(s[k]).toBeCloseTo((k - 1) * 0.5, 1);
        // after the music, up to the stored counts' end: the last tempo carries on
        for (let k = plan.fittedTo; k < 50; k++)
            expect(plan.result.durations[k]).toBeCloseTo(0.5, 2);
    });
});

describe("countWeights", () => {
    it("keeps the shape inside a measure and lets a meter change go either way", () => {
        // a 4/4 bar (counts 1-4), a 7/8 bar 2+2+3 (5-7), a 6/8 bar 3+3 (8-9), a 3/4 bar (10-12)
        const units = [0, 2, 2, 2, 2, 2, 2, 3, 3, 3, 2, 2, 2];
        const { weights, shifts } = countWeights(units, [1, 5, 8, 10], 1, 13);
        expect(weights).toEqual([1, 1, 1, 1, 1, 1, 1.5, 1, 1, 1, 1, 1]);
        // into 6/8 the eighth may carry on (a count 1.5 as long); into 3/4, 2/3 as long
        expect(shifts).toEqual([1, 1, 1, 1, 1, 1, 1, 1.5, 1, 2 / 3, 1, 1]);
    });
});
