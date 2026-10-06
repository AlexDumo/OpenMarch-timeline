import { describe, expect, it } from "vitest";
import { countTimes, MIN_COUNT_SECONDS, moveCount } from "@/timeline/tempo";
import en from "../../../../i18n/en.json";
import {
    alignFlags,
    alignHold,
    alignMove,
    alignPages,
    alignTimeTicks,
    countName,
    evenOutPage,
    formatShowTime,
    formatTempo,
    heldCounts,
    holdChip,
    moveChip,
    snapAlignTime,
    syncedWith,
    typedPageTempo,
    type AlignTranslate,
} from "../timelineAlign";
import type { TimelinePageMarker } from "../TimelineViewModel";

/** The real English copy, with `{name}` filled in, so the tests read what users read */
const t: AlignTranslate = (key, params = {}) => {
    const template = key
        .split(".")
        .reduce<unknown>(
            (node, part) => (node as Record<string, unknown>)?.[part],
            en,
        );
    if (typeof template !== "string") throw new Error(`no string ${key}`);
    return template.replace(/\{(\w+)\}/g, (_, name: string) =>
        String(params[name]),
    );
};

/** The fixed zero-length beat 0, then `n` counts of `d` seconds */
const steady = (n: number, d = 0.5) => [0, ...Array<number>(n).fill(d)];

// The story show: 32 counts, pages 1, 2, 2A and 4 of 8 counts each (view beats; offset 1)
const markers: TimelinePageMarker[] = [
    { id: "page-0", label: "0", atBeat: 0, isInitial: true },
    { id: "page-1", label: "1", atBeat: 0, isInitial: false },
    { id: "page-2", label: "2", atBeat: 8, isInitial: false },
    { id: "page-2a", label: "2A", atBeat: 16, isInitial: false },
    { id: "page-4", label: "4", atBeat: 24, isInitial: false },
];
const pages = alignPages(markers, 32, 1);
const durations = steady(32);

describe("pages and flags", () => {
    it("turns the view's timed pages into spec count ranges", () => {
        expect(pages.map((p) => [p.label, p.start, p.end])).toEqual([
            ["1", 1, 9],
            ["2", 9, 17],
            ["2A", 17, 25],
            ["4", 25, 33],
        ]);
    });

    it("has a handle on count 1 and on each page's flag", () => {
        expect(alignFlags(pages).map((f) => [f.index, f.page?.label])).toEqual([
            [1, undefined],
            [9, "1"],
            [17, "2"],
            [25, "2A"],
            [33, "4"],
        ]);
    });

    it("names a moment as the readout does (UI-13)", () => {
        expect(countName(pages, 4)).toBe("Pg 1 ct 3");
        // A page's last count sits on its flag
        expect(countName(pages, 9)).toBe("Pg 1 ct 8");
        expect(countName(pages, 10)).toBe("Pg 2 ct 1");
    });
});

describe("snapping", () => {
    it("lands on the playhead first, then the count's own time", () => {
        // Both within 6px at 100 px/s: the playhead wins
        expect(
            snapAlignTime({
                time: 4.03,
                targets: [4.05, 4.0],
                pixelsPerSecond: 100,
                disabled: false,
            }),
        ).toEqual({ time: 4.05, snapped: true });
        // Only the original time is close
        expect(
            snapAlignTime({
                time: 4.03,
                targets: [9, 4.0],
                pixelsPerSecond: 100,
                disabled: false,
            }),
        ).toEqual({ time: 4.0, snapped: true });
    });

    it("measures the distance in pixels, and Alt turns it off", () => {
        expect(
            snapAlignTime({
                time: 4.1,
                targets: [4.0],
                pixelsPerSecond: 100,
                disabled: false,
            }).snapped,
        ).toBe(false);
        expect(
            snapAlignTime({
                time: 4.1,
                targets: [4.0],
                pixelsPerSecond: 50,
                disabled: false,
            }).snapped,
        ).toBe(true);
        expect(
            snapAlignTime({
                time: 4.03,
                targets: [4.0],
                pixelsPerSecond: 100,
                disabled: true,
            }),
        ).toEqual({ time: 4.03, snapped: false });
    });
});

describe("dragging a flag", () => {
    it("is moveCount: scale left, move right", () => {
        const result = alignMove({
            durations,
            index: 9,
            toTime: 4.31,
            synced: [],
        });
        expect(result).toEqual(
            moveCount({ durations, index: 9, toTime: 4.31, synced: [] }),
        );
        const times = countTimes(result.durations);
        expect(times[9]).toBeCloseTo(4.31, 9);
        // Everything after moved with its tempo
        expect(times[17] - times[9]).toBeCloseTo(4, 9);
    });

    it("stops at a synced count, which stays on the music", () => {
        const result = alignMove({
            durations,
            index: 9,
            toTime: 4.31,
            synced: [17],
        });
        expect(countTimes(result.durations)[17]).toBeCloseTo(8, 9);
        expect(result.effect.heldFrom).toBe(17);
    });

    it("re-spaces back to the previous synced count at the end of the show", () => {
        const result = alignMove({
            durations,
            index: 33,
            toTime: 18,
            synced: [17],
        });
        const times = countTimes(result.durations);
        expect(times[17]).toBeCloseTo(8, 9);
        expect(times[33]).toBeCloseTo(18, 9);
        expect(result.clamped).toBe(false);
    });

    it("clamps the end of the show like any count", () => {
        const result = alignMove({
            durations,
            index: 33,
            toTime: 0.1,
            synced: [],
        });
        expect(result.clamped).toBe(true);
        expect(result.clampReason).toBe("minCount");
        expect(result.durations[5]).toBeCloseTo(MIN_COUNT_SECONDS, 9);
    });

    it("syncs the dragged count, except count 1 (always synced) or with Shift", () => {
        expect(syncedWith([17], 9, true)).toEqual([9, 17]);
        expect(syncedWith([17], 9, false)).toEqual([17]);
        expect(syncedWith([17], 1, true)).toEqual([17]);
        expect(syncedWith([9], 9, true)).toEqual([9]);
    });
});

