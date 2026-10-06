import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { countTimes } from "@/timeline/tempo";
import type { AlignPage } from "../timelineAlign";
import {
    addPunchTap,
    countInFrom,
    DOUBLE_TAP_MS,
    dropLastPunchTap,
    EMPTY_PUNCH_TAP,
    NO_TARGET_LEFT,
    punchTapResult,
    punchTargets,
    retargetPunchTap,
    suspectTaps,
    syncedAfterTaps,
    tappedPages,
    targetAtOrAfter,
    targetName,
    upcomingTarget,
    type PunchTapState,
} from "../timelinePunchTap";

/** The fixed zero-length beat 0, then `n` counts of `d` seconds */
const steady = (n: number, d = 0.5) => [0, ...Array<number>(n).fill(d)];

/** Four 8-count pages, 10–13, from count 1 (spec indexes) */
const pages: AlignPage[] = [10, 11, 12, 13].map((label, i) => ({
    id: label,
    label: String(label),
    start: 1 + i * 8,
    end: 9 + i * 8,
}));
const durations = steady(32);
const pageTargets = punchTargets(pages, durations.length, "page");

/** Taps `times` in order, each 500 ms after the last, from `state` */
const tapAll = (
    times: readonly number[],
    targets: readonly number[],
    state: PunchTapState = EMPTY_PUNCH_TAP,
    firstTarget?: number,
) => {
    let s = firstTarget === undefined ? state : { ...state, next: firstTarget };
    let stamp = (s.lastStamp ?? 0) + 1000;
    for (const time of times) {
        s = addPunchTap(s, { target: s.next!, time, stamp, targets });
        stamp += 500;
    }
    return s;
};

describe("punchTargets", () => {
    it("page mode: count 1 and every flag but the end of the show", () => {
        expect(pageTargets).toEqual([1, 9, 17, 25]);
    });
    it("count mode: every count from the first page's start", () => {
        const counts = punchTargets(pages, durations.length, "count");
        expect(counts[0]).toBe(1);
        expect(counts[counts.length - 1]).toBe(32);
        expect(counts).toHaveLength(32);
    });
    it("no pages, nothing to tap", () => {
        expect(punchTargets([], 10, "page")).toEqual([]);
    });
});

describe("tap → target", () => {
    it("each tap sets the next target, in order", () => {
        const s = tapAll([4.1, 8.3, 12.2], pageTargets, EMPTY_PUNCH_TAP, 9);
        expect(s.taps).toEqual([
            { index: 9, time: 4.1 },
            { index: 17, time: 8.3 },
            { index: 25, time: 12.2 },
        ]);
        expect(s.next).toBe(NO_TARGET_LEFT);
        // Nothing left: a further tap does nothing
        expect(
            addPunchTap(s, {
                target: s.next!,
                time: 16,
                stamp: 99999,
                targets: pageTargets,
            }),
        ).toBe(s);
    });

    it("count mode steps count by count", () => {
        const counts = punchTargets(pages, durations.length, "count");
        const s = tapAll([5, 5.6, 6.1], counts, EMPTY_PUNCH_TAP, 11);
        expect(s.taps.map((t) => t.index)).toEqual([11, 12, 13]);
        expect(s.next).toBe(14);
    });

    it("paused, the target is the first at or after where the selection starts", () => {
        expect(targetAtOrAfter(pageTargets, 9)).toBe(9);
        expect(targetAtOrAfter(pageTargets, 10)).toBe(17);
        expect(targetAtOrAfter(pageTargets, 26)).toBeNull();
    });

    it("playing without a target: the next flag the music hasn't passed, a little late still hits it", () => {
        // Flag 9 is at 4 s, flag 17 at 8 s; a count is 0.5 s
        expect(upcomingTarget(pageTargets, durations, 3)).toBe(9);
        expect(upcomingTarget(pageTargets, durations, 4.2)).toBe(9);
        expect(upcomingTarget(pageTargets, durations, 4.3)).toBe(17);
        expect(upcomingTarget(pageTargets, durations, 99)).toBeNull();
    });

    it("count-in: a page before in page mode, 8 counts in count mode", () => {
        expect(countInFrom(pageTargets, 17, "page")).toBe(9);
        expect(countInFrom(pageTargets, 1, "page")).toBe(0);
        expect(countInFrom([], 20, "count")).toBe(12);
        expect(countInFrom([], 3, "count")).toBe(0);
    });
});

