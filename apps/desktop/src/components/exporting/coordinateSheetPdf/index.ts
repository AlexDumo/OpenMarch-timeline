// cspell:ignore pdfmake pdfs dont ijlft helv xthrottle Dvořák Émile García Łukasz Nguyễn Núñez Østergaard Šťastný Ελένη Παπαδοπούλου Иванова Ольга محمد
/**
 * Coordinate sheet PDFs made in the page with pdfmake, from data
 * (./model.ts), for the web editor (and, possibly, desktop).
 *
 * pdfmake and its fonts load only when an export starts (dynamic import), so
 * they cost nothing until someone exports.
 *
 *   const result = await makeCoordinateSheetPdfs(model, { ... });
 *   // result.file: one PDF, or a zip when organizing by section
 */
import logoSvgRaw from "@/assets/open-march-logo.svg?raw";
import {
    fullDocument,
    quarterDocument,
    type DocDefinition,
    type SheetFont,
} from "./docDefinition";
import {
    ENGLISH_LABELS,
    type SheetLabels,
    type SheetModel,
    type SheetOptions,
} from "./model";

export type { SheetModel, SheetMarcher, SheetRow } from "./model";
export type { SheetFont } from "./docDefinition";

export interface CoordinateSheetPdfOptions extends SheetOptions {
    quarterPages: boolean;
    organizeBySection: boolean;
    /**
     * "auto" (default): Helvetica, a standard PDF font with nothing to
     * download, unless some text has characters it cannot show (it covers
     * Western European letters only), then Roboto.
     */
    font?: SheetFont | "auto";
    labels?: SheetLabels;
    /** File name stem, e.g. the show's file name */
    baseName?: string;
    /** For tests: a fixed export date */
    now?: Date;
}

export interface ExportedFile {
    /** Path inside the zip (or the file name when there is one file) */
    path: string;
    blob: Blob;
}

export interface CoordinateSheetPdfResult {
    /** The font used */
    font: SheetFont;
    /** Every PDF made */
    pdfs: ExportedFile[];
    /** What to hand the user: the one PDF, or a zip of them all */
    file: File;
}

/** The logo for pdfmake: no fixed size (we size it), black instead of currentColor. */
export const logoSvg = (() => {
    const rootTagEnd = logoSvgRaw.indexOf(">");
    const rootTag = logoSvgRaw
        .slice(0, rootTagEnd)
        .replace(/\s(width|height)="[^"]*"/g, "");
    return (rootTag + logoSvgRaw.slice(rootTagEnd))
        .replace(/currentColor/g, "#000000")
        .replace(/\sclipPath="[^"]*"/g, "");
})();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfMake = any;

const loaded = new Map<SheetFont, Promise<PdfMake>>();

/** Loads pdfmake and one font family, once. */
export function loadPdfMake(font: SheetFont): Promise<PdfMake> {
    let promise = loaded.get(font);
    if (!promise) {
        promise = (async () => {
            const mod = await import("pdfmake/build/pdfmake");
            const pdfMake = mod.default ?? mod;
            const fonts =
                font === "Roboto"
                    ? await import("pdfmake/build/fonts/Roboto")
                    : await import("pdfmake/build/standard-fonts/Helvetica");
            pdfMake.addFontContainer(fonts.default ?? fonts);
            // Sheets never fetch anything
            pdfMake.setUrlAccessPolicy?.(() => false);
            return pdfMake;
        })();
        promise.catch(() => loaded.delete(font));
        loaded.set(font, promise);
    }
    return promise;
}

/** Renders a document definition to PDF bytes. */
export async function renderPdf(
    doc: DocDefinition,
    font: SheetFont,
): Promise<Blob> {
    const pdfMake = await loadPdfMake(font);
    return pdfMake.createPdf(doc).getBlob();
}

/**
 * Characters the standard fonts can show (Windows-1252): ASCII, Latin-1 and
 * a few extras such as € Š Ž Œ “ ” – —.
 */
