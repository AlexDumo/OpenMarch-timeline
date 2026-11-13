/**
 * Coordinate sheets as plain data: the cells the React templates
 * (`StaticMarcherCoordinateSheet`, `StaticQuarterMarcherSheet`) print, with no
 * HTML. The PDF builder (./docDefinition.ts) draws from this.
 *
 * No app imports here, so the PDF code stays light; ./buildSheetModel.ts
 * derives the data from the show.
 */
export interface SheetRow {
    /** Page (set) name, e.g. "2A" */
    set: string;
    counts: number | string;
    /** Full-page measure text, e.g. "12A(9) → 14(16)" */
    measures: string;
    sideToSide: string;
    frontToBack: string;
    sideToSideTerse?: string;
    frontToBackTerse?: string;
}

export interface SheetMarcher {
    /** Raw name; may be empty */
    name: string;
    /** Name shown in the header (falls back to "<section> <n>") */
    displayName: string;
    drillNumber: string;
    section: string;
    rows: SheetRow[];
}

export interface SheetColumns {
    page: string;
    counts: string;
    measure: string;
    x: string;
    y: string;
}

export interface SheetModel {
    showName: string;
    marchers: SheetMarcher[];
}

export interface SheetOptions {
    includeMeasures: boolean;
    terse: boolean;
    useXY: boolean;
}

/** Labels for the column headers and the quarter-page "Page n" tag. */
export interface SheetLabels {
    columns: SheetColumns;
    /** Quarter header tag, e.g. (n) => `Page ${n}` */
    quarterPage: (n: number) => string;
    exported: (date: string) => string;
    madeWith: string;
    pageOf: (page: number, total: number) => string;
}

export const ENGLISH_LABELS: SheetLabels = {
    columns: {
        page: "Pg",
        counts: "Ct",
        measure: "Measure",
        x: "Side to Side",
        y: "Front to Back",
    },
    quarterPage: (n) => `Page ${n}`,
    exported: (date) => `Exported ${date}`,
    madeWith: "Made with OpenMarch",
    pageOf: (page, total) => `Page ${page} of ${total}`,
};

/**
 * Format measure as X-X (e.g. 12A-14), max 11 chars, as the quarter
 * template does. Accepts strings like "12A(9) → 14(16)" or "12(9)".
 */
export function compactMeasure(measureStr: string): string {
    const match = measureStr.match(
        /([A-Za-z0-9]+)\(\d+\)\s*[→-]\s*([A-Za-z0-9]+)\(\d+\)/,
    );
    if (match) return `${match[1]}-${match[2]}`.slice(0, 11);
    const match2 = measureStr.match(/([A-Za-z0-9]+)\(\d+\)/);
    if (match2) return match2[1];
    return measureStr;
}
