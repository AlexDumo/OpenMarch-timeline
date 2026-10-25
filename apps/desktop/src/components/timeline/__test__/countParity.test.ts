/**
 * One rule for which page, count, measure and beat a moment belongs to (experiment E2,
 * docs/tempo/count-convention.md). The timeline readout, the go-to box, the PDF drill sheet's
 * measure range and the video overlay must all name the same thing for every count of every page.
 *
 * The rule: count k of page P is the k-th beat line after P's start flag, so P's flag is its last
 * count; a beat line is named by the beat that starts on it ("m9 beat 1" on m9's downbeat); and a
 * moment between two lines belongs to the line at or before it. The end of the show has no beat of
 * its own, so it is named by the last beat.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type Beat from "@/global/classes/Beat";
import { fromDatabaseMeasures } from "@/global/classes/Measure";
import type Measure from "@/global/classes/Measure";
import { fromDatabasePages } from "@/global/classes/Page.fromDatabase";
import {
    measureRangeExact,
    measureRangeString,
} from "@/global/classes/Page.utils";
import type Page from "@/global/classes/Page";
import { OverlayTimeline } from "@/components/exporting/video/videoOverlay";
import { createTimelineViewModel } from "../Timeline";
import {
    getMeasureAt,
    getPageCountAt,
    getPlayheadReadout,
    parseTimelineGoTo,
} from "../TimelineGeometry";
import type { TimelineViewModel } from "../TimelineViewModel";

// ---------------------------------------------------------------------------
// Generated shows
// ---------------------------------------------------------------------------

/** Each meter as its counts' lengths in quarter notes */
const METERS = {
    "2/4": [1, 1],
    "3/4": [1, 1, 1],
    "4/4": [1, 1, 1, 1],
    "5/8 2+3": [1, 1.5],
    "7/8 2+2+3": [1, 1, 1.5],
    "12/8": [1.5, 1.5, 1.5, 1.5],
    "3/2": [2, 2, 2],
} as const;
type MeterName = keyof typeof METERS;

/** Quarter-note tempos, including the exact decimals of Sam's click track */
const tempoArb = fc.oneof(
    fc.constantFrom(176, 152.5, 352 / 3, 132.25, 60),
    fc.double({ min: 40, max: 240, noNaN: true }),
);

const measureArb = fc.record({
    meter: fc.constantFrom(...(Object.keys(METERS) as MeterName[])),
    tempo: tempoArb,
});

export type GeneratedShow = {
    readonly meters: readonly { meter: MeterName; tempo: number }[];
    /** View beat lines where a page starts, after the first page's at 0 */
    readonly pageStarts: readonly number[];
    readonly lastPageCounts: number;
};

const showArb: fc.Arbitrary<GeneratedShow> = fc
    .array(measureArb, { minLength: 1, maxLength: 10 })
    .chain((meters) => {
        const beatCount = meters.reduce(
            (sum, m) => sum + METERS[m.meter].length,
            0,
        );
        return fc
            .uniqueArray(fc.integer({ min: 1, max: beatCount - 1 }), {
                maxLength: Math.min(beatCount - 1, 8),
            })
            .chain((starts) => {
                const pageStarts = [0, ...starts].sort((a, b) => a - b);
                const roomForLast =
                    beatCount - pageStarts[pageStarts.length - 1]!;
                return fc
                    .integer({ min: 1, max: roomForLast })
                    .map((lastPageCounts) => ({
                        meters,
                        pageStarts,
                        lastPageCounts,
                    }));
            });
    });

/** The show as the app builds it: beats, measures and pages from database rows */
export const buildShow = (show: GeneratedShow) => {
    const durations = [0];
    const downbeats: number[] = [];
    for (const { meter, tempo } of show.meters) {
        downbeats.push(durations.length);
        for (const quarters of METERS[meter])
            durations.push((quarters * 60) / tempo);
    }
    let timestamp = 0;
    const beats: Beat[] = durations.map((duration, index) => {
        const beat = {
            id: index,
            position: index,
            duration,
            includeInMeasure: true,
            notes: null,
            index,
            timestamp,
        };
        timestamp += duration;
        return beat;
    });
    const measures: Measure[] = fromDatabaseMeasures({
        databaseMeasures: downbeats.map((start_beat, i) => ({
            id: i + 1,
            start_beat,
            rehearsal_mark:
                i % 3 === 0 ? String.fromCharCode(65 + i / 3) : null,
            notes: null,
            created_at: "",
            updated_at: "",
        })),
        allBeats: [...beats],
    });
    // Page 0 holds the zero-length beat 0; a page starting on view line s starts on spec beat s + 1
    const pages: Page[] = fromDatabasePages({
        databasePages: [
            { id: 0, start_beat: 0, is_subset: false, notes: null },
            ...show.pageStarts.map((start, i) => ({
                id: i + 1,
                start_beat: start + 1,
                is_subset: false,
                notes: null,
            })),
        ],
        allMeasures: [...measures],
        allBeats: [...beats],
        lastPageCounts: show.lastPageCounts,
    });
    const model = createTimelineViewModel({
        beats,
        pages,
        measures,
        timelines: [],
        waveform: { peaksByBeat: [] },
    });
    return { beats, measures, pages, model, end: timestamp };
};

