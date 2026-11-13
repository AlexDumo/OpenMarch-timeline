// cspell:words fulgur fulgur's ironpress dompdf fontkit krilla stylo nosplit asis breakbefore
// Node probe: fulgur with print rules unwrapped, font family mapped, table
// border workaround, and header/footer drawn as CSS @page margin boxes.
import fs from "node:fs";
import { initSync, Engine } from "../vendor/fulgur/fulgur_wasm_proto.js";
import { buildSheetDocumentHtml } from "../sheetDocument.ts";
import { fulgurCss } from "../engines/fulgurCss.ts";
import { colWidthsToHeaderCells } from "../engines/colWidths.ts";

const here = new URL("..", import.meta.url).pathname;
initSync({ module: fs.readFileSync(`${here}vendor/fulgur/fulgur_wasm_proto_bg.wasm`) });
const out = process.argv[2] ?? "/mnt/data/pdf-web-proto/html-wasm/node-probe/fulgur2";
fs.mkdirSync(out, { recursive: true });
const fonts = ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map((f) =>
    fs.readFileSync(`${here}public/fonts/${f}`),
);
const logoPng = `data:image/png;base64,${fs.readFileSync("/mnt/data/pdf-web-proto/html-wasm/logo.png").toString("base64")}`;
for (const mode of ["full", "quarter"]) {
    const quarter = mode === "quarter";
    const sheets = JSON.parse(
        fs.readFileSync(`/mnt/data/pdf-web-proto/fixtures/sheets-${mode}.json`, "utf8"),
    );
    const css = fulgurCss({
        quarterPages: quarter,
        showName: "Fixture Show 2026",
        exportedDate: "11/12/2026",
        logoPng,
        fontFamily: "DejaVu Sans",
    });
    const html = buildSheetDocumentHtml(sheets.map((s) => colWidthsToHeaderCells(s.renderedPage)), quarter, css + (process.env.EXTRA_CSS ?? ""));
    const e = new Engine();
    for (const f of fonts) e.add_font(new Uint8Array(f));
    e.configure({ pageSize: "Letter" });
    const t0 = performance.now();
    const pdf = e.render(html);
    console.log(mode, Math.round(performance.now() - t0), "ms", pdf.length, "bytes");
    fs.writeFileSync(`${out}/fulgur-${mode}.pdf`, pdf);
}
