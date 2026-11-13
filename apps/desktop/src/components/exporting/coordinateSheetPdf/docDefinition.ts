// cspell:ignore pdfmake pdfs dont ijlft helv xthrottle Dvořák Émile García Łukasz Nguyễn Núñez Østergaard Šťastný Ελένη Παπαδοπούλου Иванова Ольга محمد
/**
 * pdfmake document definitions for coordinate sheets, built from plain data
 * (./model.ts). Pure functions: no pdfmake import here, so they are cheap to
 * test and the library itself only loads when someone exports
 * (./index.ts).
 *
 * Full pages: one table per marcher; the performer bar and the column
 * headers are the table's two header rows, so both repeat on every page the
 * table runs onto, and rows are never split (`dontBreakRows`).
 *
 * Quarter pages: four quarter sheets per Letter page in a 2x2 grid. Each
 * quarter takes only as many rows as fit its box (estimated from the text,
 * see `chunkQuarterRows`), so nothing overflows into the next quarter.
 */
import type {
    SheetLabels,
    SheetMarcher,
    SheetModel,
    SheetOptions,
    SheetRow,
} from "./model";
import { compactMeasure } from "./model";

/** A pdfmake content node (kept loose: pdfmake 0.3 ships no types). */
export type PdfNode = Record<string, unknown>;
export type PdfCell = PdfNode | string;
export type DocDefinition = PdfNode;

export type SheetFont = "Roboto" | "Helvetica";

export interface BuildOptions extends SheetOptions {
    labels: SheetLabels;
    /** Logo SVG markup (currentColor already replaced) */
    logoSvg?: string;
    font: SheetFont;
    /** Shown in the footer, already formatted */
    exportedDate: string;
}

// Letter, in points
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
const SIDE = 36;
const TOP = 54;
const BOTTOM = 40;

const LINE = "#888888";
const BAR_FILL = "#dddddd";
const ZEBRA = "#f0f0f0";
const MUTED = "#777777";
/** Logo aspect ratio (viewBox 54 x 32) */
const LOGO_RATIO = 54 / 32;

// Quarter layout
export const QUARTER_GAP_PADDING = 6;
const GRID_LINE = 0.75;
export const QUARTER_WIDTH = (PAGE_WIDTH - 2 * SIDE) / 2;
export const QUARTER_HEIGHT = (PAGE_HEIGHT - TOP - BOTTOM) / 2;
export const QUARTER_FONT_SIZE = 7.5;
const QUARTER_BAR_FONT_SIZE = 10;
const QUARTER_CELL_PAD_X = 3;
const QUARTER_CELL_PAD_Y = 1.5;
const QUARTER_BAR_PAD = 4;

// Full layout
const FULL_FONT_SIZE = 11;
const FULL_BAR_FONT_SIZE = 14;

/**
 * Per font: glyph widths relative to the estimate table in `charWidth`;
 * `natural`, the line height pdfmake uses (ascender to descender: Helvetica
 * 0.925 em, Roboto 1.172 em); and `leading`, the multiplier we apply so
 * wrapped Helvetica lines are not cramped. Tuned against real layouts (see
 * the fit test).
 */
const FONT_METRICS: Record<
    SheetFont,
    { width: number; natural: number; leading: number }
> = {
    Helvetica: { width: 0.93, natural: 0.925, leading: 1.1 },
    Roboto: { width: 1.0, natural: 1.172, leading: 1 },
};
const lineHeightOf = (font: SheetFont) =>
    FONT_METRICS[font].natural * FONT_METRICS[font].leading * 1.01;

function textCell(text: string | number, extra: PdfNode = {}): PdfNode {
    return { text: String(text), ...extra };
}

// ---------------------------------------------------------------- page chrome

function logoNode(svg: string | undefined, height: number): PdfNode {
    if (!svg) return { text: "", width: height * LOGO_RATIO };
    return { svg, width: height * LOGO_RATIO, height };
}

