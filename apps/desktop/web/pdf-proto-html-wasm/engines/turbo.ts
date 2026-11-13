// cspell:words fulgur fulgur's ironpress dompdf fontkit krilla stylo nosplit asis breakbefore
/**
 * turbo-html2pdf-wasm: today's document with the print rules passed as css and
 * Letter size; header/footer stamped afterwards like the other engines.
 * (Included for the comparison only: no CSS grid, no <col> widths.)
 */
import init, { compile } from "turbo-html2pdf-wasm";
import wasmUrl from "turbo-html2pdf-wasm/turbo_pdf_wasm_bg.wasm?url";
import {
    buildSheetDocumentHtml,
    printRulesUnwrapped,
} from "../sheetDocument.ts";
import { mergeAndStamp, type StampOptions } from "./stamp.ts";

let ready: Promise<unknown> | null = null;

export async function renderTurbo(
    sheets: string[],
    quarterPages: boolean,
    stamp: StampOptions,
): Promise<Uint8Array> {
    ready ??= init({ module_or_path: wasmUrl });
    await ready;
    const html = buildSheetDocumentHtml(sheets, quarterPages);
    const css = `${printRulesUnwrapped(quarterPages)}
@page { size: letter; margin: 0.5in; }`;
    const res = compile(html, {}).render({
        data: {},
        css,
        fonts: [
            { data: stamp.regularFont, family: "DejaVu Sans" },
            { data: stamp.boldFont, family: "DejaVu Sans", weight: 700 },
        ],
    });
    return mergeAndStamp([res.pdf as Uint8Array], stamp);
}
