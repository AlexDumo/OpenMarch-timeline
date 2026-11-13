// cspell:words fulgur fulgur's ironpress dompdf fontkit krilla stylo nosplit asis breakbefore
/**
 * Extra CSS appended after today's print CSS so fulgur renders the sheets.
 * The sheet HTML itself is unchanged (apart from colWidthsToHeaderCells).
 * The header and footer are not drawn here: fulgur's Blitz backend places
 * `@page` margin boxes poorly (no text-align, no images, running elements do
 * not show), so they are stamped afterwards (./stamp.ts).
 */
import { printRulesUnwrapped } from "../sheetDocument.ts";

export interface FulgurCssOptions {
    quarterPages: boolean;
    /** Family name of the font registered with `add_font`. */
    fontFamily: string;
}

export function fulgurCss(o: FulgurCssOptions): string {
    return `
/* 1. fulgur lays out as "screen": repeat the @media print rules outside it. */
${printRulesUnwrapped(o.quarterPages)}

/* 2. No system fonts in WASM: every family maps to the bundled font. */
* { font-family: "${o.fontFamily}" !important; }

/* 3. No border-collapse in fulgur: draw each shared edge once instead. */
table { border-collapse: separate !important; border-spacing: 0 !important;
        border-top: 1px solid #888; border-left: 1px solid #888; }
table th, table td { border-top: 0 !important; border-left: 0 !important;
        vertical-align: middle; box-sizing: border-box; }

/* 3b. fulgur paints no <tr> background: let the cells take the row's color (zebra rows). */
tbody tr > td { background-color: inherit; }

/* 5. fulgur skips the legacy page-break-after alias here: say it with break-before. */
.marcher-sheet + .marcher-sheet, .grid-container + .grid-container { break-before: page; }

${
    o.quarterPages
        ? `/* 6. Quarter pages: slightly smaller rows so 18 wordy rows fit their quarter
      (today they overflow into the next quarter; fixes that known defect). */
.grid-item td { font-size: 9px !important; line-height: 1.05 !important; padding: 1px 2px !important; }
.grid-item h4 { font-size: 0.85rem !important; }`
        : ""
}

/* 4. Keep each quarter at its 50% track, as Chromium does, instead of growing
      the grid row to fit an overflowing sheet. */
.grid-item { min-height: 0; min-width: 0; }
`;
}