/** Page header: logo on the left, show name centred. */
export function pageHeader(
    showName: string,
    logoSvg: string | undefined,
): PdfNode {
    const logoHeight = 20;
    return {
        margin: [SIDE, 18, SIDE, 0],
        columns: [
            logoNode(logoSvg, logoHeight),
            {
                width: "*",
                text: showName,
                alignment: "center",
                bold: true,
                fontSize: 9,
                color: MUTED,
                margin: [0, 5, 0, 0],
            },
            { width: logoHeight * LOGO_RATIO, text: "" },
        ],
    };
}

/** Page footer: export date, logo + "Made with OpenMarch", "Page X of Y". */
export function pageFooter(
    page: number,
    total: number,
    opts: Pick<BuildOptions, "labels" | "logoSvg" | "exportedDate">,
): PdfNode {
    const small = { fontSize: 8, color: MUTED };
    return {
        margin: [SIDE, 14, SIDE, 0],
        columns: [
            {
                width: "*",
                text: opts.labels.exported(opts.exportedDate),
                ...small,
            },
            {
                width: "auto",
                columns: [
                    {
                        ...logoNode(opts.logoSvg, 9),
                        opacity: 0.55,
                    },
                    {
                        width: "auto",
                        text: opts.labels.madeWith,
                        margin: [4, 0.5, 0, 0],
                        ...small,
                    },
                ],
            },
            {
                width: "*",
                text: opts.labels.pageOf(page, total),
                alignment: "right",
                ...small,
            },
        ],
    };
}

function baseDocument(model: SheetModel, opts: BuildOptions): DocDefinition {
    return {
        pageSize: "LETTER",
        pageMargins: [SIDE, TOP, SIDE, BOTTOM],
        info: {
            title: model.showName
                ? `${model.showName}: coordinate sheets`
                : "Coordinate sheets",
            creator: "OpenMarch",
            producer: "OpenMarch",
        },
        defaultStyle: {
            font: opts.font,
            fontSize: FULL_FONT_SIZE,
            lineHeight: FONT_METRICS[opts.font].leading,
        },
        header: () => pageHeader(model.showName, opts.logoSvg),
        footer: (page: number, total: number) => pageFooter(page, total, opts),
    };
}

// ---------------------------------------------------------------- shared bits

function cellTexts(row: SheetRow, opts: SheetOptions, quarter: boolean) {
    const x = opts.terse
        ? (row.sideToSideTerse ?? row.sideToSide)
        : row.sideToSide;
    const y = opts.terse
        ? (row.frontToBackTerse ?? row.frontToBack)
        : row.frontToBack;
    const measure = quarter ? compactMeasure(row.measures) : row.measures;
    return opts.includeMeasures
        ? [row.set, String(row.counts), measure, x, y]
        : [row.set, String(row.counts), x, y];
}

function headerTexts(opts: BuildOptions, quarter: boolean) {
    const c = opts.labels.columns;
    const page = quarter && c.page === "Pg" ? "Pg." : c.page;
    const x = opts.useXY ? "X" : c.x;
    const y = opts.useXY ? "Y" : c.y;
    return opts.includeMeasures
        ? [page, c.counts, c.measure, x, y]
        : [page, c.counts, x, y];
}

/** Column widths as fractions of the table width. */
function columnFractions(includeMeasures: boolean, quarter: boolean) {
    if (quarter)
        return includeMeasures
            ? [0.11, 0.09, 0.16, 0.32, 0.32]
            : [0.12, 0.1, 0.39, 0.39];
    return includeMeasures
        ? [0.1, 0.12, 0.15, 0.315, 0.315]
        : [0.12, 0.14, 0.37, 0.37];
}

const asPercent = (fs: number[]) => fs.map((f) => `${(f * 100).toFixed(2)}%`);

/** Grid lines for a coordinate table. */
const tableLines = (padX: number, padY: number) => ({
    hLineWidth: () => 0.75,
    vLineWidth: () => 0.75,
    hLineColor: () => LINE,
    vLineColor: () => LINE,
    paddingLeft: () => padX,
    paddingRight: () => padX,
    paddingTop: () => padY,
    paddingBottom: () => padY,
});

