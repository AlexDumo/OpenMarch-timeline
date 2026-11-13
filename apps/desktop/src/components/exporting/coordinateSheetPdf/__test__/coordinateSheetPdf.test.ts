// cspell:ignore pdfmake pdfs dont ijlft helv xthrottle Dvořák Émile García Łukasz Nguyễn Núñez Østergaard Šťastný Ελένη Παπαδοπούλου Иванова Ольга محمد
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
    fullDocument,
    quarterDocument,
    quarterFitDocument,
    quarterItems,
    estimateLines,
    type BuildOptions,
} from "../docDefinition";
import { ENGLISH_LABELS, type SheetMarcher, type SheetModel } from "../model";
import {
    fitsStandardFont,
    logoSvg,
    makeCoordinateSheetPdfs,
    pickFont,
    renderPdf,
} from "..";

const opts: BuildOptions = {
    includeMeasures: true,
    terse: false,
    useXY: false,
    labels: ENGLISH_LABELS,
    logoSvg,
    font: "Helvetica",
    exportedDate: "11/12/2026",
};

const sideTexts = [
    "S1: 0.25 inside 30 yard line",
    "S2: 2.75 outside 45 yard line",
    "S1: On 40 yard line",
];
const frontTexts = [
    "14.25 in front of grid back sideline",
    "9.5 behind grid NCAA back hash",
    "16 behind front sideline",
];

function marcher(
    name: string,
    drillNumber: string,
    section: string,
    sets = 45,
): SheetMarcher {
    return {
        name,
        displayName: name || `${section} ${drillNumber.replace(/\D/g, "")}`,
        drillNumber,
        section,
        rows: Array.from({ length: sets }, (_, i) => ({
            set: String(i + 1),
            counts: i === 0 ? 0 : 8 + (i % 3) * 4,
            measures: "-",
            sideToSide: sideTexts[i % 3],
            frontToBack: frontTexts[i % 3],
            sideToSideTerse: "S1: 2 IN 45",
            frontToBackTerse: "9.5 BE grid:BH",
        })),
    };
}

const model: SheetModel = {
    showName: "Test Show",
    marchers: [
        marcher("Ana García-Núñez", "F1", "Flute"),
        marcher("Émile Zoë Østergaard", "S6", "Snare"),
        marcher("Gus <Tag> & Co", "G8", "Color Guard"),
        marcher(
            "Christopher Alexander Montgomery-Wellington III",
            "T4",
            "Trumpet",
        ),
    ],
};

/** The text of an uncompressed pdfkit PDF drawn with a standard font. */
function pdfText(bytes: Uint8Array): string {
    const raw = new TextDecoder("latin1").decode(bytes);
    const decoder = new TextDecoder("windows-1252");
    const parts: string[] = [];
    for (const tj of raw.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
        const hex = [...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)]
            .map((m) => m[1])
            .join("");
        const buf = new Uint8Array(
            hex.match(/../g)?.map((h) => parseInt(h, 16)) ?? [],
        );
        parts.push(decoder.decode(buf));
    }
    return parts.join(" ");
}

const squash = (s: string) => s.replace(/\s+/g, "");
const pageCount = (bytes: Uint8Array) =>
    new TextDecoder("latin1").decode(bytes).match(/\/Type \/Page\b(?!s)/g)
        ?.length ?? 0;

/** jsdom's Blob has no arrayBuffer() */
function blobBytes(blob: Blob): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
            resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    });
}

async function render(
    doc: Record<string, unknown>,
    font: "Helvetica" | "Roboto" = "Helvetica",
) {
    const blob = await renderPdf({ ...doc, compress: false }, font);
    return blobBytes(blob);
}