describe("the chip", () => {
    const chip = (index: number, toTime: number, synced: number[] = []) =>
        moveChip({
            before: durations,
            result: alignMove({ durations, index, toTime, synced }),
            index,
            pages,
            audioOffsetSeconds: 0,
            t,
        });

    it("says the new tempo and what moves after it", () => {
        expect(chip(9, 4.31)).toEqual({
            text: "Pg 1 · 120 → 111 · Pg 2–4 move +0.31 s",
            amber: false,
        });
        expect(chip(9, 3.8).text).toBe(
            "Pg 1 · 120 → 126 · Pg 2–4 move −0.20 s",
        );
    });

    it("says how far it re-spaces when a synced page holds the rest", () => {
        expect(chip(9, 4.31, [17]).text).toBe(
            "Pg 1 · 120 → 111 · Pg 2 120 → 130 up to synced Pg 2A",
        );
    });

    it("turns amber when the drag is limited", () => {
        expect(chip(9, 0.5)).toEqual({
            text: "Pg 1 · 120 → 400 · Pg 2–4 move −2.80 s · can't get faster than 400 BPM",
            amber: true,
        });
    });

    it("says where the music starts when count 1 moves", () => {
        expect(chip(1, 1.84).text).toBe("Music starts 1.84 s before count 1");
        expect(
            moveChip({
                before: durations,
                result: alignMove({
                    durations,
                    index: 1,
                    toTime: 0,
                    synced: [],
                }),
                index: 1,
                pages,
                audioOffsetSeconds: 0.5,
                t,
            }).text,
        ).toBe("Music starts 0.50 s after count 1");
        expect(chip(1, 0).text).toBe("Music starts on count 1");
    });

    it("names what's dragged when it isn't a page flag", () => {
        const result = alignMove({
            durations,
            index: 25,
            toTime: 12.5,
            synced: [],
        });
        expect(
            moveChip({
                before: durations,
                result,
                index: 25,
                pages,
                audioOffsetSeconds: 0,
                head: "A",
                t,
            }).text,
        ).toBe("A · 120 → 115 · Pg 4 move +0.50 s");
    });

    it("says how long a held count lasts", () => {
        const result = alignHold({
            durations,
            index: 5,
            toTime: 3,
            synced: [],
        })!;
        expect(result.durations[4]).toBeCloseTo(1.5, 9);
        expect(
            holdChip({ before: durations, result, index: 5, pages, t }).text,
        ).toBe("Pg 1 ct 3 held · 0.50 → 1.50 s · Pg 1–4 move +1.00 s");
        // Count 1's tick has no count before it to hold
        expect(
            alignHold({ durations, index: 1, toTime: 3, synced: [] }),
        ).toBeNull();
    });
});

describe("page tempo", () => {
    it("shows an even page's exact tempo and an uneven one's average", () => {
        expect(formatTempo(durations, 1, 9)).toBe("120");
        expect(formatTempo(steady(8, 60 / 152.5), 1, 9)).toBe("152.5");
        // A drag's tempo isn't one anyone typed
        expect(formatTempo(steady(8, 60 / 137.9312), 1, 9)).toBe("≈138");
        const held = steady(8);
        held[4] = 2;
        expect(formatTempo(held, 1, 9)).toBe("≈87");
        expect(heldCounts(held, [pages[0]!])).toEqual(new Set([4]));
    });

    it("types a tempo for a page, keeping a later synced count on the music", () => {
        const result = typedPageTempo({
            durations,
            page: pages[0]!,
            bpm: 100,
            synced: [17],
        })!;
        expect(result.durations[1]).toBeCloseTo(0.6, 9);
        expect(countTimes(result.durations)[17]).toBeCloseTo(8, 9);
    });

    it("refuses a typed tempo outside 40–400 BPM (a typo for 120 is likelier than 12 or 12038)", () => {
        expect(
            typedPageTempo({
                durations,
                page: pages[0]!,
                bpm: 12038,
                synced: [],
            }),
        ).toBeNull();
        expect(
            typedPageTempo({ durations, page: pages[0]!, bpm: 12, synced: [] }),
        ).toBeNull();
        expect(
            typedPageTempo({
                durations,
                page: pages[0]!,
                bpm: NaN,
                synced: [],
            }),
        ).toBeNull();
    });

    it("evens out a page between its flags", () => {
        const held = steady(32);
        held[4] = 2;
        const even = evenOutPage(held, pages[0]!);
        expect(even.slice(1, 9).every((d) => Math.abs(d - 0.6875) < 1e-9)).toBe(
            true,
        );
        expect(countTimes(even)[9]).toBeCloseTo(countTimes(held)[9]!, 9);
    });
});

describe("the time line", () => {
    it("labels every step that leaves room, in minutes and seconds", () => {
        expect(alignTimeTicks(4, 64).map((tick) => tick.label)).toEqual([
            "0:00",
            "0:01",
            "0:02",
            "0:03",
            "0:04",
        ]);
        expect(alignTimeTicks(130, 4).map((tick) => tick.seconds)).toEqual([
            0, 15, 30, 45, 60, 75, 90, 105, 120,
        ]);
        expect(alignTimeTicks(1, 200).map((tick) => tick.label)).toEqual([
            "0:00",
            "0:00.5",
            "0:01",
        ]);
        expect(formatShowTime(65.5, true)).toBe("1:05.5");
    });
});
