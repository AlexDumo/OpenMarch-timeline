/**
 * Prototype page for the Typst PDF export. Playwright drives it through
 * `window.proto`; a person can use the buttons.
 */
import {
    compileTypst,
    exportCoordinateSheets,
    type ExportOptions,
} from "../typstPdf";
import type { SheetModel } from "../sheetData";
import fixture from "/mnt/data/pdf-web-proto/fixtures/sheet-model.json";
import { fieldSvg } from "./fieldSvg";

const model = fixture as unknown as SheetModel;

async function toBase64(blob: Blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

/** The fixture repeated to `count` marchers (drill numbers made unique). */
function scaled(count: number): SheetModel {
    const marchers = Array.from({ length: count }, (_, i) => {
        const m = model.marchers[i % model.marchers.length];
        return {
            ...m,
            drillNumber: `${m.drillNumber}-${Math.floor(i / model.marchers.length) + 1}`,
        };
    });
    return { ...model, marchers };
}

async function exportSheets(
    opts: ExportOptions & { marchers?: number; model?: SheetModel },
) {
    const m = opts.model ?? (opts.marchers ? scaled(opts.marchers) : model);
    const t0 = performance.now();
    const r = await exportCoordinateSheets(m, {
        exportedOn: "11/12/2026",
        ...opts,
    });
    const totalMs = performance.now() - t0;
    return {
        name: r.file.name,
        size: r.file.size,
        pdfCount: r.pdfCount,
        timings: r.timings,
        totalMs,
        base64: await toBase64(r.file),
    };
}

async function chart() {
    const m = model.marchers[0];
    const row = m.rows[0];
    const t0 = performance.now();
    const r = await compileTypst(
        "chart",
        {
            showName: model.showName,
            exportedOn: "11/12/2026",
            marcher: {
                drillNumber: m.drillNumber,
                name: m.displayName,
                section: m.section,
            },
            set: row.set,
            counts: row.counts,
            sideToSide: row.sideToSide,
            frontToBack: row.frontToBack,
            notes: "Set 1 notes: hold for 4 counts",
        },
        { "/field.svg": fieldSvg(model) },
    );
    return {
        ms: performance.now() - t0,
        ...r,
        base64: await toBase64(new Blob([r.pdf as BlobPart])),
        pdf: undefined,
    };
}

declare global {
    interface Window {
        proto: {
            exportSheets: typeof exportSheets;
            chart: typeof chart;
            fixture: SheetModel;
        };
    }
}
window.proto = { exportSheets, chart, fixture: model };

function download(file: Blob, name: string) {
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement("a"), {
        href: url,
        download: name,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const status = document.getElementById("status")!;
document.getElementById("go")!.addEventListener("click", async () => {
    const layout = (
        document.querySelector("input[name=layout]:checked") as HTMLInputElement
    ).value as "full" | "quarter";
    const organizeBySection = (
        document.getElementById("org") as HTMLInputElement
    ).checked;
    status.textContent = "Making the PDF…";
    try {
        const r = await exportCoordinateSheets(model, {
            layout,
            organizeBySection,
        });
        download(r.file, r.file.name);
        status.textContent = `Saved ${r.file.name}`;
    } catch (e) {
        status.textContent = `Could not make the PDF: ${e}`;
    }
});
document.getElementById("chart")!.addEventListener("click", async () => {
    const r = await chart();
    download(
        new Blob([Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))], {
            type: "application/pdf",
        }),
        "chart.pdf",
    );
});
