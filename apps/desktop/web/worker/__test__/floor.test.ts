// @vitest-environment node
import { describe, expect, it } from "vitest";
import FieldPropertiesTemplates from "../../../src/global/classes/FieldProperties.templates";
import { floorSizeForImage } from "../../../src/view3d/core/field/floorSize";
import { hashParts, versionHashOf } from "../../../src/view3d/library/showHash";
import { decodeArtworkSidecar } from "../../../electron/main/artwork-import/sidecar";
import { webFloorFromFieldImage, type FloorDecoder } from "../floor";

const gym = FieldPropertiesTemplates.INDOOR_50x80_8to5;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const GIF = new TextEncoder().encode("GIF89a stand-in");

/** Stands in for createImageBitmap and OffscreenCanvas, which Node lacks. */
const decoder = (width: number, height: number) => {
    const calls: { width: number; height: number }[] = [];
    const decode: FloorDecoder = async () => ({
        width,
        height,
        encodePng: async (w, h) => {
            calls.push({ width: w, height: h });
            return new TextEncoder().encode(`png ${w}x${h}`);
        },
    });
    return { decode, calls };
};

describe("webFloorFromFieldImage (D-23 in the web editor)", () => {
    it("keeps a PNG within the cap as both original and display", async () => {
        const { decode, calls } = decoder(1200, 600);
        const version = await webFloorFromFieldImage(PNG, gym, { decode });

        expect(calls).toEqual([]);
        expect(Array.from(version.parts.original!)).toEqual(Array.from(PNG));
        expect(Array.from(version.parts.display!)).toEqual(Array.from(PNG));
        const sidecar = decodeArtworkSidecar(version.parts.sidecar!);
        expect(sidecar).toMatchObject({
            surface: "baseFloor",
            original: { format: "png", pixels: { width: 1200, height: 600 } },
            display: { width: 1200, height: 600, format: "png" },
            size: { source: "slot", templateId: null },
            badges: [],
        });
        const size = floorSizeForImage(gym, { width: 1200, height: 600 });
        expect(sidecar.size.width.m).toBeCloseTo(size.widthM, 6);
        expect(version.versionHash).toBe(
            await versionHashOf(await hashParts(version.parts)),
        );
        expect(version).toMatchObject({
            kind: "artwork",
            name: "Field image",
            builtIn: false,
        });
    });

    it("downsizes a large image to the Base floor cap (2048 on the long edge)", async () => {
        const { decode, calls } = decoder(8000, 4000);
        const version = await webFloorFromFieldImage(PNG, gym, { decode });
        expect(calls).toEqual([{ width: 2048, height: 1024 }]);
        expect(decodeArtworkSidecar(version.parts.sidecar!).display).toEqual({
            width: 2048,
            height: 1024,
            format: "png",
        });
        expect(Array.from(version.parts.original!)).toEqual(Array.from(PNG));
    });

    it("makes a GIF or WebP a PNG, as the desktop pipeline does", async () => {
        const { decode, calls } = decoder(300, 300);
        const version = await webFloorFromFieldImage(GIF, gym, { decode });
        expect(calls).toEqual([{ width: 300, height: 300 }]);
        expect(new TextDecoder().decode(version.parts.original!)).toBe(
            "png 300x300",
        );
        expect(
            decodeArtworkSidecar(version.parts.sidecar!).original.format,
        ).toBe("png");
    });

    it("keeps an SVG as a vector original and has the page draw its display texture", async () => {
        const svg = new TextEncoder().encode(
            '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"/>',
        );
        const asked: unknown[][] = [];
        const version = await webFloorFromFieldImage(svg, gym, {
            decode: () => Promise.reject(new Error("not a raster")),
            rasterize: async (...args) => {
                asked.push(args);
                return { png: PNG, width: 2048, height: 1024, pageCount: 1 };
            },
        });
        expect(asked).toEqual([[svg, "svg", 2048]]);
        expect(Array.from(version.parts.original!)).toEqual(Array.from(svg));
        expect(Array.from(version.parts.display!)).toEqual(Array.from(PNG));
        const sidecar = decodeArtworkSidecar(version.parts.sidecar!);
        expect(sidecar).toMatchObject({
            original: { format: "svg", page: null, pixels: null },
            nativeDpi: "vector",
            display: { width: 2048, height: 1024, format: "png" },
        });
        const size = floorSizeForImage(gym, { width: 2048, height: 1024 });
        expect(sidecar.size.width.m).toBeCloseTo(size.widthM, 6);
    });

    it("makes a PDF's first page the floor, as the desktop does", async () => {
        const pdf = new TextEncoder().encode("%PDF-1.7 stand-in");
        const version = await webFloorFromFieldImage(pdf, gym, {
            decode: () => Promise.reject(new Error("not a raster")),
            rasterize: async () => ({
                png: PNG,
                width: 1584,
                height: 2048,
                pageCount: 3,
            }),
        });
        const sidecar = decodeArtworkSidecar(version.parts.sidecar!);
        expect(sidecar.original).toMatchObject({
            format: "pdf",
            page: { index: 0, count: 3 },
            pixels: null,
        });
        expect(version.metadata.originalFilename).toBe("Field image.pdf");
    });
});
