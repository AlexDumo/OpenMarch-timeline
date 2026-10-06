import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { countTimes, MIN_COUNT_SECONDS } from "../retime";
import { tempoFromTaps } from "../tapTempo";
import {
    addTap,
    canApplyTaps,
    formatMusicTime,
    nextMultiplier,
    planTapTheBeat,
    showLineUpStrip,
    tapProgress,
} from "../tapTheBeat";

/** A show: the fixed zero-length count 0, then `n` counts of `each` seconds. */
const flat = (n: number, each: number) => [
    0,
    ...Array.from({ length: n }, () => each),
];
const taps = (n: number, period: number, start: number) =>
    Array.from({ length: n }, (_, i) => start + i * period);
const fitOf = (times: number[]) => tempoFromTaps(times)!;

describe("planTapTheBeat from the start", () => {
    it("puts count 1 on the first tap and every count on the tapped beat", () => {
        // Dana's show: flat 120 against music at 138 that starts 1.6 s in
        const durations = flat(64, 0.5);
        const p = 60 / 138;
        const plan = planTapTheBeat({
            durations,
            start: { kind: "start" },
            fit: fitOf(taps(8, p, 1.6)),
        })!;
        expect(plan.originShift).toBeCloseTo(1.6, 9);
        expect(plan.bpm).toBeCloseTo(138, 6);
        expect(plan.fromCount).toBe(1);
        expect(plan.durations[0]).toBe(0);
        // Count k lands at 1.6 + (k - 1) p in the old show time (the music's time here)
        const times = countTimes(plan.durations);
        for (const k of [1, 2, 8, 30, 64])
            expect(times[k] + plan.originShift).toBeCloseTo(
                1.6 + (k - 1) * p,
                9,
            );
        expect(plan.clamped).toBe(false);
    });

    it("scales a score's tempo change instead of flattening it", () => {
        // Counts 1-8 at 0.5 s, then a slower section at 0.75 s (2:3)
        const durations = [0, ...Array(8).fill(0.5), ...Array(8).fill(0.75)];
        const plan = planTapTheBeat({
            durations,
            start: { kind: "start" },
            fit: fitOf(taps(8, 0.4, 0)),
        })!;
        for (let i = 1; i <= 8; i++)
            expect(plan.durations[i]).toBeCloseTo(0.4, 9);
        for (let i = 9; i <= 16; i++)
            expect(plan.durations[i]).toBeCloseTo(0.6, 9);
    });

    it("keeps relative lengths for any show (property)", () => {
        fc.assert(
            fc.property(
                fc.array(fc.double({ min: 0.2, max: 2, noNaN: true }), {
                    minLength: 10,
                    maxLength: 60,
                }),
                fc.double({ min: 0.3, max: 0.9, noNaN: true }),
                fc.double({ min: 0, max: 5, noNaN: true }),
                (counts, period, at) => {
                    const durations = [0, ...counts];
                    const plan = planTapTheBeat({
                        durations,
                        start: { kind: "start" },
                        fit: fitOf(taps(8, period, at)),
                    });
                    if (!plan || plan.clamped) return;
                    expect(plan.durations).toHaveLength(durations.length);
                    const k = plan.durations[1] / durations[1];
                    for (let i = 1; i < durations.length; i++)
                        expect(plan.durations[i] / durations[i]).toBeCloseTo(
                            k,
                            9,
                        );
                    // The tapped stretch lasts as long as the taps say
                    const t = countTimes(plan.durations);
                    expect(t[plan.tapped.to] - t[1]).toBeCloseTo(
                        (plan.tapped.to - 1) * period,
                        9,
                    );
                },
            ),
        );
    });
});

