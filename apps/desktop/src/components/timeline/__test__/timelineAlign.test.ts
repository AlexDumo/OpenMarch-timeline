import { describe, expect, it } from "vitest";
import {
    countTimes,
    MIN_COUNT_SECONDS,
    moveCount,
    overriddenSections,
    type TypedSection,
} from "@/timeline/tempo";
import en from "../../../../i18n/en.json";
import {
    alignFlags,
    alignHold,
    alignMove,
    alignPages,
    alignDropTime,
    alignTimeTicks,
    countTempoText,
    countName,
    evenOutPage,
    formatShowTime,
    formatTempo,
    heldCounts,
    holdChip,
    moveChip,
    snapAlignTime,
    syncedWith,
    typedCounts,
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

    it("names a moment as the readout does (UI-13, D6)", () => {
        expect(countName(pages, 4)).toBe("Pg 1 ct 3");
        // A page's last count sits on its flag, where the next page starts
        expect(countName(pages, 9)).toBe("Pg 1 ct 8 → 2");
        expect(countName(pages, 9, "full")).toBe("end of Pg 1 · Pg 2 starts");
        expect(countName(pages, 10)).toBe("Pg 2 ct 1");
        expect(countName(pages, 10, "full")).toBe("Pg 2 · ct 1/8");
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
            "Pg 1 · 120 → 111 · Pg 2 120 → 130 up to synced Pg 2 ct 8 → 2A",
        );
    });

    it("warns when the re-spaced pages have very different tempos", () => {
        // An opener at 168 and a ballad at 72 before page 2A's flag
        const mixed = [
            0,
            ...Array<number>(8).fill(60 / 168),
            ...Array<number>(8).fill(60 / 72),
            ...Array<number>(16).fill(0.5),
        ];
        const at = countTimes(mixed)[17]!;
        const result = moveChip({
            before: mixed,
            result: alignMove({
                durations: mixed,
                index: 17,
                toTime: at - 0.4,
                synced: [],
            }),
            index: 17,
            pages,
            audioOffsetSeconds: 0,
            t,
        });
        expect(result.amber).toBe(true);
        expect(result.text).toMatch(
            /^Pg 1–2 · avg \d+ → \d+ · (since the start · )?includes 168 and 72 BPM sections, all re-spaced alike · /,
        );
        // Similar tempos: no warning
        expect(chip(17, 8.4)).toEqual(
            expect.objectContaining({ amber: false }),
        );
    });

    it("turns amber when the drag is limited", () => {
        expect(chip(9, 0.5)).toEqual({
            text: "Pg 1 · 120 → 400 · Pg 2–4 move −2.80 s · can't get faster than 400 BPM",
            amber: true,
        });
    });

    it("says where the music starts when count 1 moves", () => {
        expect(chip(1, 1.84).text).toBe("Count 1 is 1.84 s into the music");
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
        ).toBe("Count 1 is 0.50 s before the music starts");
        expect(chip(1, 0).text).toBe("Count 1 is where the music starts");
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
        ).toBe("A · 120 → 115 · since the start · Pg 4 move +0.50 s");
    });

    it("names a synced flag by the page it closes, as the transport does (B2)", () => {
        // Page 2's flag (count 17) is synced; dragging page 1's flag re-spaces page 2 up to it
        const text = chip(9, 4.31, [17]).text;
        expect(text).toContain("up to synced Pg 2 ct 8 → 2A");
    });

    it("says a drop that changes nothing changes nothing", () => {
        expect(chip(9, 4).text).toBe(
            "No change: zoom in (Ctrl+scroll) for finer moves",
        );
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
        // With measures, the held count is named by the music (D6)
        expect(
            holdChip({
                before: durations,
                result,
                index: 5,
                pages,
                t,
                measures: [
                    { at: 1, number: "1" },
                    { at: 5, number: "2" },
                ],
            }).text,
        ).toBe("m1 beat 4 held · 0.50 → 1.50 s · Pg 1–4 move +1.00 s");
        // Count 1's tick has no count before it to hold
        expect(
            alignHold({ durations, index: 1, toTime: 3, synced: [] }),
        ).toBeNull();
    });
});