// ---------------------------------------------------------------------------
// The rule, written out once, independently of every surface
// ---------------------------------------------------------------------------

type Named = {
    readonly page: string;
    readonly count: number;
    readonly measure: number;
    readonly beat: number;
};

/** What the rule names view beat line `line` that is count `count` of page `page` */
const expected = (
    model: TimelineViewModel,
    page: string,
    count: number,
    line: number,
): Named => {
    // The end of the show has no beat; it is named by the last one
    const beat = Math.min(line, model.beatCount - 1);
    const measures = [...model.measures].sort((a, b) => a.atBeat - b.atBeat);
    const measure = measures.filter((m) => m.atBeat <= beat).pop()!;
    return {
        page,
        count,
        measure: Number(measure.label.slice(1)),
        beat: beat - measure.atBeat + 1,
    };
};

// ---------------------------------------------------------------------------
// Each surface's answer
// ---------------------------------------------------------------------------

const readoutNames = (model: TimelineViewModel, position: number): Named => {
    const at = getPageCountAt(model, position);
    const measure = getMeasureAt(model, position)!;
    const readout = getPlayheadReadout(model, position);
    // The compact text names the page and the count, also on a flag ("C · Pg 10 ct 16 → 11")
    const compact = readout.compact.match(
        /^(?:.+ · )?Pg (\S+) ct (\d+)(?: → (\S+))?$/,
    );
    expect(compact, readout.compact).not.toBeNull();
    const [, page, count, next] = compact!;
    // The full text says the same (D6): a flag is the end of its page and where the next starts
    if (at.total != null && at.count === at.total) {
        expect(readout.page).toContain(`end of Pg ${page}`);
        if (next) expect(readout.page).toContain(`Pg ${next} starts`);
    } else
        expect(readout.page).toBe(
            `Pg ${page} · ct ${count}${at.total != null ? `/${at.total}` : ""}`,
        );
    expect(readout.measure).toBe(`m${measure.measure} beat ${measure.beat}`);
    return {
        page: page!,
        count: Number(count),
        measure: Number(measure.measure),
        beat: measure.beat,
    };
};

/** The PDF's measure range for a page: its first and last counts, and both texts */
const pdfNames = (page: Page) => {
    const first = page.measures![0]!;
    const last = page.measures![page.measures!.length - 1]!;
    return {
        first: { measure: first.number, beat: page.measureBeatToStartOn! },
        last: { measure: last.number, beat: page.measureBeatToEndOn! },
        printed: measureRangeString(page),
        exact: measureRangeExact(page),
    };
};

/**
 * What the drill sheet prints for a page whose count 1 is `first` and whose flag is `last` (D5):
 * the measures between them, without the flag's measure when the flag is its downbeat.
 */
const printedText = (
    first: Named,
    last: Named,
    measures: readonly Measure[],
) => {
    const end =
        last.beat === 1 && last.measure !== first.measure
            ? measures.filter((m) => m.number < last.measure).at(-1)!.number
            : last.measure;
    return first.measure === end
        ? `${first.measure}`
        : `${first.measure}–${end}`;
};

/** The inspector's exact range: "m5 b2 – m9 b1" */
const exactText = (first: Named, last: Named) => {
    const a = `m${first.measure} b${first.beat}`;
    const b = `m${last.measure} b${last.beat}`;
    return a === b ? a : `${a} – ${b}`;
};

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

const EPSILON = 1e-9;