/** The grey performer bar: drill number | name | section (or "Page n"). */
function performerBar(
    drill: string,
    name: string,
    right: string,
    fontSize: number,
    pad: number,
): PdfNode {
    const cell = (text: string) =>
        textCell(text, { bold: true, fontSize, fillColor: BAR_FILL });
    return {
        table: {
            widths: ["auto", "*", "auto"],
            body: [
                [
                    { ...cell(drill), noWrap: true },
                    cell(name),
                    { ...cell(right), noWrap: true },
                ],
            ],
        },
        layout: {
            hLineWidth: () => 0,
            vLineWidth: (i: number, node: { table: { widths: unknown[] } }) =>
                i === 0 || i === node.table.widths.length ? 0 : 0.75,
            vLineColor: () => LINE,
            vLineStyle: () => ({ dash: { length: 1, space: 1.5 } }),
            paddingLeft: () => pad * 1.5,
            paddingRight: () => pad * 1.5,
            paddingTop: () => pad,
            paddingBottom: () => pad,
        },
    };
}

// ---------------------------------------------------------------- full pages

/** One marcher's full-page sheet: a single table that may run onto more pages. */
export function fullSheet(
    marcher: SheetMarcher,
    opts: BuildOptions,
    first: boolean,
): PdfNode {
    const headers = headerTexts(opts, false);
    const n = headers.length;
    const alignFor = (i: number) => (i >= n - 2 ? "left" : "center");
    const bar = {
        ...performerBar(
            marcher.drillNumber,
            marcher.displayName,
            marcher.section,
            FULL_BAR_FONT_SIZE,
            8,
        ),
        colSpan: n,
        // the bar's own table draws its fill; no padding around it
        margin: [-5, -4, -5, -4],
    };
    const barRow: PdfCell[] = [bar, ...Array.from({ length: n - 1 }, () => "")];
    const headerRow = headers.map((h) =>
        textCell(h, { bold: true, alignment: "center" }),
    );
    const body = marcher.rows.map((row) =>
        cellTexts(row, opts, false).map((t, i) =>
            textCell(t, { alignment: alignFor(i) }),
        ),
    );
    return {
        pageBreak: first ? undefined : "before",
        table: {
            headerRows: 2,
            dontBreakRows: true,
            widths: asPercent(columnFractions(opts.includeMeasures, false)),
            body: [barRow, headerRow, ...body],
        },
        layout: tableLines(5, 4),
    };
}

export function fullDocument(
    model: SheetModel,
    opts: BuildOptions,
): DocDefinition {
    return {
        ...baseDocument(model, opts),
        content: model.marchers.map((m, i) => fullSheet(m, opts, i === 0)),
    };
}

// ---------------------------------------------------------------- quarter pages

