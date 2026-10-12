/** What the measure range helpers read from a page (`Page`'s fields) */
type MeasureRangePage = {
    measures: { number: number; counts: number }[] | null;
    measureBeatToStartOn: number | null;
    measureBeatToEndOn: number | null;
} | null;

const hasRange = (
    page: MeasureRangePage,
): page is {
    measures: { number: number; counts: number }[];
    measureBeatToStartOn: number;
    measureBeatToEndOn: number;
} =>
    page != null &&
    page.measures != null &&
    page.measures.length > 0 &&
    page.measureBeatToStartOn != null &&
    page.measureBeatToEndOn != null;

/**
 * The page's measures as drill sheets print them (tempo decision D5, Pyware's way): the measures
 * its counts are in, leaving out the last one when the page's flag (its last count) is that
 * measure's downbeat. A page from m5's downbeat to m9's reads "5–8"; a page that sets on m8 beat 4
 * reads "5–8" too, and one inside a measure reads "5". The count total is printed beside it, and
 * the exact counts are `measureRangeExact`'s.
 *
 * @returns "5–8", "5", or "-" for a page without measures.
 */
export const measureRangeString = (page: MeasureRangePage): string => {
    if (!hasRange(page)) return "-";
    const { measures } = page;
    const setsOnDownbeat = measures.length > 1 && page.measureBeatToEndOn === 1;
    const first = measures[0]!.number;
    const last = measures[measures.length - (setsOnDownbeat ? 2 : 1)]!.number;
    return first === last ? `${first}` : `${first}–${last}`;
};

/**
 * The page's first and last counts exactly, as the inspector shows them (D5): "m5 b2 – m9 b1" for
 * a page from m5's downbeat to m9's, whose count 1 is m5 beat 2 and whose flag is m9 beat 1
 * (docs/tempo/count-convention.md). "m5 b2" when both are one beat; "-" without measures.
 */
export const measureRangeExact = (page: MeasureRangePage): string => {
    if (!hasRange(page)) return "-";
    const first = `m${page.measures[0]!.number} b${page.measureBeatToStartOn}`;
    const last = `m${page.measures[page.measures.length - 1]!.number} b${page.measureBeatToEndOn}`;
    return first === last ? first : `${first} – ${last}`;
};

/**
 * One line under a drill sheet that prints `measureRangeString`'s ranges, so "5–8" beside a set
 * reached on m9's downbeat isn't read as a mistake.
 */
export const MEASURE_RANGE_LEGEND =
    "Measures: the measures each move's counts are in. A set reached on a downbeat isn't counted, so 5–8 can set on m9 beat 1.";

export { generatePageNames, getLastPageNumber } from "@openmarch/core";
