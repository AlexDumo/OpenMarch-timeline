// cspell:words fulgur fulgur's ironpress dompdf fontkit krilla stylo nosplit asis breakbefore
// Quick Node probe: ironpress on the unchanged fixture HTML (engine behavior only;
// the real runs happen in browsers, see ../run.mts).
import fs from "node:fs";
import init, { HtmlConverter } from "ironpress/node";
import { buildSheetDocumentHtml } from "../sheetDocument.ts";

await init();
const out = process.argv[2] ?? "/mnt/data/pdf-web-proto/html-wasm/node-probe";
const extraCss = process.env.EXTRA_CSS ?? "";
fs.mkdirSync(out, { recursive: true });
for (const mode of ["full", "quarter"]) {
    const sheets = JSON.parse(
        fs.readFileSync(`/mnt/data/pdf-web-proto/fixtures/sheets-${mode}.json`, "utf8"),
    );
    const html = buildSheetDocumentHtml(
        sheets.map((s) => s.renderedPage),
        mode === "quarter",
        extraCss,
    );
    const c = new HtmlConverter();
    c.pageSize("Letter");
    const side = mode === "quarter" ? 0 : 18;
    c.marginSides(54, side, 36, side);
    c.header("Fixture Show 2026");
    c.footer("Page {page} of {pages}");
    const t0 = performance.now();
    const pdf = c.htmlToPdf(html);
    console.log(mode, Math.round(performance.now() - t0), "ms", pdf.length, "bytes");
    fs.writeFileSync(`${out}/ironpress-${mode}.pdf`, pdf);
}