const checkShow = (show: GeneratedShow) => {
    const { beats, measures, pages, model } = buildShow(show);
    // View line → show time: view line b is spec beat b + 1's start
    const timeAt = (line: number) =>
        line + 1 < beats.length
            ? beats[line + 1]!.timestamp
            : beats[beats.length - 1]!.timestamp +
              beats[beats.length - 1]!.duration;
    const durationAfter = (line: number) =>
        line + 1 < beats.length ? beats[line + 1]!.duration : 0;
    const overlay = new OverlayTimeline(pages, measures);

    // Home: the show's start, and the moment after it until count 1 of the first page
    expect(getPageCountAt(model, 0).home).toBe(true);
    expect(getPageCountAt(model, 0.5).home).toBe(true);
    const home = overlay.getState(0);
    expect(home.count).toBe(0);
    expect(home.setName).toBe(pages[0]!.name);
    expect(overlay.getState(timeAt(0) + durationAfter(0) / 2).count).toBe(0);

    const timed = model.pages.filter((p) => !p.isInitial);
    for (const [index, page] of timed.entries()) {
        const total = page.endBeat! - page.atBeat;
        const dbPage = pages.find((p) => p.id === page.id)!;
        expect(dbPage.counts).toBe(total);
        for (let count = 1; count <= total; count++) {
            const line = page.atBeat + count;
            const want = expected(model, page.label, count, line);
            const atEnd = line >= model.beatCount;

            // The readout, on the line and anywhere before the next one
            expect(readoutNames(model, line)).toEqual(want);
            if (!atEnd) expect(readoutNames(model, line + 0.5)).toEqual(want);

            // The go-to box: typing what the readout says comes back to this line. The end of
            // the show is named by the last beat, whose own line comes first.
            const goTo = parseTimelineGoTo(
                `m${want.measure}.${want.beat}`,
                model,
            );
            expect(goTo).toEqual({
                kind: "beat",
                beat: atEnd ? line - 1 : line,
            });

            // The video overlay, on the beat and halfway to the next one
            const isLastOfShow = index === timed.length - 1 && count === total;
            for (const t of [
                timeAt(line),
                timeAt(line) + durationAfter(line) / 2,
            ]) {
                if (isLastOfShow && t > timeAt(line)) continue;
                const state = overlay.getState(t + EPSILON);
                expect({
                    page: state.setName,
                    count: state.count,
                    measure: state.measureNumber,
                }).toEqual({
                    page: want.page,
                    count: want.count,
                    measure: want.measure,
                });
                expect(state.totalCounts).toBe(total);
            }
        }

        // A page in the go-to box selects its box, whose flag reads the page's last count
        expect(parseTimelineGoTo(`pg ${page.label}`, model)).toEqual({
            kind: "page",
            pageId: page.id,
        });

        // The PDF's range comes from the page's first and last counts: the inspector names them
        // exactly, the sheet prints the measures they are in (D5)
        const first = expected(model, page.label, 1, page.atBeat + 1);
        const last = expected(model, page.label, total, page.endBeat!);
        const pdf = pdfNames(dbPage);
        expect(pdf.first).toEqual({ measure: first.measure, beat: first.beat });
        expect(pdf.last).toEqual({ measure: last.measure, beat: last.beat });
        expect(pdf.exact).toBe(exactText(first, last));
        expect(pdf.printed).toBe(printedText(first, last, measures));
    }
};

describe("one rule for counts across the readout, go-to, PDF and video (E2)", () => {
    it("names the same page, count, measure and beat on every surface", () => {
        fc.assert(
            fc.property(showArb, (show) => {
                checkShow(show);
            }),
            { numRuns: 300 },
        );
    });

    // Sam's example (25-persona-sam.md): 4/4 at ♩=176, page 2 starts on m5's downbeat
    describe("a 16-count page from m5's downbeat", () => {
        const show = {
            meters: Array.from({ length: 12 }, () => ({
                meter: "4/4" as const,
                tempo: 176,
            })),
            pageStarts: [0, 16, 32],
            lastPageCounts: 16,
        };
        const { model, pages, measures, beats } = buildShow(show);
        const m5 = beats[17]!.timestamp;

        it("passes the property", () => checkShow(show));

        it("reads count 1 as m5 beat 2 and the flag as count 16, m9 beat 1 (UI-13)", () => {
            expect(getPlayheadReadout(model, 17)).toMatchObject({
                page: "Pg 2 · ct 1/16",
                measure: "m5 beat 2",
            });
            expect(getPlayheadReadout(model, 32)).toMatchObject({
                page: "end of Pg 2 · Pg 3 starts",
                compact: "Pg 2 ct 16 → 3",
                measure: "m9 beat 1",
            });
        });

        it("prints m5–8 on the drill sheet, and m5 b2 – m9 b1 in the inspector (D5)", () => {
            expect(measureRangeString(pages[2]!)).toBe("5–8");
            expect(measureRangeExact(pages[2]!)).toBe("m5 b2 – m9 b1");
            expect(measureRangeString(pages[1]!)).toBe("1–4");
            expect(measureRangeExact(pages[1]!)).toBe("m1 b2 – m5 b1");
        });

        it("shows the video one count apart from nothing: page 1's last count on m5's downbeat", () => {
            const overlay = new OverlayTimeline(pages, measures);
            expect(overlay.getState(m5)).toMatchObject({
                setName: "1",
                count: 16,
                measureNumber: 5,
            });
            expect(overlay.getState(beats[18]!.timestamp)).toMatchObject({
                setName: "2",
                count: 1,
                measureNumber: 5,
            });
        });
    });
});
