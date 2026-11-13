// cspell:words fulgur fulgur's ironpress dompdf fontkit krilla stylo nosplit asis breakbefore
// Quick Node probe: turbo-html2pdf-wasm on the fixture HTML.
// VARIANT=asis: the document unchanged. VARIANT=tweak: print rules passed as css,
// running header/footer directives added.
import fs from "node:fs";
import { initSync, compile } from "turbo-html2pdf-wasm";
import { buildSheetDocumentHtml, printRulesUnwrapped } from "../sheetDocument.ts";

const here = new URL("..", import.meta.url).pathname;
const wasmPath = new URL(import.meta.resolve("turbo-html2pdf-wasm")).pathname.replace(
    "turbo_pdf_wasm.js",
    "turbo_pdf_wasm_bg.wasm",
);
initSync({ module: fs.readFileSync(wasmPath) });
const out = process.argv[2] ?? "/mnt/data/pdf-web-proto/html-wasm/node-probe/turbo";
fs.mkdirSync(out, { recursive: true });
const fonts = [
    { data: new Uint8Array(fs.readFileSync(`${here}public/fonts/DejaVuSans.ttf`)), family: "DejaVu Sans" },
    { data: new Uint8Array(fs.readFileSync(`${here}public/fonts/DejaVuSans-Bold.ttf`)), family: "DejaVu Sans", weight: 700 },
];
const variant = process.env.VARIANT ?? "asis";
for (const mode of ["full", "quarter"]) {
    const quarter = mode === "quarter";
    const sheets = JSON.parse(
        fs.readFileSync(`/mnt/data/pdf-web-proto/fixtures/sheets-${mode}.json`, "utf8"),
    );
    let html = buildSheetDocumentHtml(sheets.map((s) => s.renderedPage), quarter);
    let css = "";
    if (variant === "tweak") {
        const side = quarter ? "0" : "0.25in";
        css = `${printRulesUnwrapped(quarter)}
@page { size: letter; margin: 0.75in ${side} 0.5in ${side}; }`;
        html = html.replace(
            "<body>",
            `<body><t:running-header><div style="text-align:center;font-size:8px;font-weight:bold;color:#999">Fixture Show 2026</div></t:running-header>
<t:running-footer><div style="display:flex;font-size:8px;color:#999"><div style="flex:1">Exported 11/12/2026</div><div style="flex:1;text-align:center">Made with OpenMarch</div><div style="flex:1;text-align:right">Page {{ page.number }} of {{ page.total }}</div></div></t:running-footer>`,
        );
    }
    const t0 = performance.now();
    const res = compile(html, {}).render({ data: {}, css, fonts });
    console.log(mode, variant, Math.round(performance.now() - t0), "ms", res.pdf.length, "bytes", res.pageCount, "pages", JSON.stringify(res.diagnostics).slice(0, 400));
    fs.writeFileSync(`${out}/turbo-${variant}-${mode}.pdf`, res.pdf);
}
