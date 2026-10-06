/**
 * Generates a string representation of the measure range of the page's counts, from its count 1
 * to its last count (docs/tempo/count-convention.md). A count on a measure's first beat is the
 * measure number alone at the start; a last count on a measure's last beat is the number alone at
 * the end. Otherwise the beat follows in brackets.
 *
 * E.g. "5 - 8": count 1 is m5 beat 1 and the last count is m8's last beat.
 *
 * E.g. "5(2) - 9(1)": the page starts on m5's downbeat, so its count 1 is m5 beat 2 and its flag,
 * on m9's downbeat, is m9 beat 1.
 *
 * @returns A string representing the measure range for the page.
 */
export const measureRangeString = (
    page: {
        measures: { number: number; counts: number }[] | null;
        measureBeatToStartOn: number | null;
        measureBeatToEndOn: number | null;
    } | null,
): string => {
    if (
        page == null ||
        page.measures == null ||
        page.measures.length === 0 ||
        page.measureBeatToStartOn == null ||
        page.measureBeatToEndOn == null
    ) {
        return "-";
    }
    try {
        const firstMeasure = page.measures[0];
        const lastMeasure = page.measures[page.measures.length - 1];

        // If the page starts on the first measure, just return the measure number. Otherwise, return the measure number and the beat.
        const firstMeasureString =
            page.measureBeatToStartOn === 1
                ? firstMeasure.number.toString()
                : `${firstMeasure.number}(${page.measureBeatToStartOn})`;
        const beatToEndOn = page.measureBeatToEndOn;
        const lastMeasureString =
            beatToEndOn === lastMeasure.counts
                ? lastMeasure.number.toString()
                : `${lastMeasure.number}(${beatToEndOn})`;

        if (firstMeasureString === lastMeasureString) return firstMeasureString;
        return `${firstMeasureString} - ${lastMeasureString}`;
    } catch (err) {
        return "N/A";
    }
};

export { generatePageNames, getLastPageNumber } from "@openmarch/core";
