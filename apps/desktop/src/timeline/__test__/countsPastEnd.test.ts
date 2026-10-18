import { describe, expect, it } from "vitest";
import {
    continuedCounts,
    countContinuation,
    musicEndBeat,
    musicEndSeconds,
    pageFlagsToEnd,
} from "../countsPastEnd";

/** Beat 0 (zero length) and then `durations` */
const show = (...durations: number[]) => [
    { duration: 0 },
    ...durations.map((duration) => ({ duration })),
];
const repeat = <T>(n: number, value: T): T[] => Array(n).fill(value);

describe("countContinuation", () => {
    it("without measures, carries on at the last count's length", () => {
        const c = countContinuation({
            beats: show(0.5, 0.5, 0.4),
            measureStarts: [],
        });
        expect(c.measured).toBe(false);
        expect(continuedCounts(c, 3)).toEqual(
            repeat(3, { duration: 0.4, downbeat: false }),
        );
    });

    it("with no counts at all, uses the fallback (120 BPM)", () => {
        const c = countContinuation({ beats: show(), measureStarts: [] });
        expect(c.durationAt(0)).toBe(0.5);
        expect(
            countContinuation({
                beats: show(),
                measureStarts: [],
                fallbackDuration: 0.25,
            }).durationAt(5),
        ).toBe(0.25);
    });

    it("after a complete 4/4 measure, starts a measure on the first new count", () => {
        const c = countContinuation({
            beats: show(...repeat(8, 0.5)),
            measureStarts: [5, 1],
        });
        expect(
            continuedCounts(c, 9).flatMap((count, k) =>
                count.downbeat ? [k] : [],
            ),
        ).toEqual([0, 4, 8]);
    });

    it("finishes a short last measure first", () => {
        // 4/4, then a last measure of 2 counts
        const c = countContinuation({
            beats: show(...repeat(6, 0.5)),
            measureStarts: [1, 5],
        });
        expect(
            continuedCounts(c, 7).flatMap((count, k) =>
                count.downbeat ? [k] : [],
            ),
        ).toEqual([2, 6]);
    });

    it("carries a mixed meter's long and short counts on", () => {
        // 7/8 as 2+2+3, shown as three counts: short, short, long
        const bar = [0.3, 0.3, 0.45];
        const c = countContinuation({
            beats: show(...bar, ...bar),
            measureStarts: [1, 4],
        });
        expect(continuedCounts(c, 6).map((count) => count.duration)).toEqual([
            ...bar,
            ...bar,
        ]);
    });

    it("takes the last measure's tempo, not the one before", () => {
        const c = countContinuation({
            beats: show(...repeat(4, 0.5), ...repeat(4, 0.6)),
            measureStarts: [1, 5],
        });
        expect(c.durationAt(0)).toBe(0.6);
        expect(c.durationAt(3)).toBe(0.6);
    });

    it("with one measure, that measure is the meter", () => {
        const c = countContinuation({
            beats: show(...repeat(3, 0.5)),
            measureStarts: [1],
        });
        expect(
            continuedCounts(c, 7).flatMap((count, k) =>
                count.downbeat ? [k] : [],
            ),
        ).toEqual([0, 3, 6]);
    });
});

describe("where the music ends", () => {
    const envelope = (...peaks: number[]) => ({
        peaks: Float32Array.from(peaks),
        rate: 10,
    });

    it("ignores trailing silence and anything the waveform wouldn't draw", () => {
        expect(musicEndSeconds(envelope(0.5, 1, 0.2, 0, 0, 0), 42)).toBe(0.3);
        // 1e-3 is 60 dB down: below a 42 dB floor, so not music
        expect(musicEndSeconds(envelope(1, 0.5, 1e-3, 1e-3), 42)).toBe(0.2);
        expect(musicEndSeconds(envelope(0, 0), 42)).toBeNull();
        expect(musicEndSeconds(envelope(), 42)).toBeNull();
    });
});

describe("musicEndBeat", () => {
    // Half-second counts: `seconds` is at beat `seconds * 2`
    const grid = {
        storedCount: 9,
        beatAtTime: (seconds: number) => seconds * 2,
    };

    it("is the first whole count at or after the music's end", () => {
        expect(musicEndBeat(grid, 16)).toBe(32);
        expect(musicEndBeat(grid, 16.1)).toBe(33);
        expect(musicEndBeat(grid, 15.9)).toBe(32);
    });

    it("doesn't round a hair of float error up to the next count", () => {
        expect(musicEndBeat(grid, 16 + 1e-9)).toBe(32);
    });

    it("is 0 with no counts", () => {
        expect(musicEndBeat({ storedCount: 0, beatAtTime: () => 0 }, 12)).toBe(
            0,
        );
    });
});

describe("pageFlagsToEnd (EC-10)", () => {
    it("puts a flag every N counts, and a shorter last page on the end", () => {
        expect(pageFlagsToEnd(49, 97, 16)).toEqual([65, 81, 97]);
        expect(pageFlagsToEnd(49, 100, 16)).toEqual([65, 81, 97, 100]);
        expect(pageFlagsToEnd(97, 97, 16)).toEqual([]);
        expect(pageFlagsToEnd(1, 5, 0)).toEqual([]);
    });
});
