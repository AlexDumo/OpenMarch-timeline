// @vitest-environment node
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
    drillChartPdfFileName,
    fieldImageDataUri,
    renderDrillChartPdf,
    type DrillChartPdfArgs,
} from "../drillChartPdf";

const PLACEHOLDER = "OPENMARCH_FIELD_IMAGE_PLACEHOLDER";

// A 1x1 PNG
const PNG = Uint8Array.from(
    Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
    ),
);

const svg = (withImage: boolean) =>
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="100" viewBox="0 0 200 100">` +
    (withImage
        ? `<image x="0" y="0" width="200" height="100" xlink:href="${PLACEHOLDER}"/>`
        : "") +
    `<rect x="10" y="10" width="20" height="20" fill="red"/>` +
    `<text x="40" y="50" font-size="12">T1</text></svg>`;

const page = (name: string, notes: string | null = null) => ({
    name,
    counts: 8,
    notes,
    measures: [
        { number: 1, counts: 4 },
        { number: 2, counts: 4 },
    ],
    measureBeatToStartOn: 1,
    measureBeatToEndOn: 4,
});

const args = (
    overrides: Partial<DrillChartPdfArgs> = {},
): DrillChartPdfArgs => ({
    svgPages: [svg(true), svg(true)],
    drillNumber: "T1",
    marcherCoordinates: ["Prev coord", "Here coord"],
    pages: [page("0"), page("1", "<p><strong>Big</strong> hit</p>")],
    showName: "Fall Show",
    individualCharts: true,
    exportedOn: new Date(2026, 0, 15),
    ...overrides,
});

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

/** The page objects in the PDF (their dictionaries aren't compressed). */
const pageCount = (pdf: Uint8Array) =>
    latin1(pdf).match(/\/Type \/Page\b/g)?.length ?? 0;

/** The text PDFKit drew: hex strings in the inflated content streams. */
function drawnText(pdf: Uint8Array): string {
    const raw = latin1(pdf);
    const text: string[] = [];
    const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    for (let match; (match = streams.exec(raw)); ) {
        let content: string;
        try {
            content = inflateSync(Buffer.from(match[1], "latin1")).toString(
                "latin1",
            );
        } catch {
            continue;
        }
        for (const array of content.matchAll(/\[([^\]]*)\] TJ/g)) {
            const parts = [...array[1].matchAll(/<([0-9a-f]*)>/gi)].map(
                ([, hex]) => Buffer.from(hex, "hex").toString("latin1"),
            );
            text.push(parts.join(""));
        }
    }
    return text.join("\n");
}

describe("renderDrillChartPdf", () => {
    it("draws a landscape Letter PDF with a page per SVG", async () => {
        const pdf = await renderDrillChartPdf(args());

        expect(latin1(pdf.subarray(0, 5))).toBe("%PDF-");
        expect(latin1(pdf.subarray(-6)).trim()).toBe("%%EOF");
        expect(pageCount(pdf)).toBe(2);
        expect(latin1(pdf)).toContain("/MediaBox [0 0 792 612]");
    });

    it("writes the title bar, details, notes and footer", async () => {
        const text = drawnText(await renderDrillChartPdf(args()));

        for (const expected of [
            "T1",
            "Fall Show",
            "Set: 1",
            "Counts:",
            "Measures:",
            "1 - 2",
            "Previous Coordinate:",
            "Prev coord",
            "Current Coordinate:",
            "Here coord",
            "Big",
            `Exported ${new Date(2026, 0, 15).toLocaleDateString()}`,
            "Made with OpenMarch",
            "Page 1 of 2",
            "Page 2 of 2",
        ])
            expect(text).toContain(expected);
    });

    it("leaves out coordinates on the overview chart", async () => {
        const text = drawnText(
            await renderDrillChartPdf(
                args({ drillNumber: "MAIN", individualCharts: false }),
            ),
        );

        expect(text).toContain("MAIN");
        expect(text).not.toContain("Current Coordinate:");
    });

    it("adds a notes appendix page, counted in the footer", async () => {
        const pdf = await renderDrillChartPdf(
            args({
                notesAppendixPages: [
                    { pageName: "1", notes: "<p>Horns up on 4</p>" },
                    { pageName: "2", notes: "   " },
                ],
            }),
        );
        const text = drawnText(pdf);

        // Notes that are only spaces get no page
        expect(pageCount(pdf)).toBe(3);
        expect(text).toContain("Set 1");
        expect(text).toContain("Horns up on 4");
        expect(text).toContain("Page 3 of 3");
    });

    it("puts the field image in place of the placeholder", async () => {
        const withImage = await renderDrillChartPdf(
            args({ fieldImageDataUri: fieldImageDataUri(PNG) }),
        );
        const onePage = await renderDrillChartPdf(
            args({
                svgPages: [svg(true)],
                fieldImageDataUri: fieldImageDataUri(PNG),
            }),
        );
        const withoutImage = await renderDrillChartPdf(
            args({ svgPages: [svg(false), svg(false)] }),
        );
        const images = (pdf: Uint8Array) =>
            latin1(pdf).match(/\/Subtype \/Image/g)?.length ?? 0;

        expect(images(withImage)).toBeGreaterThan(0);
        // Embedded once, however many pages use it
        expect(images(withImage)).toBe(images(onePage));
        expect(images(withoutImage)).toBe(0);
    });

    it("draws a page whose SVG can't be read, with the details", async () => {
        const pdf = await renderDrillChartPdf(
            args({ svgPages: ["not an svg", svg(false)] }),
        );

        expect(pageCount(pdf)).toBe(2);
        expect(drawnText(pdf)).toContain("Set: 0");
    });
});

describe("fieldImageDataUri", () => {
    it("is null without an image", () => {
        expect(fieldImageDataUri(null)).toBeNull();
        expect(fieldImageDataUri(new Uint8Array())).toBeNull();
    });

    it("encodes large images like Node's base64", () => {
        const image = Uint8Array.from({ length: 100_000 }, (_, i) => i % 251);
        expect(fieldImageDataUri(image)).toBe(
            `data:image/png;base64,${Buffer.from(image).toString("base64")}`,
        );
    });
});

describe("drillChartPdfFileName", () => {
    it("names the file after the show and drill number", () => {
        expect(drillChartPdfFileName("Fall Show", "T1")).toBe(
            "Fall Show-T1.pdf",
        );
    });

    it("drops characters file systems reject", () => {
        expect(drillChartPdfFileName("A/B: <Show>?", "T1")).toBe(
            "AB Show-T1.pdf",
        );
    });
});
