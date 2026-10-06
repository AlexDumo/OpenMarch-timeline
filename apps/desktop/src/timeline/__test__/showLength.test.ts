import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
    continuedCounts,
    countContinuation,
    countsToCoverAudio,
    countsToReach,
    formatMinutesSeconds,
    measuresToCoverAudio,
    musicEndSeconds,
    musicRunsPastCounts,
    MUSIC_END_TOLERANCE_SECONDS,
} from "../showLength";
import { waveformWithPastEnd } from "../timelineWaveform";

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

describe("countsToReach", () => {
    const fourFour = countContinuation({
        beats: show(...repeat(80, 0.5)),
        measureStarts: Array.from({ length: 20 }, (_, i) => 1 + i * 4),
    });

    it("covers the music, ending on a bar line", () => {
        // 40 s of counts, music to 2:31: 111 s is 222 counts, so 56 measures (224)
        expect(
            countsToReach({
                continuation: fourFour,
                endSeconds: 40,
                untilSeconds: 151,
            }),
        ).toBe(224);
    });

    it("without measures, just enough counts", () => {
        expect(
            countsToReach({
                continuation: countContinuation({
                    beats: show(...repeat(80, 0.5)),
                    measureStarts: [],
                }),
                endSeconds: 40,
                untilSeconds: 151,
            }),
        ).toBe(222);
    });

    it("doesn't add a measure for the last few milliseconds of the music", () => {
        expect(
            countsToReach({
                continuation: fourFour,
                endSeconds: 40,
                untilSeconds: 40.004,
            }),
        ).toBe(0);
    });

    it("adds nothing when the show is long enough", () => {
        expect(
            countsToReach({
                continuation: fourFour,
                endSeconds: 40,
                untilSeconds: 40,
            }),
        ).toBe(0);
        expect(
            countsToReach({
                continuation: fourFour,
                endSeconds: 40,
                untilSeconds: 12,
            }),
        ).toBe(0);
    });

    it("is the fewest counts that reach the end, then the rest of that measure", () => {
        fc.assert(
            fc.property(
                fc.array(fc.double({ min: 0.2, max: 1.5, noNaN: true }), {
                    minLength: 1,
                    maxLength: 24,
                }),
                fc.array(fc.integer({ min: 1, max: 24 }), { maxLength: 6 }),
                fc.double({ min: -5, max: 120, noNaN: true }),
                (durations, starts, past) => {
                    const beats = show(...durations);
                    const continuation = countContinuation({
                        beats,
                        measureStarts: starts,
                    });
                    const endSeconds = durations.reduce((a, b) => a + b, 0);
                    const untilSeconds = endSeconds + past;
                    const k = countsToReach({
                        continuation,
                        endSeconds,
                        untilSeconds,
                    });
                    const timeAfter = (n: number) =>
                        continuedCounts(continuation, n).reduce(
                            (t, count) => t + count.duration,
                            endSeconds,
                        );
                    let fewest = 0;
                    while (
                        timeAfter(fewest) <
                        untilSeconds - MUSIC_END_TOLERANCE_SECONDS
                    )
                        fewest++;
                    expect(timeAfter(k)).toBeGreaterThanOrEqual(
                        untilSeconds - MUSIC_END_TOLERANCE_SECONDS,
                    );
                    expect(k).toBeGreaterThanOrEqual(fewest);
                    if (!continuation.measured || fewest === 0)
                        expect(k).toBe(fewest);
                    else {
                        expect(continuation.isDownbeat(k)).toBe(true);
                        for (let n = fewest; n < k; n++)
                            expect(continuation.isDownbeat(n)).toBe(false);
                    }
                },
            ),
        );
    });
});

describe("a new show's length from its audio", () => {
    it("tempo only: whole measures to the end of the recording, at least the starter 20", () => {
        const at = (audioSeconds: number | null, beatsPerMeasure = 4) =>
            measuresToCoverAudio({
                audioSeconds,
                beatDuration: 0.5,
                beatsPerMeasure,
                minMeasures: 20,
            });
        expect(at(151)).toBe(76);
        expect(at(60)).toBe(30);
        expect(at(60, 3)).toBe(40);
        expect(at(10)).toBe(20);
        expect(at(null)).toBe(20);
        expect(at(0)).toBe(20);
        expect(at(Number.NaN)).toBe(20);
    });

    it("skip: counts to the end of the recording, at least 128", () => {
        expect(
            countsToCoverAudio({ audioSeconds: 151, beatDuration: 0.5 }),
        ).toBe(302);
        expect(
            countsToCoverAudio({ audioSeconds: 30, beatDuration: 0.5 }),
        ).toBe(128);
        expect(
            countsToCoverAudio({ audioSeconds: undefined, beatDuration: 0.5 }),
        ).toBe(128);
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

    it("offers extending only when more than a count of music is left", () => {
        const continuation = countContinuation({
            beats: show(0.5),
            measureStarts: [],
        });
        const past = (musicEnd: number | null) =>
            musicRunsPastCounts({
                countsEndSeconds: 40,
                musicEnd,
                continuation,
            });
        expect(past(151)).toBe(true);
        expect(past(40.4)).toBe(false);
        expect(past(30)).toBe(false);
        expect(past(null)).toBe(false);
    });

    it("formats times as the player does", () => {
        expect(formatMinutesSeconds(151.9)).toBe("2:31");
        expect(formatMinutesSeconds(40)).toBe("0:40");
        expect(formatMinutesSeconds(5)).toBe("0:05");
        expect(formatMinutesSeconds(-1)).toBe("0:00");
    });
});

describe("the waveform past the last count", () => {
    // 10 s at 10 values a second: quiet for 4 s, loud after
    const envelope = {
        peaks: Float32Array.from({ length: 100 }, (_, i) =>
            i < 40 ? 0.01 : 1,
        ),
        rate: 10,
    };
    const beats = [
        { timestamp: 0, duration: 0 },
        ...Array.from({ length: 4 }, (_, i) => ({
            timestamp: i,
            duration: 1,
        })),
    ];

    it("draws the music after the last count on continued counts, until the music ends", () => {
        const { peaksByBeat, peaksPastEnd } = waveformWithPastEnd(
            envelope,
            beats,
            1,
            { durationAt: () => 2, musicEnd: 10 },
            2,
        );
        expect(peaksByBeat.length).toBe(4);
        // 4 s to 10 s in counts of 2 s
        expect(peaksPastEnd.length).toBe(3);
        expect(peaksPastEnd.flat()).toEqual(Array(6).fill(1));
        // One scale for both, set by the show's loudest moment (UI-12): the louder music past
        // the end can't shrink the show's waveform, and is clipped at the top
        expect(peaksByBeat.flat()[0]).toBeCloseTo(1);
    });

    it("draws nothing past the end without music there", () => {
        expect(
            waveformWithPastEnd(envelope, beats, 1, {
                durationAt: () => 2,
                musicEnd: null,
            }).peaksPastEnd,
        ).toEqual([]);
        expect(
            waveformWithPastEnd(envelope, beats, 1, {
                durationAt: () => 2,
                musicEnd: 3,
            }).peaksPastEnd,
        ).toEqual([]);
    });
});
