// cspell:words fulgur fulgur's ironpress dompdf fontkit krilla stylo nosplit asis breakbefore
/**
 * fulgur (Blitz/Stylo layout + Krilla PDF), built to WebAssembly from the
 * published `fulgur` 0.41.0 crate (upstream's fulgur-wasm bindings are not on
 * npm). Renders today's sheet document with a few CSS additions, then the
 * header/footer are stamped with pdf-lib.
 */
import init, { Engine } from "../vendor/fulgur/fulgur_wasm_proto.js";
import wasmUrl from "../vendor/fulgur/fulgur_wasm_proto_bg.wasm?url";
import { buildSheetDocumentHtml } from "../sheetDocument.ts";
import { colWidthsToHeaderCells } from "./colWidths.ts";
import { fulgurCss } from "./fulgurCss.ts";
import { mergeAndStamp, type StampOptions } from "./stamp.ts";

let ready: Promise<unknown> | null = null;

export async function renderFulgur(
    sheets: string[],
    quarterPages: boolean,
    stamp: StampOptions,
): Promise<Uint8Array> {
    ready ??= init({ module_or_path: wasmUrl });
    await ready;
    const engine = new Engine();
    try {
        engine.add_font(stamp.regularFont);
        engine.add_font(stamp.boldFont);
        engine.configure({
            pageSize: "Letter",
            title: stamp.showName,
            creator: "OpenMarch",
        });
        const css = fulgurCss({
            quarterPages,
            fontFamily: "DejaVu Sans",
        });
        const html = buildSheetDocumentHtml(
            sheets.map(colWidthsToHeaderCells),
            quarterPages,
            css,
        );
        const t0 = performance.now();
        const body = engine.render(html);
        const t1 = performance.now();
        const out = await mergeAndStamp([body], stamp);
        (globalThis as { __timings?: object }).__timings = {
            layoutMs: Math.round(t1 - t0),
            stampMs: Math.round(performance.now() - t1),
        };
        return out;
    } finally {
        engine.free();
    }
}
