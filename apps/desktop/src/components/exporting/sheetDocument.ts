/**
 * The printable HTML document that wraps rendered coordinate sheets.
 *
 * Shared by both PDF paths:
 * - Electron (`electron/main/services/export-service.ts`) loads
 *   `buildSheetDocumentHtml` in a hidden window and calls `printToPDF` with
 *   its own header and footer templates.
 * - The web build (`web/renderer/printSheets.ts`) loads
 *   `buildBrowserPrintDocumentHtml` in a hidden iframe and calls `print()`.
 *   A browser's print has no header/footer templates, so this document draws
 *   the header and footer itself with CSS paged media (`@page` margin boxes,
 *   `counter(page)` and `counter(pages)`), natively (Chrome 131+) or with the
 *   Paged.js polyfill.
 *
 * Pure string building, so it runs in the main process, a page and tests.
 */

export function chunkArray<T>(array: T[], size: number): T[][] {
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

function sheetsBody(sheets: string[], quarterPages: boolean): string {
    return quarterPages
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
}

/**
 * Wrap rendered coordinate sheets in a printable HTML document. In quarter
 * page mode, sheets are arranged into 2x2 grids; otherwise each sheet starts
 * on its own page and may flow onto more (the print styles keep the table
 * headers repeating and rows unbroken).
 */
export function buildSheetDocumentHtml(
    sheets: string[],
    quarterPages: boolean,
): string {
    return `<html>
      <head>
        <meta charset="UTF-8" />
        <title>PDF Export</title>
        <style>${printStyles(quarterPages)}</style>
      </head>
      <body>${sheetsBody(sheets, quarterPages)}</body>
    </html>`;
}

// ---------------------------------------------------------------------------
// Browser print (web build)
// ---------------------------------------------------------------------------

/** A CSS string literal that is safe inside a `<style>` element. */
export function cssString(text: string): string {
    return `"${text
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/[\r\n]+/g, " ")
        // "</style>" in a show name must not end the style element
        .replace(/</g, "\\3C ")}"`;
}

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * The logo as a data URI at a fixed size. Margin boxes show `content: url()`
 * at the image's own size, so the size is set on the SVG itself.
 */
export function logoDataUri(
    logoSvg: string,
    heightPx: number,
    color = "black",
): string {
    const rootEnd = logoSvg.indexOf(">");
    const root = logoSvg.slice(0, rootEnd);
    const viewBox = /viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)"/.exec(
        root,
    );
    const ratio = viewBox ? Number(viewBox[1]) / Number(viewBox[2]) : 54 / 32;
    const sizedRoot =
        root.replace(/\s(width|height)="[^"]*"/g, "") +
        ` width="${(heightPx * ratio).toFixed(2)}" height="${heightPx}"`;
    const svg = (sizedRoot + logoSvg.slice(rootEnd)).replace(
        /currentColor/g,
        color,
    );
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export type PrintEngine = "native" | "pagedjs";

export interface BrowserPrintDocumentOptions {
    /** Rendered sheets (`StaticMarcherCoordinateSheet` HTML). */
    sheets: string[];
    quarterPages: boolean;
    showName: string;
    /** The logo SVG source (`@/assets/open-march-logo.svg?raw`). */
    logoSvg: string;
    /** "Exported <date>" in the footer. */
    exportedOn: string;
    /** The document title: browsers suggest it as the PDF's file name. */
    title: string;
    /**
     * "native": CSS margin boxes, which only Chromium 131+ draws.
     * "pagedjs": the same CSS, laid out into pages by the Paged.js polyfill
     * (loaded from `pagedPolyfillUrl`) before printing.
     */
    engine: PrintEngine;
    pagedPolyfillUrl?: string;
}

const MARGIN_BOX_FONT = `font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #777;`;

/** `@page` rules that draw the header and footer in the page margins. */
export function pageMarginBoxStyles(
    opts: Pick<
        BrowserPrintDocumentOptions,
        "showName" | "logoSvg" | "exportedOn" | "quarterPages"
    >,
): string {
    const headerLogo = logoDataUri(opts.logoSvg, 22);
    const footerLogo = logoDataUri(opts.logoSvg, 10, "#999999");
    return `
  @page {
    size: letter;
    margin: 0.75in ${opts.quarterPages ? "0.5in" : "0.5in"} 0.5in;

    @top-left {
      content: url("${headerLogo}");
      vertical-align: bottom;
      padding-bottom: 0.12in;
    }
    @top-center {
      content: ${cssString(opts.showName)};
      ${MARGIN_BOX_FONT}
      font-weight: bold;
      color: #555;
      vertical-align: bottom;
      padding-bottom: 0.15in;
    }
    @bottom-left {
      content: ${cssString(`Exported ${opts.exportedOn}`)};
      ${MARGIN_BOX_FONT}
      vertical-align: middle;
    }
    @bottom-center {
      content: url("${footerLogo}") "  Made with OpenMarch";
      ${MARGIN_BOX_FONT}
      vertical-align: middle;
    }
    @bottom-right {
      content: "Page " counter(page) " of " counter(pages);
      ${MARGIN_BOX_FONT}
      vertical-align: middle;
    }
  }`;
}

/**
 * Layout rules for every medium (not only print), so the document lays out on
 * screen exactly as it will print: quarter sheets can be measured and fitted
 * before printing, and Paged.js (which paginates the screen layout) sees the
 * same boxes.
 */