describe("coordinate sheet PDFs (pdfmake)", () => {
    it("full pages: header, footer, repeated table header and literal text", async () => {
        const bytes = await render(fullDocument(model, opts));
        const text = squash(pdfText(bytes));
        const pages = pageCount(bytes);
        // 45 verbose rows do not fit one page, so each marcher takes two
        expect(pages).toBe(8);
        for (const name of [
            "Ana García-Núñez",
            "Émile Zoë Østergaard",
            "Gus <Tag> & Co",
        ])
            expect(text).toContain(squash(name));
        expect(text).toContain(squash("Page 1 of 8"));
        expect(text).toContain(squash("Page 8 of 8"));
        expect(text.split(squash("Made with OpenMarch")).length - 1).toBe(8);
        expect(text.split("TestShow").length - 1).toBe(8);
        // column headers and performer bar repeat on the second page of each
        expect(text.split(squash("Front to Back")).length - 1).toBe(8);
        expect(text.split(squash("Ana García-Núñez")).length - 1).toBe(2);
    });

    it.each(["Helvetica", "Roboto"] as const)(
        "quarter pages: every quarter fits its box (%s)",
        async (font) => {
            const o = { ...opts, font };
            const items = quarterItems(model, o);
            if (font === "Helvetica")
                // 45 verbose rows make three quarters per marcher
                expect(
                    items.filter((i) => i.marcher.drillNumber === "F1"),
                ).toHaveLength(3);
            for (const item of items) {
                const bytes = await render(quarterFitDocument(item, o), font);
                expect(
                    pageCount(bytes),
                    `${item.marcher.drillNumber} quarter ${item.quarterNumber}`,
                ).toBe(1);
            }
            const bytes = await render(quarterDocument(model, o), font);
            expect(pageCount(bytes)).toBe(Math.ceil(items.length / 4));
        },
    );

    it("quarter pages: terse rows fit more per quarter", () => {
        const terse = quarterItems(model, { ...opts, terse: true });
        const verbose = quarterItems(model, opts);
        expect(terse.length).toBeLessThan(verbose.length);
    });

    it("organize by section zips one PDF per marcher in section folders", async () => {
        const result = await makeCoordinateSheetPdfs(model, {
            includeMeasures: true,
            terse: false,
            useXY: false,
            quarterPages: false,
            organizeBySection: true,
            baseName: "show",
            now: new Date("2026-11-12T12:00:00Z"),
        });
        expect(result.file.name).toBe("show-2026-11-12-coordinate-sheets.zip");
        const zip = await JSZip.loadAsync(await blobBytes(result.file));
        const names = Object.keys(zip.files).filter((n) => n.endsWith(".pdf"));
        expect(names.sort()).toEqual([
            "Color Guard/show-2026-11-12-G8 - Gus _Tag_ & Co.pdf",
            "Flute/show-2026-11-12-F1 - Ana García-Núñez.pdf",
            "Snare/show-2026-11-12-S6 - Émile Zoë Østergaard.pdf",
            "Trumpet/show-2026-11-12-T4 - Christopher Alexander Montgomery-Wellington III.pdf",
        ]);
        const pdf = await zip.file(names[0])!.async("uint8array");
        expect(new TextDecoder("latin1").decode(pdf.slice(0, 5))).toBe("%PDF-");
    });

    it("picks Roboto only when Helvetica cannot show a name", () => {
        expect(fitsStandardFont("Émile Zoë Østergaard – Š")).toBe(true);
        expect(fitsStandardFont("Łukasz")).toBe(false);
        expect(fitsStandardFont("Ольга")).toBe(false);
        expect(pickFont(model, ENGLISH_LABELS)).toBe("Helvetica");
        const polish = {
            ...model,
            marchers: [
                ...model.marchers,
                marcher("Łukasz Dvořák", "B9", "Brass", 2),
            ],
        };
        expect(pickFont(polish, ENGLISH_LABELS)).toBe("Roboto");
    });

    it("estimates wrapping conservatively", () => {
        expect(estimateLines("S1: On 40 yard line", 200, 7.5)).toBe(1);
        expect(
            estimateLines("14.25 in front of grid back sideline", 70, 7.5),
        ).toBe(2);
        expect(estimateLines("", 50, 10)).toBe(1);
    });
});
