// cspell:words fulgur fulgur's ironpress dompdf fontkit krilla stylo nosplit asis breakbefore
// Quick Node probe: fulgur (self-built WASM) on the unchanged fixture HTML.
import fs from "node:fs";
import { initSync, Engine } from "../vendor/fulgur/fulgur_wasm_proto.js";
import { buildSheetDocumentHtml } from "../sheetDocument.ts";

const here = new URL("..", import.meta.url).pathname;
initSync({ module: fs.readFileSync(`${here}vendor/fulgur/fulgur_wasm_proto_bg.wasm`) });
const out = process.argv[2] ?? "/mnt/data/pdf-web-proto/html-wasm/node-probe/fulgur";
const extraCss = process.env.EXTRA_CSS ?? "";
fs.mkdirSync(out, { recursive: true });
const fonts = ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map((f) =>
    fs.readFileSync(`${here}public/fonts/${f}`),
);
for (const mode of ["full", "quarter"]) {
    const sheets = JSON.parse(
        fs.readFileSync(`/mnt/data/pdf-web-proto/fixtures/sheets-${mode}.json`, "utf8"),
    );
    const html = buildSheetDocumentHtml(
        sheets.map((s) => s.renderedPage),
        mode === "quarter",
        extraCss,
    );
    const e = new Engine();
    for (const f of fonts) e.add_font(new Uint8Array(f));
    e.configure({ pageSize: "Letter" });
    const t0 = performance.now();
    const pdf = e.render(html);
    console.log(mode, Math.round(performance.now() - t0), "ms", pdf.length, "bytes");
    fs.writeFileSync(`${out}/fulgur-${mode}.pdf`, pdf);
}
