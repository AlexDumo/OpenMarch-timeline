/**
 * Coordinate-sheet PDFs in the browser: the Typst template
 * (coordinate-sheets.typ) compiled by the Typst compiler running as
 * WebAssembly in a worker (typst.worker.ts). Nothing here touches the DOM, so
 * the same calls work on desktop browsers and iPad Safari.
 */
import JSZip from "jszip";
import type { CompileRequest, CompileResponse } from "./typst.worker";
import {
    toTemplateData,
    type Layout,
    type SheetMarcher,
    type SheetModel,
} from "./sheetData";

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, (r: CompileResponse) => void>();

function getWorker() {
    if (!worker) {
        worker = new Worker(new URL("./typst.worker.ts", import.meta.url), {
            type: "module",
        });
        worker.onmessage = (e: MessageEvent<CompileResponse>) => {
            pending.get(e.data.id)?.(e.data);
            pending.delete(e.data.id);
        };
    }
    return worker;
}

/** Ends the worker and frees the compiler's memory (about 100+ MB). */
export function disposeTypstWorker() {
    worker?.terminate();
    worker = undefined;
}

export type CompileTiming = { initMs: number; compileMs: number };

export function compileTypst(
    template: CompileRequest["template"],
    data: unknown,
    files?: Record<string, string>,
): Promise<{ pdf: Uint8Array } & CompileTiming> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, (r) =>
            r.ok ? resolve(r) : reject(new Error(r.error)),
        );
        getWorker().postMessage({
            id,
            template,
            data,
            files,
        } satisfies CompileRequest);
    });
}

/** Keeps a name usable as a file or folder name on every system. */
export function safeFileName(name: string) {
    return (
        name
            .replace(/[\\/:*?"<>|]+/g, "_")
            .replace(/^\.+/, "_")
            .trim()
            .slice(0, 120) || "Untitled"
    );
}

function bySection(marchers: SheetMarcher[]) {
    const sections = new Map<string, SheetMarcher[]>();
    for (const m of marchers) {
        const key = m.section || "No section";
        sections.set(key, [...(sections.get(key) ?? []), m]);
    }
    return sections;
}

const pdfFile = (bytes: Uint8Array, name: string) =>
    new File([bytes as BlobPart], name, { type: "application/pdf" });

export type ExportOptions = {
    layout: Layout;
    /**
     * Full pages: one PDF per marcher, in a folder per section.
     * Quarter pages: one PDF per section. Either way, zipped.
     */
    organizeBySection: boolean;
    exportedOn?: string;
};

export type ExportResult = {
    file: File;
    pdfCount: number;
    timings: CompileTiming[];
};

export async function exportCoordinateSheets(
    model: SheetModel,
    opts: ExportOptions,
): Promise<ExportResult> {
    const base = safeFileName(model.showName);
    const kind =
        opts.layout === "quarter" ? "quarter-sheets" : "coordinate-sheets";
    const timings: CompileTiming[] = [];
    const compile = async (marchers: SheetMarcher[]) => {
        const r = await compileTypst(
            "sheets",
            toTemplateData(model, opts.layout, marchers, opts.exportedOn),
        );
        timings.push({ initMs: r.initMs, compileMs: r.compileMs });
        return r.pdf;
    };

    if (!opts.organizeBySection) {
        const pdf = await compile(model.marchers);
        return {
            file: pdfFile(pdf, `${base} ${kind}.pdf`),
            pdfCount: 1,
            timings,
        };
    }

    const zip = new JSZip();
    let pdfCount = 0;
    for (const [section, marchers] of bySection(model.marchers)) {
        if (opts.layout === "quarter") {
            zip.file(`${safeFileName(section)}.pdf`, await compile(marchers));
            pdfCount++;
        } else {
            const folder = zip.folder(safeFileName(section))!;
            for (const m of marchers) {
                const name = safeFileName(
                    `${m.drillNumber} ${m.displayName || m.name}`,
                );
                folder.file(`${name}.pdf`, await compile([m]));
                pdfCount++;
            }
        }
    }
    // Typst's PDFs carry accessibility tags as plain objects, which deflate well.
    const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
    });
    return {
        file: new File([blob], `${base} ${kind}.zip`, {
            type: "application/zip",
        }),
        pdfCount,
        timings,
    };
}
