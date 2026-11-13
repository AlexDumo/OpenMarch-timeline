// cspell:words fulgur fulgur's ironpress dompdf fontkit krilla stylo nosplit asis breakbefore
// Node probe: which print-CSS constructs ironpress handles. Prints page counts per variant.
import fs from "node:fs";
import init, { HtmlConverter } from "ironpress/node";
import { buildSheetDocumentHtml, printStyles } from "../sheetDocument.ts";

await init();
const fx = (m) =>
    JSON.parse(fs.readFileSync(`/mnt/data/pdf-web-proto/fixtures/sheets-${m}.json`, "utf8")).map(
        (s) => s.renderedPage,
    );
const full = fx("full");
const out = "/mnt/data/pdf-web-proto/html-wasm/node-probe/variants";
fs.mkdirSync(out, { recursive: true });

function run(name, html) {
    const c = new HtmlConverter();
    c.pageSize("Letter");
    c.marginSides(54, 18, 36, 18);
    const pdf = c.htmlToPdf(html);
    fs.writeFileSync(`${out}/${name}.pdf`, pdf);
    const pages = (new TextDecoder("latin1").decode(pdf).match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    console.log(name.padEnd(28), pages, "pages", pdf.length, "bytes");
}

run("one-sheet-asis", buildSheetDocumentHtml([full[0]], false));
run("one-sheet-bare", `<html><body>${full[0]}</body></html>`);
run(
    "one-sheet-no-media",
    `<html><head><style>${printStyles(false).replace("@media print {", "").replace(/}\s*@page/, "@page")}</style></head><body><div class="marcher-sheet">${full[0]}</div></body></html>`,
);
run("two-sheets-asis", buildSheetDocumentHtml(full.slice(0, 2), false));
run(
    "two-sheets-breakbefore",
    `<html><body>${full
        .slice(0, 2)
        .map((s, i) => `<div style="${i ? "page-break-before:always" : ""}">${s}</div>`)
        .join("")}</body></html>`,
);
run(
    "two-sheets-plain",
    `<html><body>${full.slice(0, 2).map((s) => `<div>${s}</div>`).join("")}</body></html>`,
);