const WIN_ANSI_EXTRAS = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function fitsStandardFont(text: string): boolean {
    for (const ch of text) {
        const c = ch.codePointAt(0)!;
        if (c === 0x0a || c === 0x09) continue;
        if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) continue;
        if (WIN_ANSI_EXTRAS.includes(ch)) continue;
        return false;
    }
    return true;
}

/** Helvetica when every string fits it, otherwise Roboto. */
export function pickFont(model: SheetModel, labels: SheetLabels): SheetFont {
    const texts = [
        model.showName,
        ...Object.values(labels.columns),
        labels.madeWith,
        labels.quarterPage(1),
        labels.exported(new Date().toLocaleDateString()),
        ...model.marchers.flatMap((m) => [
            m.displayName,
            m.drillNumber,
            m.section,
            ...m.rows.flatMap((r) => [
                r.set,
                r.measures,
                r.sideToSide,
                r.frontToBack,
                r.sideToSideTerse ?? "",
                r.frontToBackTerse ?? "",
            ]),
        ]),
    ];
    return texts.every(fitsStandardFont) ? "Helvetica" : "Roboto";
}

const sanitize = (name: string) =>
    name
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
        .replace(/\s+/g, " ")
        .trim() || "untitled";

function groupBySection<T extends { section: string }>(items: T[]) {
    const map = new Map<string, T[]>();
    for (const item of items) {
        const key = item.section || "Other";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(item);
    }
    return map;
}

/**
 * Makes the coordinate sheet PDF(s): one combined PDF, or with
 * `organizeBySection`, one PDF per marcher in section folders (full pages)
 * or one PDF per section (quarter pages), zipped.
 */
export async function makeCoordinateSheetPdfs(
    model: SheetModel,
    options: CoordinateSheetPdfOptions,
): Promise<CoordinateSheetPdfResult> {
    const labels = options.labels ?? ENGLISH_LABELS;
    const font =
        !options.font || options.font === "auto"
            ? pickFont(model, labels)
            : options.font;
    const now = options.now ?? new Date();
    const date = now.toISOString().split("T")[0];
    const base = sanitize(options.baseName || model.showName || "untitled");
    const buildOpts = {
        includeMeasures: options.includeMeasures,
        terse: options.terse,
        useXY: options.useXY,
        labels,
        logoSvg,
        font,
        exportedDate: now.toLocaleDateString(),
    };
    const build = (m: SheetModel) =>
        options.quarterPages
            ? quarterDocument(m, buildOpts)
            : fullDocument(m, buildOpts);

    if (!options.organizeBySection) {
        const blob = await renderPdf(build(model), font);
        const name = `${base}-${date}.pdf`;
        return {
            font,
            pdfs: [{ path: name, blob }],
            file: new File([blob], name, { type: "application/pdf" }),
        };
    }

    const pdfs: ExportedFile[] = [];
    for (const [section, marchers] of groupBySection(model.marchers)) {
        if (options.quarterPages) {
            pdfs.push({
                path: sanitize(`${base}-${date}-${section}`) + ".pdf",
                blob: await renderPdf(build({ ...model, marchers }), font),
            });
        } else {
            for (const marcher of marchers) {
                const name = marcher.displayName || marcher.name;
                const stem = `${base}-${date}-${marcher.drillNumber}${
                    name ? " - " + name : ""
                }`;
                pdfs.push({
                    path: `${sanitize(section)}/${sanitize(stem)}.pdf`,
                    blob: await renderPdf(
                        build({ ...model, marchers: [marcher] }),
                        font,
                    ),
                });
            }
        }
    }
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const pdf of pdfs) zip.file(pdf.path, pdf.blob);
    const zipBlob = await zip.generateAsync({
        type: "blob",
        // PDFs are already compressed
        compression: "STORE",
    });
    const name = `${base}-${date}-coordinate-sheets.zip`;
    return {
        font,
        pdfs,
        file: new File([zipBlob], name, { type: "application/zip" }),
    };
}
