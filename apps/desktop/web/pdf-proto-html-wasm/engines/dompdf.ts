// cspell:words fulgur fulgur's ironpress dompdf fontkit krilla stylo nosplit asis breakbefore
/**
 * dompdf.js: the browser lays the sheets out in a hidden element (screen
 * layout, so the @media print rules are repeated outside the media query),
 * dompdf.js snapshots the DOM geometry and its WASM writes the PDF.
 * Header/footer stamped afterwards like the other engines.
 */
import dompdf from "dompdf.js";
import { printRulesUnwrapped, printStyles } from "../sheetDocument.ts";
import { mergeAndStamp, type StampOptions } from "./stamp.ts";

function toBase64(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

export async function renderDompdf(
    sheets: string[],
    quarterPages: boolean,
    stamp: StampOptions,
): Promise<Uint8Array> {
    const host = document.createElement("div");
    // Letter (8.5in) minus the 0.5in @page margins.
    host.style.cssText =
        "position:absolute;left:-10000px;top:0;width:7.5in;background:#fff";
    const chunks: string[] = [];
    if (quarterPages) {
        for (let i = 0; i < sheets.length; i += 4)
            chunks.push(
                `<div class="grid-container">${sheets
                    .slice(i, i + 4)
                    .map((s) => `<div class="grid-item">${s}</div>`)
                    .join("")}</div>`,
            );
    } else
        chunks.push(
            ...sheets.map((s) => `<div class="marcher-sheet">${s}</div>`),
        );
    host.innerHTML = `<style>${printStyles(quarterPages)}${printRulesUnwrapped(quarterPages)}
      .om-pdf-host, .om-pdf-host * { font-family: "DejaVu Sans", Arial, sans-serif !important; }</style>${chunks.join("")}`;
    host.className = "om-pdf-host";
    // dompdf.js ignores CSS break-before/after; it takes a `pageBreak`
    // attribute (break before the element) and `divisionDisable` (do not
    // split the element). It cannot repeat <thead>.
    host.querySelectorAll(".marcher-sheet, .grid-container").forEach(
        (el, i) => {
            if (i > 0) el.setAttribute("pageBreak", "");
        },
    );
    host.querySelectorAll("tbody tr, .grid-container").forEach((el) =>
        el.setAttribute("divisionDisable", ""),
    );
    document.body.appendChild(host);
    try {
        await document.fonts?.ready;
        const blob = await dompdf(host, {
            format: "letter",
            pagination: true,
            pageConfig: {}, // no built-in header/footer band (stamped below)
            marginPt: [36, 36, 36, 36],
            backgroundColor: "#ffffff",
            compress: true,
            putOnlyUsedFonts: true,
            fontConfig: [
                {
                    fontFamily: "DejaVu Sans",
                    fontBase64: toBase64(stamp.regularFont),
                    fontWeight: 400,
                    isDefault: true,
                },
                {
                    fontFamily: "DejaVu Sans",
                    fontBase64: toBase64(stamp.boldFont),
                    fontWeight: 700,
                },
            ],
        });
        return mergeAndStamp([new Uint8Array(await blob.arrayBuffer())], stamp);
    } finally {
        host.remove();
    }
}
