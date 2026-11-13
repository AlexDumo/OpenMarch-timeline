/**
 * Loaded only when drill charts are exported (see ./drillChartExport.ts):
 * PDFKit's browser build (with its fonts), svg-to-pdfkit and sanitize-html
 * are about 540 KB gzipped, too much for the editor's first load. (JSZip is
 * already in the app, for MusicXML.)
 */
import JSZip from "jszip";
import {
    drillChartPdfFileName,
    fieldImageDataUri,
    renderDrillChartPdf,
} from "../../src/components/exporting/utils/drillChartPdf";
import { getFieldPropertiesImage } from "../../src/components/exporting/utils/svg-generator";

export { drillChartPdfFileName, renderDrillChartPdf };

/** The show's field image as a data URI, read from the show in the renderer. */
export async function loadFieldImageDataUri(): Promise<string | null> {
    return fieldImageDataUri(await getFieldPropertiesImage());
}

/** One zip of `files`. PDFs are already compressed, so they're stored as they are. */
export async function zipFiles(files: File[], name: string): Promise<File> {
    const zip = new JSZip();
    for (const file of files) zip.file(file.name, file);
    const blob = await zip.generateAsync({
        type: "blob",
        compression: "STORE",
        mimeType: "application/zip",
    });
    return new File([blob], name, { type: "application/zip" });
}