describe("mistakes", () => {
    it("a second tap within 120 ms is a bounce and is ignored", () => {
        const one = addPunchTap(
            { ...EMPTY_PUNCH_TAP, next: 9 },
            { target: 9, time: 4, stamp: 1000, targets: pageTargets },
        );
        const bounce = addPunchTap(one, {
            target: one.next!,
            time: 4.05,
            stamp: 1000 + DOUBLE_TAP_MS - 1,
            targets: pageTargets,
        });
        expect(bounce).toBe(one);
        const real = addPunchTap(one, {
            target: one.next!,
            time: 8,
            stamp: 1000 + DOUBLE_TAP_MS,
            targets: pageTargets,
        });
        expect(real.taps).toHaveLength(2);
    });

    it("Backspace drops the last tap and steps the target back", () => {
        const s = tapAll([4.1, 8.3, 12.2], pageTargets, EMPTY_PUNCH_TAP, 9);
        const back = dropLastPunchTap(s);
        expect(back.taps.map((t) => t.index)).toEqual([9, 17]);
        expect(back.next).toBe(25);
        const twice = dropLastPunchTap(back);
        expect(twice.taps.map((t) => t.index)).toEqual([9]);
        expect(twice.next).toBe(17);
        // The re-tap after Backspace is never taken for a bounce
        const again = addPunchTap(twice, {
            target: twice.next!,
            time: 8.1,
            stamp: s.lastStamp!,
            targets: pageTargets,
        });
        expect(again.taps.map((t) => t.index)).toEqual([9, 17]);
    });

    it("Backspace with nothing tapped does nothing", () => {
        expect(dropLastPunchTap(EMPTY_PUNCH_TAP)).toBe(EMPTY_PUNCH_TAP);
    });

    it("tapping again from a flag replaces only the drafts it hits", () => {
        const first = tapAll([4.1, 8.3, 12.2], pageTargets, EMPTY_PUNCH_TAP, 9);
        const again = tapAll([8.1], pageTargets, retargetPunchTap(first, 17));
        expect([...again.taps].sort((a, b) => a.index - b.index)).toEqual([
            { index: 9, time: 4.1 },
            { index: 17, time: 8.1 },
            { index: 25, time: 12.2 },
        ]);
        expect(again.next).toBe(25);
        // Backspace brings back the draft the re-tap replaced
        const back = dropLastPunchTap(again);
        expect(back.taps.find((t) => t.index === 17)?.time).toBe(8.3);
        expect(back.next).toBe(17);
    });

    it("looping a page: the latest tap on each target wins", () => {
        const pass1 = tapAll([4.1, 8.3], pageTargets, EMPTY_PUNCH_TAP, 9);
        const pass2 = tapAll([4.05, 8.2], pageTargets, pass1, 9);
        expect(pass2.taps).toEqual([
            { index: 9, time: 4.05 },
            { index: 17, time: 8.2 },
        ]);
    });

    it("a tap implying a big tempo jump is suspect but kept", () => {
        // Pages at 0.5 s a count, then a tap that makes page 12 last 8 s (0.25 s a count is fine,
        // 1 s a count is twice as slow)
        const taps = [
            { index: 9, time: 4 },
            { index: 17, time: 8 },
            { index: 25, time: 16 },
        ];
        const result = punchTapResult({
            durations,
            taps,
            synced: [],
            unit: "page",
        })!;
        const suspect = suspectTaps({
            durations: result.durations,
            targets: pageTargets,
            taps,
        });
        expect([...suspect.keys()]).toEqual([25]);
        expect(suspect.get(25)).toMatchObject({ bpm: 60, beforeBpm: 120 });
        expect(result.taps.map((t) => t.index)).toEqual([9, 17, 25]);
    });

    it("steady taps are never suspect", () => {
        fc.assert(
            fc.property(
                fc.double({ min: 0.3, max: 1.2, noNaN: true }),
                // The last page up to 20% longer or shorter: a rubato, not a missed tap
                fc.double({ min: 0.8, max: 1.2, noNaN: true }),
                (d, wobble) => {
                    const show = steady(32, d);
                    const times = countTimes(show);
                    const taps = [
                        { index: 9, time: times[9]! },
                        { index: 17, time: times[17]! },
                        {
                            index: 25,
                            time:
                                times[17]! + (times[25]! - times[17]!) * wobble,
                        },
                    ];
                    const result = punchTapResult({
                        durations: show,
                        taps,
                        synced: [],
                        unit: "page",
                    })!;
                    return (
                        suspectTaps({
                            durations: result.durations,
                            targets: pageTargets,
                            taps,
                        }).size === 0
                    );
                },
            ),
        );
    });
});

