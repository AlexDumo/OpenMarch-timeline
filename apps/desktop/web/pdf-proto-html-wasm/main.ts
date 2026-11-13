// cspell:words fulgur fulgur's ironpress dompdf fontkit krilla stylo nosplit asis breakbefore
/**
 * Prototype page: HTML → PDF in the browser with WebAssembly engines.
 * Each engine module is loaded only when it is used (dynamic import), as an
 * export would load it in the app.
 */
import logoSvg from "../../src/assets/open-march-logo.svg?raw";
import type { ExportSheet } from "./sheetDocument.ts";
import type { StampOptions } from "./engines/stamp.ts";
const regularUrl = "./fonts/DejaVuSans.ttf";
const boldUrl = "./fonts/DejaVuSans-Bold.ttf";

export type EngineName =
    | "fulgur"
    | "ironpress"
    | "ironpress-nosplit"
    | "turbo"
    | "dompdf";

let fonts: Promise<[Uint8Array, Uint8Array]> | null = null;
const loadFonts = () =>
    (fonts ??= Promise.all(
        [regularUrl, boldUrl].map(
            async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer()),
        ),
    ) as Promise<[Uint8Array, Uint8Array]>);

async function engine(name: EngineName) {
    switch (name) {
        case "fulgur":
            return (await import("./engines/fulgur.ts")).renderFulgur;
        case "ironpress":
            return (await import("./engines/ironpress.ts")).renderIronpress;
        case "ironpress-nosplit": {
            const { renderIronpress } = await import("./engines/ironpress.ts");
            return (s: string[], q: boolean, st: StampOptions) =>
                renderIronpress(s, q, st, { split: false });
        }
        case "turbo":
            return (await import("./engines/turbo.ts")).renderTurbo;
        case "dompdf":
            return (await import("./engines/dompdf.ts")).renderDompdf;
    }
}

export async function makePdf(
    name: EngineName,
    sheets: string[],
    quarterPages: boolean,
    showName: string,
): Promise<Uint8Array> {
    const [render, [regularFont, boldFont]] = await Promise.all([
        engine(name),
        loadFonts(),
    ]);
    return render(sheets, quarterPages, {
        showName,
        exportedDate: new Date().toLocaleDateString(),
        logoSvg,
        regularFont,
        boldFont,
    });
}

/** Same grouping and names as PDFExportService.generateSeparatePDFs, into a zip. */
export async function makeZipBySection(
    name: EngineName,
    sheets: ExportSheet[],
    quarterPages: boolean,
    showName: string,
): Promise<Uint8Array> {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const date = new Date().toISOString().split("T")[0];
    const bySection = new Map<string, ExportSheet[]>();
    for (const s of sheets) {
        const sec = s.section || "Other";
        if (!bySection.has(sec)) bySection.set(sec, []);
        bySection.get(sec)!.push(s);
    }
    const safe = (n: string) => n.replace(/[/\\?%*:|"<>]/g, "_");
    for (const [section, list] of bySection) {
        if (quarterPages) {
            const pdf = await makePdf(
                name,
                list.map((s) => s.renderedPage),
                true,
                showName,
            );
            zip.file(safe(`${showName}-${date}-${section}.pdf`), pdf);
        } else {
            for (const s of list) {
                const pdf = await makePdf(
                    name,
                    [s.renderedPage],
                    false,
                    showName,
                );
                const file = `${showName}-${date}-${s.drillNumber}${s.name ? " - " + s.name : ""}`;
                zip.file(`${safe(section)}/${safe(file)}.pdf`, pdf);
            }
        }
    }
    return zip.generateAsync({ type: "uint8array" });
}

function toBase64(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

declare global {
    interface Window {
        pdfProto: unknown;
    }
}

/** Entry points for the Playwright driver (run.mts). */
window.pdfProto = {
    async run(
        name: EngineName,
        sheets: string[],
        quarterPages: boolean,
        showName: string,
    ) {
        const t0 = performance.now();
        const pdf = await makePdf(name, sheets, quarterPages, showName);
        const ms = performance.now() - t0;
        const mem = (
            performance as unknown as { memory?: { usedJSHeapSize: number } }
        ).memory;
        return {
            b64: toBase64(pdf),
            ms,
            heap: mem?.usedJSHeapSize ?? null,
            timings: (globalThis as { __timings?: object }).__timings ?? null,
        };
    },
    async zip(
        name: EngineName,
        sheets: ExportSheet[],
        quarterPages: boolean,
        showName: string,
    ) {
        const t0 = performance.now();
        const z = await makeZipBySection(name, sheets, quarterPages, showName);
        return { b64: toBase64(z), ms: performance.now() - t0 };
    },
};

// Minimal user flow: pick an engine, export the fixture, get a download.
const button = document.querySelector<HTMLButtonElement>("#export");
button?.addEventListener("click", async () => {
    const name = document.querySelector<HTMLSelectElement>("#engine")!
        .value as EngineName;
    const quarter =
        document.querySelector<HTMLInputElement>("#quarter")!.checked;
    const status = document.querySelector("#status")!;
    status.textContent = "Making the PDF…";
    const res = await fetch(
        `./fixtures/sheets-${quarter ? "quarter" : "full"}.json`,
    );
    const sheets: ExportSheet[] = await res.json();
    const pdf = await makePdf(
        name,
        sheets.map((s) => s.renderedPage),
        quarter,
        "Fixture Show 2026",
    );
    const file = new File([pdf], "coordinate-sheets.pdf", {
        type: "application/pdf",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    status.textContent = "Done.";
});
