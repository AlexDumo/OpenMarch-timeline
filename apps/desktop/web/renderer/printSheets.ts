/**
 * Coordinate sheets as a PDF in the web build, through the browser's own
 * print: the sheets go into a hidden iframe and its `print()` opens the print
 * dialog, where the person picks "Save as PDF" (desktop) or shares the
 * preview to Files (iPad).
 *
 * The document (`src/components/exporting/sheetDocument.ts`) is the same
 * one desktop prints, with the header and footer drawn by `@page` margin
 * boxes. Chromium 131+ draws those itself. Safari and Firefox don't, so the
 * "pagedjs" engine first lays the document out into pages with the Paged.js
 * polyfill, which draws the margin boxes as ordinary elements; its script is
 * a separate file loaded only when an export asks for it.
 *
 * One print dialog shows one document, so this makes one PDF. "Organize by
 * section" (a file per marcher or section) can't be done this way.
 */
import logoSvg from "@/assets/open-march-logo.svg?raw";
import {
    buildBrowserPrintDocumentHtml,
    fitQuarterSheets,
    type PrintEngine,
} from "../../src/components/exporting/sheetDocument";

export interface PrintSheetsRequest {
    sheets: string[];
    quarterPages: boolean;
    showName: string;
    /** Defaults to Paged.js where margin boxes aren't drawn natively. */
    engine?: PrintEngine;
}

export interface PreparedPrint {
    iframe: HTMLIFrameElement;
    window: Window;
    engine: PrintEngine;
    /** Pages Paged.js laid out (pagedjs engine only). */
    pages?: number;
    quarterFit?: { fitted: number; stillOverflowing: number };
    /** Opens the print dialog. Call from the export tap's handler chain. */
    print(): void;
    remove(): void;
}

/**
 * Whether this browser draws `@page` margin boxes itself. There is no
 * feature query for them, so this asks for Chromium 131 or later (Chrome,
 * Edge, Opera, Samsung Internet; not Chromium-based iOS browsers, which are
 * WebKit).
 */
export function supportsNativeMarginBoxes(
    userAgent = navigator.userAgent,
): boolean {
    if (/iPad|iPhone|iPod/.test(userAgent)) return false;
    if (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1)
        return false; // iPadOS reports as a Mac
    const match = /Chrom(?:e|ium)\/(\d+)/.exec(userAgent);
    return !!match && Number(match[1]) >= 131;
}

/** "Show name - coordinate sheets - 2026-11-12", the suggested file name. */
export function printTitle(showName: string, date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const name = showName.trim() || "OpenMarch";
    return `${name} - coordinate sheets - ${day}`;
}

/**
 * The Paged.js polyfill as its own file, emitted by Vite and fetched only by
 * the print iframe of a "pagedjs" print (the package's exports map hides
 * dist/, hence the path).
 */
const pagedPolyfillUrl = () =>
    new URL(
        "../../node_modules/pagedjs/dist/paged.polyfill.min.js",
        import.meta.url,
    ).href;

let current: PreparedPrint | null = null;

/**
 * Builds the print document in a hidden iframe and waits until it is laid
 * out (fonts, logo, quarter fitting, Paged.js). Doesn't open the dialog.
 */
// eslint-disable-next-line max-lines-per-function
export async function preparePrint(
    request: PrintSheetsRequest,
    { timeoutMs = 120_000, parent = document.body } = {},
): Promise<PreparedPrint> {
    // A previous print's iframe stays until the next export: on iPad print()
    // returns before the print sheet is done with the document
    current?.remove();

    const engine =
        request.engine ?? (supportsNativeMarginBoxes() ? "native" : "pagedjs");
    const title = printTitle(request.showName);
    const html = buildBrowserPrintDocumentHtml({
        sheets: request.sheets,
        quarterPages: request.quarterPages,
        showName: request.showName,
        logoSvg,
        exportedOn: new Date().toLocaleDateString(),
        title,
        engine,
        pagedPolyfillUrl: engine === "pagedjs" ? pagedPolyfillUrl() : undefined,
    });

    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    iframe.title = title;
    // Laid out at page width, in the viewport but invisible and behind
    // the app: a display:none or 0x0 frame has no layout to measure (and
    // some browsers print it blank), and Firefox and Safari throttle frames
    // that are off screen or hidden, which made Paged.js 20-100x slower
    Object.assign(iframe.style, {
        position: "fixed",
        left: "0",
        top: "0",
        width: "8.5in",
        height: "11in",
        border: "0",
        opacity: "0",
        pointerEvents: "none",
        zIndex: "-1",
    });

    let quarterFit: PreparedPrint["quarterFit"];
    parent.appendChild(iframe);
    const win = iframe.contentWindow!;
    // Runs before Paged.js paginates (or right after load for native)
    const fit = async () => {
        const doc = iframe.contentDocument!;
        await doc.fonts?.ready;
        await Promise.all(
            Array.from(doc.images).map((img) =>
                img.decode().catch(() => undefined),
            ),
        );
        if (request.quarterPages) quarterFit = fitQuarterSheets(doc);
    };
    // document.write keeps the frame same-origin with a real URL (srcdoc's
    // about:srcdoc can't resolve the polyfill's relative imports in Safari)
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    (
        win as unknown as { __omBeforePaginate: () => Promise<void> }
    ).__omBeforePaginate = fit;

    const deadline = new Promise<never>((_, reject) =>
        setTimeout(
            () => reject(new Error("Laying out the sheets took too long")),
            timeoutMs,
        ),
    );
    let pages: number | undefined;
    await Promise.race([
        (async () => {
            while (iframe.contentDocument!.readyState !== "complete")
                await new Promise((r) => setTimeout(r, 20));
            if (engine === "pagedjs") {
                // Paged.js calls __omBeforePaginate, then marks the document
                while (
                    iframe.isConnected &&
                    iframe.contentDocument!.documentElement.dataset.paged !==
                        "done"
                )
                    await new Promise((r) => setTimeout(r, 50));
                pages = (win as unknown as { __omPaged?: { pages: number } })
                    .__omPaged?.pages;
            } else {
                await fit();
            }
        })(),
        deadline,
    ]).catch((error: unknown) => {
        iframe.remove();
        throw error;
    });

    const prepared: PreparedPrint = {
        iframe,
        window: win,
        engine,
        pages,
        quarterFit,
        print() {
            // Chrome and Safari name the PDF after the top page's title
            const pageTitle = document.title;
            document.title = title;
            const restore = () => {
                document.title = pageTitle;
            };
            win.addEventListener("afterprint", restore, { once: true });
            win.focus();
            win.print();
            // print() blocks until the dialog closes on desktop; on iPad it
            // returns at once, and afterprint may never come
            setTimeout(restore, 1000);
        },
        remove() {
            iframe.remove();
            if (current === prepared) current = null;
        },
    };
    current = prepared;
    return prepared;
}

/**
 * What the web export dialog calls: lays the sheets out and opens the print
 * dialog. Safari wants `print()` close to a tap, so for a large show the
 * dialog should call `preparePrint` first and `print()` from a second tap
 * ("Print / Save as PDF") once it resolves, as video export does with "Save
 * video".
 */
export async function printSheets(request: PrintSheetsRequest) {
    const prepared = await preparePrint(request);
    prepared.print();
    return prepared;
}
