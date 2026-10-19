/**
 * The show's floor in the web editor (ADR 0002 D-23). The web build has no `sharp` and no local
 * Library, so it makes a Base floor Version the way the desktop Artwork pipeline would, with the
 * browser's own decoder: the image as its original (a GIF, WebP or BMP becomes a PNG first), a
 * display texture at the Base floor cap, and the same sidecar. An SVG or PDF stays the original
 * as a vector, and the page draws it for the display texture (the worker has no DOM). Convert on
 * open and a new show copying a previous show's image both use it in place of the desktop's
 * `floorFromFieldImage`.
 */
import type { FieldProperties } from "@openmarch/core";
import { floorSizeForImage } from "../../src/view3d/core/field/floorSize";
import {
    ARTWORK_SURFACE_SPECS,
    nativeDpi,
} from "../../src/view3d/core/sizes/artwork";
import { hashParts, versionHashOf } from "../../src/view3d/library/showHash";
import type { EmbedLibraryVersion } from "../../src/db-functions/showLibrary";
import {
    ARTWORK_PARTS,
    ARTWORK_SIDECAR_VERSION,
    encodeArtworkSidecar,
} from "../../electron/main/artwork-import/sidecar";
import { sniffArtworkFormat } from "../../electron/main/artwork-import/formats";
import { PAGE_CHANNELS, type RasterizedImage } from "../protocol";
import { askPage } from "./page";

const FLOOR_NAME = "Field image";

/** A decoded image that can be written out as a PNG at any size. */
export interface DecodedImage {
    width: number;
    height: number;
    encodePng(width: number, height: number): Promise<Uint8Array>;
}

export type FloorDecoder = (image: Uint8Array) => Promise<DecodedImage>;

/** Draws an SVG, or a PDF's first page, as a PNG `long` pixels on its long edge. */
export type VectorRasterizer = (
    image: Uint8Array,
    format: "svg" | "pdf",
    long: number,
) => Promise<RasterizedImage>;

/** The page draws vectors: the worker has no DOM for an SVG, nor pdf.js. */
export const pageRasterizer: VectorRasterizer = (image, format, long) =>
    askPage<RasterizedImage>(PAGE_CHANNELS.rasterizeImage, image, format, long);

/** The worker's decoder: `createImageBitmap`, drawn on an `OffscreenCanvas` to write a PNG. */
export const browserDecoder: FloorDecoder = async (image) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(image)]));
    return {
        width: bitmap.width,
        height: bitmap.height,
        async encodePng(width, height) {
            const canvas = new OffscreenCanvas(width, height);
            const context = canvas.getContext("2d");
            if (!context) throw new Error("No 2D canvas in this browser");
            context.drawImage(bitmap, 0, 0, width, height);
            const blob = await canvas.convertToBlob({ type: "image/png" });
            return new Uint8Array(await blob.arrayBuffer());
        },
    };
};

interface MadeFloor {
    original: Uint8Array;
    format: "png" | "jpeg" | "svg" | "pdf";
    page: { index: number; count: number } | null;
    /** Null for a vector original */
    pixels: { width: number; height: number } | null;
    size: { widthM: number; heightM: number };
    display: Uint8Array;
    displaySize: { width: number; height: number; format: "png" | "jpeg" };
}

/** A raster: its own bytes (a GIF, WebP or BMP as a PNG), downsized to the cap for display. */
async function rasterFloor(
    image: Uint8Array,
    sniffed: "png" | "jpeg" | null,
    fieldProperties: FieldProperties,
    decode: FloorDecoder,
): Promise<MadeFloor> {
    const decoded = await decode(image);
    const pixels = { width: decoded.width, height: decoded.height };
    const format = sniffed ?? "png";
    const original = sniffed
        ? image
        : await decoded.encodePng(pixels.width, pixels.height);
    const target = displaySize(pixels.width, pixels.height);
    const resized =
        target.width !== pixels.width || target.height !== pixels.height;
    return {
        original,
        format,
        page: null,
        pixels,
        size: floorSizeForImage(fieldProperties, pixels),
        display: resized
            ? await decoded.encodePng(target.width, target.height)
            : original,
        displaySize: { ...target, format: resized ? "png" : format },
    };
}

/** A vector stays the original; its display texture is drawn at the cap, as a PNG. */
async function vectorFloor(
    image: Uint8Array,
    format: "svg" | "pdf",
    fieldProperties: FieldProperties,
    rasterize: VectorRasterizer,
): Promise<MadeFloor> {
    const { long } = ARTWORK_SURFACE_SPECS.baseFloor.displayCap;
    const drawn = await rasterize(image, format, long);
    return {
        original: image,
        format,
        page: format === "pdf" ? { index: 0, count: drawn.pageCount } : null,
        pixels: null,
        size: floorSizeForImage(fieldProperties, drawn),
        display: drawn.png,
        displaySize: {
            width: drawn.width,
            height: drawn.height,
            format: "png",
        },
    };
}

/** Fits `width` × `height` inside the Base floor's display cap, never enlarging. */
function displaySize(width: number, height: number) {
    const { long } = ARTWORK_SURFACE_SPECS.baseFloor.displayCap;
    const scale = Math.min(1, long / Math.max(width, height));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

export async function webFloorFromFieldImage(
    image: Uint8Array,
    fieldProperties: FieldProperties,
    {
        decode = browserDecoder,
        rasterize = pageRasterizer,
    }: { decode?: FloorDecoder; rasterize?: VectorRasterizer } = {},
): Promise<EmbedLibraryVersion> {
    const sniffed = sniffArtworkFormat(image);
    const made =
        sniffed === "pdf" || sniffed === "svg"
            ? await vectorFloor(image, sniffed, fieldProperties, rasterize)
            : await rasterFloor(image, sniffed, fieldProperties, decode);
    const { original, display, format } = made;
    const sidecar = encodeArtworkSidecar({
        schemaVersion: ARTWORK_SIDECAR_VERSION,
        type: "openmarch-artwork",
        surface: "baseFloor",
        original: {
            format,
            page: made.page,
            pixels: made.pixels,
            colorSpace: "srgb",
        },
        size: {
            width: { m: made.size.widthM },
            height: { m: made.size.heightM },
            source: "slot",
            templateId: null,
        },
        nativeDpi: made.pixels
            ? nativeDpi(made.pixels.width, made.size.widthM)
            : "vector",
        display: made.displaySize,
        importNotes: [],
        badges: [],
    });

    const parts = {
        [ARTWORK_PARTS.original]: original,
        [ARTWORK_PARTS.display]: display,
        [ARTWORK_PARTS.sidecar]: sidecar,
    };
    const now = new Date().toISOString();
    return {
        itemId: crypto.randomUUID(),
        versionHash: await versionHashOf(await hashParts(parts)),
        kind: "artwork",
        name: FLOOR_NAME,
        builtIn: false,
        metadata: {
            tags: [],
            createdAt: now,
            updatedAt: now,
            originalFilename: `${FLOOR_NAME}.${format === "jpeg" ? "jpg" : format}`,
            derivedFrom: null,
            // Nobody said where a converted field image came from
            license: "LicenseRef-Unknown",
            licenseText: null,
            author: null,
            sourceUrl: null,
            attribution: null,
            modified: false,
        },
        pins: [],
        parts,
    };
}