describe("drag scope (FB-2)", () => {
    const flags = alignFlags(pages).map((f) => f.index);

    it("with page scope, re-spaces only the page before the dragged flag", () => {
        const result = alignMove({
            durations,
            index: 17,
            toTime: 8.5,
            synced: [],
            scope: "page",
            flags,
        });
        // Page 1 (counts 1–8) keeps its tempo; page 2 absorbs the drag
        expect(result.durations.slice(1, 9)).toEqual(durations.slice(1, 9));
        expect(result.effect.respaced[0]).toEqual({ from: 9, to: 17 });
        expect(countTimes(result.durations)[17]).toBeCloseTo(8.5, 9);
    });

    it("with toSynced scope, re-spaces back to the previous synced count", () => {
        const result = alignMove({
            durations,
            index: 17,
            toTime: 8.5,
            synced: [],
            scope: "toSynced",
            flags,
        });
        expect(result.effect.respaced[0]).toEqual({ from: 1, to: 17 });
    });

    it("a synced count later than the previous flag still bounds it", () => {
        const result = alignMove({
            durations,
            index: 17,
            toTime: 8.5,
            synced: [13],
            scope: "page",
            flags,
        });
        expect(result.effect.respaced[0]).toEqual({ from: 13, to: 17 });
    });

    it("re-spaces the last page only, at the end of the show", () => {
        const result = alignMove({
            durations,
            index: 33,
            toTime: 17,
            synced: [],
            scope: "page",
            flags,
        });
        expect(result.effect.respaced[0]).toEqual({ from: 25, to: 33 });
        expect(result.durations.slice(1, 25)).toEqual(durations.slice(1, 25));
    });

    it("the chip names how far back a wide re-space reaches", () => {
        const result = alignMove({
            durations,
            index: 17,
            toTime: 8.5,
            synced: [],
        });
        expect(
            moveChip({
                before: durations,
                result,
                index: 17,
                pages,
                audioOffsetSeconds: 0,
                t,
            }).text,
        ).toBe("Pg 1–2 · 120 → 113 · since the start · Pg 2A–4 move +0.50 s");
    });

    it("a hold with page scope stays inside its page, so earlier holds keep", () => {
        // Hold count 3 (tick 4) of page 1, then count 5 (tick 6): the first stays
        const first = alignHold({
            durations,
            index: 4,
            toTime: 2.5,
            synced: [],
            scope: "page",
            flags,
        })!;
        expect(countTimes(first.durations)[9]).toBeCloseTo(4, 9);
        expect(first.effect.heldFrom).toBe(9);
        const second = alignHold({
            durations: first.durations,
            index: 6,
            toTime: countTimes(first.durations)[6]! - 0.1,
            synced: [],
            scope: "page",
            flags,
        })!;
        expect(second.durations[3]).toBeCloseTo(first.durations[3]!, 9);
        expect(countTimes(second.durations)[9]).toBeCloseTo(4, 9);
        // The chip doesn't call page 1's unsynced flag synced
        expect(
            holdChip({
                before: durations,
                result: first,
                index: 4,
                pages,
                synced: [],
                t,
            }).text,
        ).toContain("up to Pg 1 ct 8 → 2");
    });

    it("a hold on a page's last count re-spaces the next page", () => {
        const result = alignHold({
            durations,
            index: 9,
            toTime: 5,
            synced: [],
            scope: "page",
            flags,
        })!;
        expect(result.effect.heldFrom).toBe(17);
    });
});