const browserLayoutStyles = (quarterPages: boolean) => `
  * {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  html, body { margin: 0; padding: 0; background: white; }
  body { font-family: Arial, sans-serif; }
  .marcher-sheet {
    width: 100%;
    box-sizing: border-box;
    break-before: page;
  }
  .marcher-sheet:first-child { break-before: auto; }
  ${
      quarterPages
          ? `
  .grid-container {
    display: grid;
    grid-template-columns: 50% 50%;
    grid-template-rows: 50% 50%;
    /* 11in page - 0.75in top - 0.5in bottom margin, minus a hair so
       rounding never pushes a grid onto a second page */
    height: 9.7in;
    width: 7.5in;
    break-inside: avoid;
  }
  .grid-container + .grid-container { break-before: page; }
  .grid-item {
    box-sizing: border-box;
    padding: 0.1in;
    border: 1px solid #333;
    overflow: hidden;
    min-height: 0;
  }
  .grid-item > .fit { transform-origin: top left; }
  .marcher-sheet { padding: 0.5rem; }`
          : ""
  }
  table { break-inside: auto; }
  thead { display: table-header-group; }
  tbody tr { break-inside: avoid; page-break-inside: avoid; }
  .sheetHeader { break-after: avoid; page-break-after: avoid; }
`;

/**
 * Shrinks each quarter sheet that is too tall for its quarter until it fits,
 * instead of letting it run into the next one. Runs in the print document.
 * Uses `zoom` so the table reflows at the smaller size (wider columns in CSS
 * pixels, so fewer wrapped lines); stops at 55% so text stays readable.
 */
export function fitQuarterSheets(doc: Document): {
    fitted: number;
    stillOverflowing: number;
} {
    let fitted = 0;
    let stillOverflowing = 0;
    for (const item of Array.from(
        doc.querySelectorAll<HTMLElement>(".grid-item"),
    )) {
        const inner = item.firstElementChild as HTMLElement | null;
        if (!inner) continue;
        const style = doc.defaultView!.getComputedStyle(item);
        const available =
            item.clientHeight -
            parseFloat(style.paddingTop) -
            parseFloat(style.paddingBottom);
        const height = () => inner.getBoundingClientRect().height;
        if (height() <= available) continue;
        let zoom = 1;
        while (height() > available && zoom > 0.55) {
            zoom = Math.max(0.55, zoom * Math.min(0.97, available / height()));
            inner.style.zoom = String(zoom);
        }
        if (height() > available) stillOverflowing++;
        else fitted++;
    }
    return { fitted, stillOverflowing };
}

/**
 * The document the web build prints: today's sheets, the same rules as
 * desktop, and the header and footer as `@page` margin boxes.
 */
export function buildBrowserPrintDocumentHtml(
    opts: BrowserPrintDocumentOptions,
): string {
    const pagedScripts =
        opts.engine === "pagedjs" && opts.pagedPolyfillUrl
            ? `<script>
      window.PagedConfig = {
        auto: true,
        before: function () {
          if (window.__omBeforePaginate) return window.__omBeforePaginate();
        },
        after: function (flow) {
          window.__omPaged = { pages: flow.total };
          document.documentElement.dataset.paged = "done";
        },
      };
    </script>
    <script src="${escapeHtml(opts.pagedPolyfillUrl)}"></script>
    <script>
      // Paged.js doesn't repeat a table's header (or keep its column widths)
      // on the pages a table continues onto: when the first row of a
      // continued table is laid out, copy them in from the source table
      Paged.registerHandlers(class extends Paged.Handler {
        renderNode(clone, node) {
          if (!clone || clone.nodeName !== "TR") return;
          var table = clone.closest && clone.closest("table");
          var source = node.closest && node.closest("table");
          if (!table || !source || table.querySelector("thead")) return;
          var head = source.querySelector(":scope > thead");
          var cols = source.querySelector(":scope > colgroup");
          var copy = function (el) {
            var c = el.cloneNode(true);
            // Paged.js tracks laid-out nodes by data-ref: copies get none
            c.removeAttribute("data-ref");
            c.querySelectorAll("[data-ref]").forEach(function (e) {
              e.removeAttribute("data-ref");
            });
            return c;
          };
          if (head) table.insertBefore(copy(head), table.firstChild);
          if (cols) table.insertBefore(copy(cols), table.firstChild);
        }
      });
    </script>
    <style>
      /* Paged.js page boxes: no gap or shadow when printed */
      @media print { .pagedjs_pages { margin: 0; } }
      @media screen {
        body { background: #ccc; }
        .pagedjs_page { background: white; margin: 0 auto 12px; }
      }
    </style>`
            : "";
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(opts.title)}</title>
    <style>${browserLayoutStyles(opts.quarterPages)}${pageMarginBoxStyles(opts)}</style>
    ${pagedScripts}
  </head>
  <body>${
      opts.quarterPages
          ? chunkArray(opts.sheets, 4)
                .map(
                    (chunk) =>
                        `<div class="grid-container">${chunk
                            .map(
                                (sheet) =>
                                    `<div class="grid-item"><div class="fit">${sheet}</div></div>`,
                            )
                            .join("")}</div>`,
                )
                .join("")
          : sheetsBody(opts.sheets, false)
  }</body>
</html>`;
}