describe("applying", () => {
    it("tapped flags land on their taps; counts never added or removed", () => {
        const taps = [
            { index: 9, time: 4.4 },
            { index: 17, time: 9.4 },
        ];
        const result = punchTapResult({
            durations,
            taps,
            synced: [],
            unit: "page",
        })!;
        const times = countTimes(result.durations);
        expect(result.durations).toHaveLength(durations.length);
        expect(times[9]).toBeCloseTo(4.4);
        expect(times[17]).toBeCloseTo(9.4);
        // Nothing synced after: the rest shifts with its tempo
        expect(result.durations[20]).toBeCloseTo(0.5);
        expect(result.effect.shifted?.from).toBe(17);
    });

    it("after the last tap, counts re-space up to the next synced flag, which stays", () => {
        const result = punchTapResult({
            durations,
            taps: [{ index: 9, time: 4.4 }],
            synced: [25],
            unit: "page",
        })!;
        const times = countTimes(result.durations);
        expect(times[25]).toBeCloseTo(12);
        expect(result.effect.heldFrom).toBe(25);
    });

    it("count mode spaces a missed count evenly between its neighbors' taps", () => {
        const result = punchTapResult({
            durations,
            taps: [
                { index: 10, time: 5 },
                { index: 12, time: 6.2 },
            ],
            synced: [],
            unit: "count",
        })!;
        expect(result.durations[10]).toBeCloseTo(0.6);
        expect(result.durations[11]).toBeCloseTo(0.6);
    });

    it("no drafts, nothing to write", () => {
        expect(
            punchTapResult({ durations, taps: [], synced: [], unit: "page" }),
        ).toBeNull();
    });

    it("tapped counts become synced; count 1 always is", () => {
        expect(
            syncedAfterTaps(
                [25],
                [
                    { index: 1, time: 0.2 },
                    { index: 9, time: 4 },
                    { index: 25, time: 12 },
                ],
            ),
        ).toEqual([9, 25]);
    });
});

describe("words", () => {
    it("names a target as the transport reads it", () => {
        expect(targetName(pages, 1, "count 1")).toBe("count 1");
        expect(targetName(pages, 9, "count 1")).toBe("Pg 10 ct 8");
        expect(targetName(pages, 12, "count 1")).toBe("Pg 11 ct 3");
    });

    it("the toast's pages: first and last tapped", () => {
        expect(
            tappedPages(pages, [
                { index: 17, time: 1 },
                { index: 9, time: 1 },
                { index: 25, time: 1 },
            ]),
        ).toEqual({ first: "10", last: "12" });
        expect(tappedPages(pages, [{ index: 12, time: 1 }])).toEqual({
            first: "11",
            last: "11",
        });
        expect(tappedPages(pages, [])).toBeNull();
    });
});
