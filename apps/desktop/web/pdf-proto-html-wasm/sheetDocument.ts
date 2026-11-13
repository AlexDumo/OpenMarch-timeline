// cspell:words fulgur fulgur's ironpress dompdf fontkit krilla stylo nosplit asis breakbefore
/**
 * Prototype: today's coordinate-sheet document, unchanged.
 *
 * `printStyles`, `chunkArray` and `buildSheetDocumentHtml` are copied verbatim
 * from electron/main/services/export-service.ts. `headerHtml`/`footerHtml` are
 * the same templates, minus Chromium's `pageNumber`/`totalPages` classes, which
 * only `printToPDF` fills in. Engines get page numbers their own way.
 */

function chunkArray<T>(array: T[], size: number): T[][] {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}

export const printStyles = (quarterPages: boolean) => `
  @media print {
    .marcher-sheet {
      page-break-before: auto;
      min-height: 10in;
      width: 100%;
      box-sizing: border-box;
    }
    .marcher-sheet:not(:last-child) {
      page-break-after: always;
    }
    ${
        quarterPages
            ? `
      .grid-container {
        display: grid;
        grid-template-columns: 50% 50%;
        grid-template-rows: 50% 50%;
        height: 10in;
        width: 7.5in;
      }
      .grid-container:not(:last-child) {
        page-break-after: always;
      }
      .grid-item {
        box-sizing: border-box;
        padding: 0.1in;
        border: 1px solid #333;
      }
      .marcher-sheet {
        page-break-before: auto;
        page-break-after: auto;
        min-height: auto;
        padding: 0.5rem;
      }
    `
            : ""
    }

    /* Allow tables to break across pages but keep headers */
    table {
      page-break-inside: auto;
    }

    /* Ensure table headers repeat on each page */
    thead {
      display: table-header-group;
    }

    /* Ensure performer header repeats on each page */
    .sheetHeader {
      display: table-header-group;
      page-break-inside: avoid;
      page-break-after: avoid;
    }

    /* Keep coordinate rows whole across page breaks */
    tbody tr {
      page-break-inside: avoid;
    }
  }

  @page {
    margin: 0.5in;
  }

  body {
    margin: 0;
    padding: 0;
    font-family: Arial, sans-serif;
  }
`;

export function buildSheetDocumentHtml(
    sheets: string[],
    quarterPages: boolean,
    extraCss = "",
): string {
    const combinedHtml = quarterPages
        ? chunkArray(sheets, 4)
              .map(
                  (chunk) => `<div class="grid-container">
                      ${chunk.map((sheet) => `<div class="grid-item">${sheet}</div>`).join("")}
                  </div>`,
              )
              .join("")
        : sheets
              .map((sheet) => `<div class="marcher-sheet">${sheet}</div>`)
              .join("");

    return `<html>
      <head>
        <meta charset="UTF-8" />
        <title>PDF Export</title>
        <style>${printStyles(quarterPages)}${extraCss}</style>
      </head>
      <body>${combinedHtml}</body>
    </html>`;
}

export function logoDataUri(logoSvgRaw: string): string {
    const svg = logoSvgRaw.replace(/currentColor/g, "black");
    const b64 =
        typeof btoa === "function"
            ? btoa(unescape(encodeURIComponent(svg)))
            : Buffer.from(svg).toString("base64");
    return `data:image/svg+xml;base64,${b64}`;
}

/** Same layout as export-service's header template. */
export const headerHtml = (logo: string, showName: string) => `
<div style="padding: 4px 16px; font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: space-between; font-size: 9px; color: #999; width: 100%; box-sizing: border-box; height: 20px;">
    <div style="flex: 1; text-align: left;"><img src="${logo}" style="height: 16px; width: auto;" /></div>
    <div style="flex: 1; text-align: center; font-weight: bold; font-size: 8px;">${showName}</div>
    <div style="flex: 1;"></div>
</div>`;

/** Same layout as export-service's footer template; `pageText` replaces the Chromium spans. */
export const footerHtml = (logo: string, date: string, pageText: string) => `
<div style="padding: 4px 16px; font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: space-between; font-size: 8px; color: #999; width: 100%; box-sizing: border-box; height: 16px;">
    <div style="flex: 1; text-align: left;">Exported ${date}</div>
    <div style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px;">
        <img src="${logo}" style="height: 10px; width: auto; opacity: 0.55;" />
        <span>Made with OpenMarch</span>
    </div>
    <div style="flex: 1; text-align: right;">${pageText}</div>
</div>`;

/**
 * The rules inside `@media print { ... }` of `printStyles`, for engines that
 * lay out as "screen" and so skip that block (fulgur).
 */
export function printRulesUnwrapped(quarterPages: boolean): string {
    const css = printStyles(quarterPages);
    const start = css.indexOf("@media print {") + "@media print {".length;
    const end = css.lastIndexOf("@page");
    const inner = css.slice(start, end);
    return inner.slice(0, inner.lastIndexOf("}"));
}

export interface ExportSheet {
    name: string;
    drillNumber: string;
    section: string;
    renderedPage: string;
}

/** Margins of today's printToPDF call, in inches. */
export const MARGINS = {
    full: { top: 0.75, bottom: 0.5, left: 0.25, right: 0.25 },
    quarter: { top: 0.75, bottom: 0.5, left: 0, right: 0 },
};