/** Rough advance width of a character, in ems (Helvetica/Roboto-like). */
function charWidth(ch: string, bold: boolean): number {
    let w: number;
    if (ch === " ") w = 0.278;
    else if (/[0-9]/.test(ch)) w = 0.556;
    else if (/[mwMW]/.test(ch)) w = 0.89;
    else if (/[A-Z]/.test(ch)) w = 0.7;
    else if (/[a-z]/.test(ch)) w = /[ijlft]/.test(ch) ? 0.3 : 0.56;
    else if (/[.,:;'!|]/.test(ch)) w = 0.28;
    else w = 0.6; // accents, other scripts, symbols
    return bold ? w * 1.07 : w;
}

/**
 * How many lines `text` wraps to in a box `width` points wide, simulating
 * greedy word wrap with estimated glyph widths. Errs towards more lines.
 */
export function estimateLines(
    text: string,
    width: number,
    fontSize: number,
    bold = false,
    widthScale = 1,
): number {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return 1;
    const measure = (s: string) =>
        [...s].reduce((sum, ch) => sum + charWidth(ch, bold), 0) *
        fontSize *
        widthScale;
    const space = charWidth(" ", bold) * fontSize * widthScale;
    let lines = 1;
    let used = 0;
    for (const word of words) {
        let w = measure(word);
        if (used > 0 && used + space + w <= width) {
            used += space + w;
            continue;
        }
        if (used > 0) lines++;
        // a word wider than the box breaks across lines
        while (w > width) {
            lines++;
            w -= width;
        }
        used = w;
    }
    return lines;
}

const QUARTER_INNER_WIDTH = QUARTER_WIDTH - 2 * QUARTER_GAP_PADDING - GRID_LINE;
const QUARTER_INNER_HEIGHT =
    QUARTER_HEIGHT - 2 * QUARTER_GAP_PADDING - 2 * GRID_LINE;

function rowHeight(
    texts: string[],
    fractions: number[],
    font: SheetFont,
    bold = false,
) {
    const m = FONT_METRICS[font];
    const lines = Math.max(
        ...texts.map((t, i) =>
            estimateLines(
                t,
                fractions[i] * QUARTER_INNER_WIDTH - 2 * QUARTER_CELL_PAD_X - 1,
                QUARTER_FONT_SIZE,
                bold,
                m.width,
            ),
        ),
    );
    return (
        lines * QUARTER_FONT_SIZE * lineHeightOf(font) +
        2 * QUARTER_CELL_PAD_Y +
        0.75
    );
}

function barHeight(marcher: SheetMarcher, pageLabel: string, font: SheetFont) {
    const m = FONT_METRICS[font];
    // the name gets what the drill number and "Page n" leave
    const side = (s: string) =>
        [...s].reduce((sum, ch) => sum + charWidth(ch, true), 0) *
            QUARTER_BAR_FONT_SIZE *
            m.width +
        3 * QUARTER_BAR_PAD;
    const nameWidth =
        QUARTER_INNER_WIDTH -
        side(marcher.drillNumber) -
        side(pageLabel) -
        3 * QUARTER_BAR_PAD;
    const lines = estimateLines(
        marcher.displayName,
        Math.max(nameWidth, 20),
        QUARTER_BAR_FONT_SIZE,
        true,
        m.width,
    );
    return (
        lines * QUARTER_BAR_FONT_SIZE * lineHeightOf(font) + 2 * QUARTER_BAR_PAD
    );
}

/**
 * Split a marcher's rows into quarter sheets, each holding as many rows as
 * fit its box. Verbose coordinates usually wrap to two lines, so a quarter
 * holds about 15 of them (45 sets = 3 quarters); terse rows hold more.
 */
export function chunkQuarterRows(
    marcher: SheetMarcher,
    opts: BuildOptions,
): SheetRow[][] {
    const fractions = columnFractions(opts.includeMeasures, true);
    const header = rowHeight(
        headerTexts(opts, true),
        fractions,
        opts.font,
        true,
    );
    const chunks: SheetRow[][] = [];
    let current: SheetRow[] = [];
    let used = 0;
    // 3% headroom for estimation error
    const budget = (n: number) =>
        QUARTER_INNER_HEIGHT * 0.97 -
        header -
        barHeight(marcher, opts.labels.quarterPage(n), opts.font);
    for (const row of marcher.rows) {
        const h = rowHeight(cellTexts(row, opts, true), fractions, opts.font);
        if (current.length > 0 && used + h > budget(chunks.length + 1)) {
            chunks.push(current);
            current = [];
            used = 0;
        }
        current.push(row);
        used += h;
    }
    if (current.length > 0 || chunks.length === 0) chunks.push(current);
    return chunks;
}

/** One quarter sheet: performer bar and a compact table. */
export function quarterSheet(
    marcher: SheetMarcher,
    rows: SheetRow[],
    quarterNumber: number,
    opts: BuildOptions,
): PdfNode {
    const headers = headerTexts(opts, true);
    const n = headers.length;
    const small = { fontSize: QUARTER_FONT_SIZE };
    return {
        stack: [
            performerBar(
                marcher.drillNumber,
                marcher.displayName,
                opts.labels.quarterPage(quarterNumber),
                QUARTER_BAR_FONT_SIZE,
                QUARTER_BAR_PAD,
            ),
            {
                table: {
                    headerRows: 1,
                    widths: asPercent(
                        columnFractions(opts.includeMeasures, true),
                    ),
                    body: [
                        headers.map((h, i) =>
                            textCell(h, {
                                ...small,
                                bold: true,
                                alignment: i >= n - 2 ? "left" : "center",
                            }),
                        ),
                        ...rows.map((row, r) =>
                            cellTexts(row, opts, true).map((t, i) =>
                                textCell(t, {
                                    ...small,
                                    alignment: i >= n - 2 ? "left" : "center",
                                    fillColor: r % 2 === 0 ? ZEBRA : undefined,
                                }),
                            ),
                        ),
                    ],
                },
                layout: tableLines(QUARTER_CELL_PAD_X, QUARTER_CELL_PAD_Y),
            },
        ],
    };
}

export interface QuarterItem {
    marcher: SheetMarcher;
    rows: SheetRow[];
    quarterNumber: number;
}

export function quarterItems(
    model: SheetModel,
    opts: BuildOptions,
): QuarterItem[] {
    return model.marchers.flatMap((marcher) =>
        chunkQuarterRows(marcher, opts).map((rows, i) => ({
            marcher,
            rows,
            quarterNumber: i + 1,
        })),
    );
}

/** A Letter page holding up to four quarter sheets. */
function quarterGrid(
    items: QuarterItem[],
    opts: BuildOptions,
    first: boolean,
): PdfNode {
    const cell = (item: QuarterItem | undefined): PdfNode =>
        item
            ? quarterSheet(item.marcher, item.rows, item.quarterNumber, opts)
            : { text: "", border: [false, false, false, false] };
    return {
        pageBreak: first ? undefined : "before",
        table: {
            widths: ["*", "*"],
            heights: [QUARTER_INNER_HEIGHT, QUARTER_INNER_HEIGHT],
            dontBreakRows: true,
            body: [
                [cell(items[0]), cell(items[1])],
                [cell(items[2]), cell(items[3])],
            ],
        },
        layout: {
            hLineWidth: () => GRID_LINE,
            vLineWidth: () => GRID_LINE,
            hLineColor: () => "#333333",
            vLineColor: () => "#333333",
            paddingLeft: () => QUARTER_GAP_PADDING,
            paddingRight: () => QUARTER_GAP_PADDING,
            paddingTop: () => QUARTER_GAP_PADDING,
            paddingBottom: () => QUARTER_GAP_PADDING,
        },
    };
}

export function quarterDocument(
    model: SheetModel,
    opts: BuildOptions,
): DocDefinition {
    const items = quarterItems(model, opts);
    const grids: PdfNode[] = [];
    for (let i = 0; i < items.length; i += 4)
        grids.push(quarterGrid(items.slice(i, i + 4), opts, i === 0));
    return { ...baseDocument(model, opts), content: grids };
}

/**
 * A single quarter sheet on a page exactly the size of a quarter's box, for
 * checking fit: if it lays out on one page, it fits its quarter.
 */
export function quarterFitDocument(
    item: QuarterItem,
    opts: BuildOptions,
): DocDefinition {
    return {
        pageSize: {
            width: QUARTER_INNER_WIDTH,
            height: QUARTER_INNER_HEIGHT,
        },
        pageMargins: [0, 0, 0, 0],
        defaultStyle: {
            font: opts.font,
            fontSize: FULL_FONT_SIZE,
            lineHeight: FONT_METRICS[opts.font].leading,
        },
        content: [
            quarterSheet(item.marcher, item.rows, item.quarterNumber, opts),
        ],
    };
}
