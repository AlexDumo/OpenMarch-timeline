import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { countTimes } from "@/timeline/tempo";
import { beatToX } from "../TimelineGeometry";
import {
    alignPixelsPerSecond,
    ALIGN_MAX_PX_PER_SECOND,
    ALIGN_MIN_PX_PER_SECOND,
    countsAxis,
    scrollKeepingBeat,
    secondsAxis,
} from "../timelineAxis";

// Four counts at 120 BPM, then one held for 2 s, then two more
const times = countTimes([0.5, 0.5, 0.5, 0.5, 2, 0.5, 0.5]);

describe("countsAxis", () => {
    it("draws exactly what the fixed-width timeline drew", () => {
        fc.assert(
            fc.property(
                fc.double({ min: 1, max: 64, noNaN: true }),
                fc.integer({ min: 1, max: 500 }),
                fc.double({ min: 0, max: 500, noNaN: true }),
                (pixelsPerBeat, beatCount, beat) => {
                    const axis = countsAxis(pixelsPerBeat, beatCount);
                    expect(axis.x(beat)).toBe(beatToX(beat, pixelsPerBeat));
                    expect(axis.span(2, beat)).toBe((beat - 2) * pixelsPerBeat);
                    expect(axis.beatAt(beat * pixelsPerBeat)).toBeCloseTo(
                        beat,
                        9,
                    );
                    expect(axis.width).toBe(beatCount * pixelsPerBeat);
                    expect(axis.pxPerBeatAt(beat)).toBe(pixelsPerBeat);
                },
            ),
        );
    });
});

describe("secondsAxis", () => {
    it("puts each count at its time × px/s", () => {
        const axis = secondsAxis({ times, pixelsPerSecond: 10 });
        expect(axis.kind).toBe("seconds");
        expect(axis.x(0)).toBe(0);
        expect(axis.x(4)).toBe(20);
        expect(axis.x(5)).toBe(40);
        expect(axis.x(7)).toBe(50);
        // A fraction of a count is that fraction of its seconds
        expect(axis.x(4.5)).toBe(30);
        expect(axis.extent).toBe(5);
        expect(axis.width).toBe(50);
        expect(axis.pxPerBeatAt(4)).toBe(20);
        expect(axis.pxPerBeatAt(1)).toBe(5);
    });

    it("finds the beat under a pixel, the inverse of x", () => {
        fc.assert(
            fc.property(
                fc.array(fc.double({ min: 0.15, max: 6, noNaN: true }), {
                    minLength: 1,
                    maxLength: 40,
                }),
                fc.double({ min: 2, max: 400, noNaN: true }),
                fc.double({ min: 0, max: 1, noNaN: true }),
                (durations, pixelsPerSecond, at) => {
                    const t = countTimes(durations);
                    const axis = secondsAxis({ times: t, pixelsPerSecond });
                    const beat = at * durations.length;
                    expect(axis.beatAt(axis.x(beat))).toBeCloseTo(beat, 6);
                },
            ),
        );
    });

    it("clamps the beat under a pixel to the show", () => {
        const axis = secondsAxis({ times, pixelsPerSecond: 10 });
        expect(axis.beatAt(-5)).toBe(0);
        expect(axis.beatAt(10_000)).toBe(7);
    });

    it("moves the counts by the origin, not the surface start", () => {
        const axis = secondsAxis({ times, pixelsPerSecond: 10, origin: 1.5 });
        expect(axis.x(0)).toBe(15);
        expect(axis.beatAt(15)).toBe(0);
        expect(axis.extent).toBe(6.5);
    });

    it("spans the recording when it is longer than the counts", () => {
        const axis = secondsAxis({
            times,
            pixelsPerSecond: 10,
            minExtent: 90,
        });
        expect(axis.extent).toBe(90);
        expect(axis.width).toBe(900);
        // Past the last count, the last beat
        expect(axis.beatAt(800)).toBe(7);
    });

    it("moves a clip by the counts under the pointer", () => {
        const axis = secondsAxis({ times, pixelsPerSecond: 10 });
        // From count 2, 20px is 2 s: two half-second counts, then half the held one
        expect(axis.beatOffset(2, 20)).toBeCloseTo(2.5, 9);
    });
});

describe("switching axes", () => {
    it("keeps the playhead's page width: px/s is px/count over seconds per count", () => {
        expect(alignPixelsPerSecond(16, 0.5)).toBe(32);
        expect(alignPixelsPerSecond(16, null)).toBe(32);
        expect(alignPixelsPerSecond(64, 0.01)).toBe(ALIGN_MAX_PX_PER_SECOND);
        expect(alignPixelsPerSecond(1, 30)).toBe(ALIGN_MIN_PX_PER_SECOND);
    });

    it("keeps the playhead at the same screen x", () => {
        const before = countsAxis(16, 7);
        const after = secondsAxis({
            times,
            pixelsPerSecond: alignPixelsPerSecond(16, 0.5),
        });
        const scrollLeft = 30;
        const beat = 5;
        const next = scrollKeepingBeat({ beat, before, after, scrollLeft });
        expect(after.x(beat) - next).toBe(before.x(beat) - scrollLeft);
    });
});
