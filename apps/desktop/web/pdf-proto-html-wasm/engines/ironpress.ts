// cspell:words fulgur fulgur's ironpress dompdf fontkit krilla stylo nosplit asis breakbefore
/**
 * ironpress (npm `ironpress`, Rust → WebAssembly, own layout engine).
 *
 * ironpress silently drops the rest of a block that spills onto a second page
 * when a forced page break follows it (each marcher sheet ends with
 * `page-break-after: always`), so each marcher (full pages) or each 2x2 grid
 * (quarter pages) is rendered as its own document and the parts are merged.
 * The header/footer are stamped afterwards so "Page X of Y" spans the merge.
 */
import init, { HtmlConverter } from "ironpress";
import wasmUrl from "ironpress/ironpress_bg.wasm?url";
import { buildSheetDocumentHtml } from "../sheetDocument.ts";
import { mergeAndStamp, type StampOptions } from "./stamp.ts";

let ready: Promise<unknown> | null = null;

export async function renderIronpress(
    sheets: string[],
    quarterPages: boolean,
    stamp: StampOptions,
    opts: { split?: boolean } = {},
): Promise<Uint8Array> {
    ready ??= init({ module_or_path: wasmUrl });
    await ready;
    const split = opts.split ?? true;
    const groups: string[][] = [];
    if (!split) groups.push(sheets);
    else {
        const size = quarterPages ? 4 : 1;
        for (let i = 0; i < sheets.length; i += size)
            groups.push(sheets.slice(i, i + size));
    }
    const parts = groups.map((group) => {
        const c = new HtmlConverter();
        try {
            c.pageSize("Letter");
            c.marginSides(36, 36, 36, 36); // the CSS @page margin (0.5in)
            return c.htmlToPdf(buildSheetDocumentHtml(group, quarterPages));
        } finally {
            c.free();
        }
    });
    return mergeAndStamp(parts, stamp);
}
