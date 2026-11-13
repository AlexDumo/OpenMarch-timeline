// cspell:words fulgur fulgur's ironpress dompdf fontkit krilla stylo nosplit asis breakbefore
// Node probe: fulgur header as a running element (logo as inline SVG).
import fs from "node:fs";
import { initSync, Engine } from "../vendor/fulgur/fulgur_wasm_proto.js";
import { buildSheetDocumentHtml } from "../sheetDocument.ts";
import { fulgurCss } from "../engines/fulgurCss.ts";

const here = new URL("..", import.meta.url).pathname;
initSync({ module: fs.readFileSync(`${here}vendor/fulgur/fulgur_wasm_proto_bg.wasm`) });
const out = "/mnt/data/pdf-web-proto/html-wasm/node-probe/run";
fs.mkdirSync(out, { recursive: true });
const fonts = ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map((f) =>
    fs.readFileSync(`${here}public/fonts/${f}`),
);
const logoSvg = fs
    .readFileSync(`${here}../../src/assets/open-march-logo.svg`, "utf8")
    .replace(/currentColor/g, "black")
    .replace(/width="54"\s+height="32"/, 'width="27" height="16"');
const sheets = JSON.parse(
    fs.readFileSync(`/mnt/data/pdf-web-proto/fixtures/sheets-full.json`, "utf8"),
);
const css =
    fulgurCss({
        quarterPages: false,
        showName: "",
        exportedDate: "11/12/2026",
        logoPng: "",
        fontFamily: "DejaVu Sans",
    }) +
    `@page { @top-left { content: none } @top-center { content: element(omh) } }
     .omh { position: running(omh); }`;
const header = `<div class="omh" style="display:flex; align-items:center; width:7.5in; font-size:8px; color:#999"><div style="flex:1">${logoSvg}</div><div style="flex:1;text-align:center;font-weight:bold">Fixture Show 2026</div><div style="flex:1"></div></div>`;
const html = buildSheetDocumentHtml(
    sheets.map((s) => s.renderedPage),
    false,
    css,
).replace("<body>", `<body>${header}`);
const e = new Engine();
for (const f of fonts) e.add_font(new Uint8Array(f));
e.configure({ pageSize: "Letter" });
const pdf = e.render(html);
fs.writeFileSync(`${out}/fulgur-full.pdf`, pdf);
console.log("ok", pdf.length);
