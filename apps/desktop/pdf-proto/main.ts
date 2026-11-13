// cspell:ignore pdfmake pdfs dont ijlft helv xthrottle Dvořák Émile García Łukasz Nguyễn Núñez Østergaard Šťastný Ελένη Παπαδοπούλου Иванова Ольга محمد
/**
 * Prototype page for the pdfmake coordinate sheet export: loads the app
 * module (src/components/exporting/coordinateSheetPdf) in a real browser.
 * Driven by Playwright (pdf-proto/run.mts); not part of the app.
 */
import {
    makeCoordinateSheetPdfs,
    type CoordinateSheetPdfOptions,
    type SheetModel,
} from "@/components/exporting/coordinateSheetPdf";

async function toBase64(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

/** What the web app would do: download the file (iPad: share sheet first). */
function download(file: File) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

declare global {
    interface Window {
        pdfProto: unknown;
    }
}

window.pdfProto = {
    async make(
        model: SheetModel,
        options: CoordinateSheetPdfOptions,
        { returnBytes = true, triggerDownload = false } = {},
    ) {
        const t0 = performance.now();
        const result = await makeCoordinateSheetPdfs(model, options);
        const ms = performance.now() - t0;
        if (triggerDownload) download(result.file);
        return {
            ms,
            name: result.file.name,
            size: result.file.size,
            pdfs: result.pdfs.map((p) => ({ path: p.path, size: p.blob.size })),
            base64: returnBytes ? await toBase64(result.file) : null,
        };
    },
};

document.getElementById("status")!.textContent = "ready";