describe("planTapTheBeat from here", () => {
    // Counts are right at 138 up to count 41; the music slows to 112 there
    const before = 60 / 138;
    const after = 60 / 112;
    const durations = flat(80, before);
    const c = 41;
    const tc = countTimes(durations)[c];

    it("keeps everything before the playhead and follows the taps after it", () => {
        const plan = planTapTheBeat({
            durations,
            start: { kind: "here", count: c },
            fit: fitOf(taps(8, after, tc)),
        })!;
        expect(plan.originShift).toBe(0);
        expect(plan.fromCount).toBe(c);
        for (let i = 0; i < c; i++)
            expect(plan.durations[i]).toBe(durations[i]);
        const times = countTimes(plan.durations);
        for (let j = 0; j < 30; j++)
            expect(times[c + j]).toBeCloseTo(tc + j * after, 9);
        expect(plan.bpm).toBeCloseTo(112, 6);
    });

    it("lines the next count up with the taps when tapping starts off a count", () => {
        // Taps start 2.3 new beats after the playhead's count: count c + 2 lands on the first tap
        const first = tc + 2.3 * after;
        const plan = planTapTheBeat({
            durations,
            start: { kind: "here", count: c },
            fit: fitOf(taps(8, after, first)),
        })!;
        expect(plan.tapped.from).toBe(c + 2);
        const times = countTimes(plan.durations);
        expect(times[c]).toBeCloseTo(tc, 9);
        expect(times[c + 2]).toBeCloseTo(first, 9);
        expect(times[c + 9]).toBeCloseTo(first + 7 * after, 9);
    });

    it("never moves the playhead's count, even when the first tap is on it or before it", () => {
        for (const first of [tc - 0.1, tc - 1.5 * after, tc + 0.2 * after]) {
            const plan = planTapTheBeat({
                durations,
                start: { kind: "here", count: c },
                fit: fitOf(taps(8, after, first)),
            })!;
            const times = countTimes(plan.durations);
            expect(times[c]).toBeCloseTo(tc, 9);
            expect(plan.tapped.from).toBe(c + 1);
            // Count c absorbs the phase: between half and one and a half beats
            const len = plan.durations[c];
            expect(len).toBeGreaterThanOrEqual(0.5 * after - 1e-9);
            expect(len).toBeLessThanOrEqual(1.5 * after + 1e-9);
        }
    });

    it("scales later score tempo changes proportionally", () => {
        // From count 41 the score has 8 counts at 0.5, then 8 at 1.0 (a half-time feel)
        const shaped = [
            0,
            ...Array(40).fill(0.5),
            ...Array(8).fill(0.5),
            ...Array(8).fill(1),
        ];
        const t41 = countTimes(shaped)[41];
        const plan = planTapTheBeat({
            durations: shaped,
            start: { kind: "here", count: 41 },
            fit: fitOf(taps(8, 0.55, t41)),
        })!;
        for (let i = 42; i <= 48; i++)
            expect(plan.durations[i]).toBeCloseTo(0.55, 9);
        for (let i = 49; i <= 56; i++)
            expect(plan.durations[i]).toBeCloseTo(1.1, 9);
    });
});

describe("planTapTheBeat details", () => {
    it("×2 and ÷2 take the taps as twice or half as fast", () => {
        const durations = flat(32, 0.5);
        const fit = fitOf(taps(8, 0.8, 0));
        const double = planTapTheBeat({
            durations,
            start: { kind: "start" },
            fit,
            multiplier: 2,
        })!;
        expect(double.bpm).toBeCloseTo(150, 6);
        expect(double.durations[5]).toBeCloseTo(0.4, 9);
        // Eight taps two counts apart span fourteen counts
        expect(double.tapped).toEqual({ from: 1, to: 15 });
        const half = planTapTheBeat({
            durations,
            start: { kind: "start" },
            fit,
            multiplier: 0.5,
        })!;
        expect(half.bpm).toBeCloseTo(37.5, 6);
        expect(half.durations[5]).toBeCloseTo(1.6, 9);
    });

    it("keeps the first synced count after the taps on the music", () => {
        const durations = flat(40, 0.5);
        const synced = [30];
        const oldTimes = countTimes(durations);
        const plan = planTapTheBeat({
            durations,
            start: { kind: "start" },
            fit: fitOf(taps(8, 0.45, 1)),
            synced,
        })!;
        const times = countTimes(plan.durations);
        expect(times[30] + plan.originShift).toBeCloseTo(oldTimes[30], 9);
        expect(plan.heldFrom).toBe(30);
        for (let i = 30; i <= 40; i++)
            expect(plan.durations[i]).toBe(durations[i]);
        expect(plan.unsynced).toEqual([]);
    });

    it("reports a synced count inside the tapped stretch as moved", () => {
        const durations = flat(40, 0.5);
        const plan = planTapTheBeat({
            durations,
            start: { kind: "start" },
            fit: fitOf(taps(8, 0.45, 1)),
            synced: [4],
        })!;
        expect(plan.unsynced).toEqual([4]);
    });

    it("clamps taps faster than the count limit", () => {
        const plan = planTapTheBeat({
            durations: flat(16, 0.5),
            start: { kind: "start" },
            fit: fitOf(taps(8, 0.1, 0)),
        })!;
        expect(plan.clamped).toBe(true);
        for (let i = 1; i <= 16; i++)
            expect(plan.durations[i]).toBeGreaterThanOrEqual(
                MIN_COUNT_SECONDS - 1e-12,
            );
    });

    it("needs counts to retime", () => {
        expect(
            planTapTheBeat({
                durations: [0],
                start: { kind: "start" },
                fit: fitOf(taps(8, 0.5, 0)),
            }),
        ).toBeNull();
    });
});

