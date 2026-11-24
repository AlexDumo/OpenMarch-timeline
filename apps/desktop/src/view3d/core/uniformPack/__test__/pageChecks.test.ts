import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COLORS } from "@/view3d/core/artworkTemplates/uniform/drawing";
import { FLATS_PAGE_DPI } from "../format";
import { pageNotes, type PageRegions } from "../pageChecks";
import { REGION_FILL, WRAP_BAND_FILL } from "../templateColors";

const regions = JSON.parse(
    fs.readFileSync(
        path.resolve(__dirname, "../../../assets/uniform-flats/regions.json"),
        "utf8",
    ),
) as PageRegions;

// the page at 4 px/in keeps the test quick; the checks scale with dpi
const DPI = 4;
const W = 105 * DPI;
const H = 88 * DPI;

const page = (
    fill: (x: number, y: number) => [number, number, number, number],
) => {
    const px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) px.set(fill(x, y), (y * W + x) * 4);
    return px;
};
const rgb = (n: number): [number, number, number] => [
    (n >> 16) & 0xff,
    (n >> 8) & 0xff,
    n & 0xff,
];
const front = regions.panels.front;
const inFrontPanel = (x: number, y: number) =>
    x / DPI >= front.x &&
    x / DPI < front.x + front.w &&
    y / DPI >= front.y &&
    y / DPI < front.y + front.h;

describe("imported page notes", () => {
    it("says nothing about a transparent page painted on the front and back", () => {
        const notes = pageNotes(
            page((x, y) =>
                inFrontPanel(x, y) ? [200, 20, 40, 255] : [0, 0, 0, 0],
            ),
            W,
            H,
            DPI,
            regions,
        );
        expect(notes).toEqual([]);
    });

    it("notes an empty page", () => {
        expect(
            pageNotes(
                page(() => [0, 0, 0, 0]),
                W,
                H,
                DPI,
                regions,
            ),
        ).toEqual(["empty"]);
    });

    it("notes a fully opaque page", () => {
        expect(
            pageNotes(
                page(() => [30, 30, 90, 255]),
                W,
                H,
                DPI,
                regions,
            ),
        ).toEqual(["opaque"]);
    });

    it("notes the template layer left visible", () => {
        // the template's white page, its pale region fill showing over the whole front
        const notes = pageNotes(
            page((x, y) =>
                inFrontPanel(x, y)
                    ? [...rgb(REGION_FILL), 255]
                    : [255, 255, 255, 255],
            ),
            W,
            H,
            DPI,
            regions,
        );
        expect(notes).toContain("template");
        expect(notes).toContain("opaque");
    });

    it("uses the template's own colors", () => {
        expect(REGION_FILL).toBe(parseInt(COLORS.region.slice(1), 16));
        expect(WRAP_BAND_FILL).toBe(parseInt(COLORS.band.slice(1), 16));
        expect(FLATS_PAGE_DPI).toBe(32);
    });

    it("notes a logo-like shape painted on the chest, and not stripes or a plain jacket", () => {
        const chest = { x: front.x + 17, y: front.y + 25.32 };
        const navy: [number, number, number, number] = [20, 20, 70, 255];
        const gold: [number, number, number, number] = [220, 180, 60, 255];
        const jacket = (paint: (xIn: number, yIn: number) => boolean) =>
            pageNotes(
                page((x, y) =>
                    inFrontPanel(x, y)
                        ? paint(x / DPI, y / DPI)
                            ? gold
                            : navy
                        : [0, 0, 0, 0],
                ),
                W,
                H,
                DPI,
                regions,
            );
        // a 6 in round crest on the chest
        expect(
            jacket((x, y) => Math.hypot(x - chest.x, y - chest.y) < 3),
        ).toEqual(["paintedLogo"]);
        // a band across the chest touches the side seams: fabric, not a logo
        expect(jacket((_, y) => Math.abs(y - chest.y) < 1.5)).toEqual([]);
        // a stripe down the front
        expect(jacket((x) => Math.abs(x - chest.x) < 0.75)).toEqual([]);
        // a button is too small
        expect(
            jacket((x, y) => Math.hypot(x - chest.x, y - chest.y) < 0.5),
        ).toEqual([]);
        // nothing at all
        expect(jacket(() => false)).toEqual([]);
    });
});
