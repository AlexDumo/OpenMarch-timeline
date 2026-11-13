import { describe, expect, it } from "vitest";
import {
    buildBrowserPrintDocumentHtml,
    buildSheetDocumentHtml,
    cssString,
    logoDataUri,
} from "../sheetDocument";

const LOGO = `<svg width="54" height="32" viewBox="0 0 54 32" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M0 0h54v32H0z"/></svg>`;

const base = {
    sheets: [
        "<p>one</p>",
        "<p>two</p>",
        "<p>three</p>",
        "<p>four</p>",
        "<p>five</p>",
    ],
    quarterPages: false,
    showName: "Fall Show",
    logoSvg: LOGO,
    exportedOn: "11/12/2026",
    title: "Fall Show - coordinate sheets - 2026-11-12",
    engine: "native" as const,
};

describe("cssString", () => {
    it("quotes and escapes text for a CSS content string", () => {
        expect(cssString(`a "b" \\ c`)).toBe(`"a \\"b\\" \\\\ c"`);
    });
    it("cannot end the style element", () => {
        expect(cssString("x</style><script>")).not.toContain("<");
    });
    it("folds line breaks", () => {
        expect(cssString("a\nb")).toBe(`"a b"`);
    });
});

describe("logoDataUri", () => {
    it("sizes the SVG by height and keeps the aspect ratio", () => {
        const svg = decodeURIComponent(logoDataUri(LOGO, 16).split(",")[1]);
        expect(svg).toContain('width="27.00" height="16"');
        expect(svg).not.toContain('width="54"');
        expect(svg).not.toContain("currentColor");
    });
});

describe("buildSheetDocumentHtml (desktop)", () => {
    it("puts each sheet on its own page, or four to a grid", () => {
        expect(
            buildSheetDocumentHtml(base.sheets, false).match(
                /class="marcher-sheet"/g,
            ),
        ).toHaveLength(5);
        expect(
            buildSheetDocumentHtml(base.sheets, true).match(
                /class="grid-container"/g,
            ),
        ).toHaveLength(2);
    });
});

describe("buildBrowserPrintDocumentHtml", () => {
    it("draws the header and footer with page margin boxes", () => {
        const html = buildBrowserPrintDocumentHtml(base);
        expect(html).toContain("@top-left");
        expect(html).toContain('content: "Fall Show"');
        expect(html).toContain('content: "Exported 11/12/2026"');
        expect(html).toContain('"Page " counter(page) " of " counter(pages)');
        expect(html).toContain("Made with OpenMarch");
        expect(html).toContain(
            "<title>Fall Show - coordinate sheets - 2026-11-12</title>",
        );
        expect(html).not.toContain("<script");
    });

    it("keeps the sheet HTML as rendered (already escaped by React)", () => {
        const html = buildBrowserPrintDocumentHtml({
            ...base,
            sheets: ["<h4>Gus &lt;Tag&gt; &amp; Co</h4>"],
        });
        expect(html).toContain("<h4>Gus &lt;Tag&gt; &amp; Co</h4>");
    });

    it("escapes the show name in the title and the header", () => {
        const html = buildBrowserPrintDocumentHtml({
            ...base,
            showName: `Gus <Tag> & "Co"`,
            title: `Gus <Tag> & "Co"`,
        });
        expect(html).toContain(
            "<title>Gus &lt;Tag&gt; &amp; &quot;Co&quot;</title>",
        );
        expect(html).toContain(`content: "Gus \\3C Tag> & \\"Co\\""`);
    });

    it("wraps quarter sheets for fitting", () => {
        const html = buildBrowserPrintDocumentHtml({
            ...base,
            quarterPages: true,
        });
        expect(html.match(/class="grid-item"><div class="fit">/g)).toHaveLength(
            5,
        );
        expect(html.match(/class="grid-container"/g)).toHaveLength(2);
    });

    it("loads Paged.js only for the pagedjs engine", () => {
        const html = buildBrowserPrintDocumentHtml({
            ...base,
            engine: "pagedjs",
            pagedPolyfillUrl: "https://example.test/paged.polyfill.min.js",
        });
        expect(html).toContain(
            '<script src="https://example.test/paged.polyfill.min.js"></script>',
        );
        expect(html).toContain("Paged.registerHandlers");
    });
});