describe("tap feedback", () => {
    it("asks for more taps until the beat is steady", () => {
        expect(tapProgress(1, null).kind).toBe("waiting");
        const three = taps(3, 0.5, 0);
        expect(tapProgress(3, tempoFromTaps(three)).kind).toBe("keepGoing");
        const eight = taps(8, 0.5, 0);
        expect(tapProgress(8, tempoFromTaps(eight)).kind).toBe("steady");
        const shaky = eight.map((t, i) => t + (i % 2 ? 0.06 : -0.06));
        expect(tapProgress(8, tempoFromTaps(shaky)).kind).toBe("keepGoing");
    });
    it("applies from four taps", () => {
        expect(canApplyTaps(3, tempoFromTaps(taps(3, 0.5, 0)))).toBe(false);
        expect(canApplyTaps(4, tempoFromTaps(taps(4, 0.5, 0)))).toBe(true);
        expect(canApplyTaps(4, null)).toBe(false);
    });
    it("steps ×2 and ÷2 between half and double", () => {
        expect(nextMultiplier(1, "up")).toBe(2);
        expect(nextMultiplier(2, "up")).toBe(2);
        expect(nextMultiplier(0.5, "up")).toBe(1);
        expect(nextMultiplier(1, "down")).toBe(0.5);
        expect(nextMultiplier(2, "down")).toBe(1);
    });
});

describe("showLineUpStrip", () => {
    const base = {
        enabled: true,
        hasAudio: true,
        syncedCount: 0,
        dismissed: false,
        audioOffsetSeconds: 0,
    };
    it("shows for music nobody has lined up", () => {
        expect(showLineUpStrip(base)).toBe(true);
    });
    it.each([
        ["the flag is off", { enabled: false }],
        ["there is no music", { hasAudio: false }],
        ["counts are synced", { syncedCount: 2 }],
        ["it was dismissed or applied", { dismissed: true }],
        ["the music start was set", { audioOffsetSeconds: -1.6 }],
    ])("hides when %s", (_, change) => {
        expect(showLineUpStrip({ ...base, ...change })).toBe(false);
    });
});

describe("formatMusicTime", () => {
    it.each([
        [1.84, "0:01.84"],
        [0, "0:00.00"],
        [75.5, "1:15.50"],
        [59.999, "1:00.00"],
        [-0.5, "-0:00.50"],
    ])("%s → %s", (s, text) => {
        expect(formatMusicTime(s)).toBe(text);
    });
});

describe("addTap", () => {
    it("adds taps in order", () => {
        expect(addTap(addTap([], 1), 1.5)).toEqual([1, 1.5]);
    });
    it("starts a new run after a jump back or a long gap", () => {
        expect(addTap([1, 1.5, 2], 0.4)).toEqual([0.4]);
        expect(addTap([1, 1.5, 2], 5.5)).toEqual([5.5]);
    });
});