describe("drops", () => {
    it("small corrections at a low zoom aren't thrown away (FB-8)", () => {
        // 0.2 s at 19 px/s is under 4 px: it used to snap back to where it was
        expect(
            alignDropTime({
                time: 10.2,
                playhead: null,
                origin: 10,
                pixelsPerSecond: 19,
                disabled: false,
            }),
        ).toEqual({ time: 10.2, snapped: false });
        expect(
            alignDropTime({
                time: 10.05,
                playhead: null,
                origin: 10,
                pixelsPerSecond: 19,
                disabled: false,
            }),
        ).toEqual({ time: 10, snapped: true });
        expect(
            alignDropTime({
                time: 10.2,
                playhead: 10.4,
                origin: 10,
                pixelsPerSecond: 19,
                disabled: false,
            }),
        ).toEqual({ time: 10.4, snapped: true });
    });

    it("formats tenths without rolling over to .10 (Jo bug 2)", () => {
        expect(formatShowTime(76.97, true)).toBe("1:17");
        expect(formatShowTime(59.96, true)).toBe("1:00");
        expect(formatShowTime(65.7)).toBe("1:05");
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

    it("hatches only counts held on purpose: 2× the page and standing out (DT-6)", () => {
        const page = { id: 1, label: "1", start: 1, end: 9 };
        // A wobble from tapping every count is no hold, even at 1.9×
        const wobble = [0, 0.5, 0.55, 0.45, 0.95, 0.5, 0.48, 0.52, 0.5];
        expect(heldCounts(wobble, [page])).toEqual(new Set());
        // A rit. to 3× at the page's end isn't one either: no count stands out from its neighbors
        const rit = [0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.75, 1.1, 1.5];
        expect(heldCounts(rit, [page])).toEqual(new Set());
        // A fermata is
        const fermata = [0, 0.5, 0.5, 0.5, 1.6, 0.5, 0.5, 0.5, 0.5];
        expect(heldCounts(fermata, [page])).toEqual(new Set([4]));
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

describe("count 1 is where the music starts (FX-5)", () => {
    it("shifts the whole show, even with synced counts after it", () => {
        // A typed pickup and m1 at ♩=176: their edges are synced (TM-3)
        const d = [0, ...Array<number>(9).fill(60 / 176)];
        const result = alignMove({
            durations: d,
            index: 1,
            toTime: 0.5,
            synced: [2, 6],
        });
        expect(result.durations).toEqual(d);
        expect(result.originShift).toBeCloseTo(0.5, 12);
        const text = moveChip({
            before: d,
            result,
            index: 1,
            pages,
            audioOffsetSeconds: 0,
            t,
        }).text;
        expect(text).toBe("Count 1 is 0.50 s into the music");
    });
});

describe("tempos in the score's units (FX-7)", () => {
    // Counts 1–8 plain ♩, 9–16 6/8 counted in ♩.
    const units = [
        undefined,
        ...Array(8).fill({ unit: "q", weight: 1 }),
        ...Array(8).fill({ unit: "dq", weight: 1 }),
    ];
    const d = [0, ...Array(8).fill(0.5), ...Array(8).fill(60 / 88)];

    it("labels a 6/8 page ♩.=88, a plain one 120, and never averages across", () => {
        expect(formatTempo(d, 1, 9, units)).toBe("120");
        expect(formatTempo(d, 9, 17, units)).toBe("♩.=88");
        expect(formatTempo(d, 5, 17, units)).toBe("120");
        expect(formatTempo(d, 1, 9)).toBe("120");
    });

    it("reads the readout in the count's note", () => {
        expect(countTempoText(d, 3, units)).toBe("120 BPM");
        expect(countTempoText(d, 12, units)).toBe("♩.=88");
        expect(countTempoText(d, 12)).toBe("88 BPM");
    });

    it("speaks the chip in the note too", () => {
        const result = alignMove({
            durations: d,
            index: 13,
            toTime: 6.9,
            synced: [9, 17],
        });
        expect(
            moveChip({
                before: d,
                result,
                index: 13,
                pages,
                audioOffsetSeconds: 0,
                t,
                units,
            }).text,
        ).toMatch(/^Pg 2 · ♩.=88 → ♩.≈\d+/);
    });
});

describe("typed sections (FX-5)", () => {
    it("says a drag overrides a typed tempo, in amber", () => {
        const chip = moveChip({
            before: durations,
            result: alignMove({ durations, index: 9, toTime: 4.3, synced: [] }),
            index: 9,
            pages,
            audioOffsetSeconds: 0,
            t,
            overrides: [{ from: 1, to: 9, tempo: "♩=176", measures: "m1–16" }],
        });
        expect(chip.text).toMatch(/^Overrides typed ♩=176 \(m1–16\)/);
        expect(chip.amber).toBe(true);
    });
});

/**
 * Sam's typed corps show (capture 20261006-152208-critic-sam-drag-v2): a pickup and m1–16 typed
 * ♩=176 (counts 1–65), C typed ♩=176 from count 66; pages of 16 counts with flags at 2, 18, 34,
 * 50, 66, 82; synced where typed rows start (1, 2, 66) and at 90.
 */
describe("typed sections under the page scope (DE-1, Sam)", () => {
    const beat = 60 / 176;
    const sam = steady(97, beat);
    const typed: TypedSection[] = [
        { from: 1, to: 2, tempo: "♩=176", measures: "m0" },
        { from: 2, to: 66, tempo: "♩=176", measures: "m1–16" },
        { from: 66, to: 90, tempo: "♩=176", measures: "m17–24" },
    ];
    const synced = [1, 2, 66, 90];
    const flags = [1, 2, 18, 34, 50, 66, 82, 97];
    const at34 = countTimes(sam)[34]!;
    const drag = (keepTyped: boolean) =>
        alignMove({
            durations: sam,
            index: 34,
            toTime: at34 - 0.4,
            synced,
            scope: "page",
            flags,
            typed,
            keepTyped,
        });

    it("asks before page 2's typed ♩=176 changes (it re-timed to ≈195 with only a toast)", () => {
        const wanted = drag(false);
        const overrides = overriddenSections(typed, sam, wanted.durations);
        expect(overrides.map((o) => o.measures)).toEqual(["m1–16"]);
    });

    it("lets pages 3–4 slide instead of re-spacing up to synced C", () => {
        const wanted = drag(false);
        // Page 2 re-spaced; everything from its flag on keeps its tempo and moves earlier
        expect(wanted.effect.respaced).toEqual([{ from: 18, to: 34 }]);
        expect(wanted.effect.shifted?.from).toBe(34);
        expect(wanted.effect.shifted?.bySeconds).toBeCloseTo(-0.4, 9);
        for (let i = 34; i < sam.length; i++)
            expect(wanted.durations[i]).toBe(beat);
    });

    it("Keep typed: the drag stops at the typed section, so nothing moves", () => {
        const kept = drag(true);
        expect(kept.durations).toEqual(sam);
        expect(kept.time).toBeCloseTo(at34, 9);
        const chip = moveChip({
            before: sam,
            result: kept,
            index: 34,
            pages: [],
            audioOffsetSeconds: 0,
            t,
            stoppedAt: overriddenSections(typed, sam, drag(false).durations),
        });
        expect(chip).toEqual({
            text: "Stops at typed ♩=176 (m1–16): release to override or keep it",
            amber: true,
        });
    });

    it("Keep typed re-spaces only the counts that aren't typed", () => {
        // Page 2 half typed: only counts 26–33 stretch, 18–25 keep ♩=176
        const half: TypedSection[] = [
            { from: 2, to: 26, tempo: "♩=176", measures: "m1–6" },
        ];
        const kept = alignMove({
            durations: sam,
            index: 34,
            toTime: at34 - 0.4,
            synced: [1, 2],
            scope: "page",
            flags,
            typed: half,
            keepTyped: true,
        });
        expect(kept.time).toBeCloseTo(at34 - 0.4, 9);
        for (let i = 2; i < 26; i++) expect(kept.durations[i]).toBe(beat);
        expect(kept.durations[26]).toBeCloseTo(beat - 0.05, 9);
        expect(overriddenSections(half, sam, kept.durations)).toEqual([]);
    });

    it("still re-spaces up to a synced count when no typed count is in between", () => {
        const result = alignMove({
            durations: sam,
            index: 34,
            toTime: at34 - 0.4,
            synced: [1, 50],
            scope: "page",
            flags,
            typed: [],
        });
        expect(result.effect.heldFrom).toBe(50);
        expect(result.effect.shifted).toBeNull();
    });

    it("a hold inside a typed section stops there when kept", () => {
        const kept = alignHold({
            durations: sam,
            index: 30,
            toTime: countTimes(sam)[30]! + 0.5,
            synced,
            scope: "page",
            flags,
            typed,
            keepTyped: true,
        });
        expect(kept?.durations).toEqual(sam);
    });

    it("Tempo… on a page lets later typed pages slide instead of re-spacing them (DE-3)", () => {
        const page = { id: 2, label: "2", start: 18, end: 34 };
        const result = typedPageTempo({
            durations: sam,
            page,
            bpm: 180,
            synced,
            typed,
        })!;
        for (let i = 34; i < sam.length; i++)
            expect(result.durations[i]).toBe(beat);
        expect(result.effect.shifted?.from).toBe(34);
        // Page 2's own counts are typed: the prompt asks before writing (overriddenSections)
        expect(
            overriddenSections(typed, sam, result.durations).map(
                (o) => o.measures,
            ),
        ).toEqual(["m1–16"]);
    });

    it("typedCounts lists every typed count once", () => {
        expect([...typedCounts(typed)].length).toBe(89);
    });
});
