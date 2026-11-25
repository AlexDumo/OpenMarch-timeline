// cspell:words artboard
/**
 * Turns a picked PNG or SVG into a placed item's image (fork #1258; docs/3d/uniform-artwork.md,
 * "Placing items"), decoded the same safe way step 3 decodes layers:
 *
 * - **PNG:** decoded, trimmed to its painted pixels, capped at `UNIFORM_ITEM_STORED_PX` on its
 *   long side and re-encoded, all in the uniform pack worker; the window never decodes it.
 * - **SVG:** a worker can't draw SVG, so the window draws it as an image (image mode runs no
 *   scripts and fetches nothing) at the stored size, and the worker trims and encodes the pixels.
 *
 * The window gets back the PNG the pack will store and a bitmap to draw.
 */
import {
    UNIFORM_ITEM_STORED_PX,
    uniformNameFromFile,
} from "@/view3d/core/uniformPack/format";
import {
    UniformPackJobError,
    runUniformPackJob,
} from "@/view3d/uniformPack/runUniformPackJob";
import {
    UNIFORM_SVG_MAX_BYTES,
    UniformImportError,
    refusalOf,
    sizedSvg,
    svgViewBox,
    uniformFileKind,
} from "./importUniform";
import type { ItemImage } from "./itemDrafts";

/** A PNG larger than this isn't read as an item */
export const UNIFORM_ITEM_MAX_BYTES = 16 * 1024 * 1024;

export interface ImportedItem {
    /** The file's name without its extension, for the list */
    name: string;
    image: ItemImage;
    /** Width over height of the trimmed image */
    aspect: number;
}

/** An SVG's width over height: its viewBox's, else its width and height attributes', else 1 */
export function svgAspect(text: string): number {
    const box = svgViewBox(text);
    if (box && box[2] > 0 && box[3] > 0) return box[2] / box[3];
    const root = /<svg\b[^>]*>/i.exec(text)?.[0] ?? "";
    const w = parseFloat(/\swidth\s*=\s*["']([\d.]+)/i.exec(root)?.[1] ?? "");
    const h = parseFloat(/\sheight\s*=\s*["']([\d.]+)/i.exec(root)?.[1] ?? "");
    return w > 0 && h > 0 ? w / h : 1;
}

/** A rectangle of pixels */
export interface PixelBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Draws an SVG as an image at `width` × `height` and returns the RGBA pixels (not premultiplied)
 * of `crop`, or of all of it
 */
async function drawSvgItem(
    text: string,
    width: number,
    height: number,
    crop: PixelBox = { x: 0, y: 0, w: width, h: height },
): Promise<Uint8ClampedArray> {
    const url = URL.createObjectURL(
        new Blob([sizedSvg(text, width, height)], { type: "image/svg+xml" }),
    );
    try {
        const img = new Image();
        img.decoding = "async";
        img.src = url;
        await img.decode().catch(() => {
            throw new UniformImportError(
                "unreadable",
                "the SVG couldn't be drawn",
            );
        });
        const canvas = document.createElement("canvas");
        canvas.width = crop.w;
        canvas.height = crop.h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, -crop.x, -crop.y, width, height);
        const pixels = ctx.getImageData(0, 0, crop.w, crop.h).data;
        canvas.width = 0;
        return pixels;
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** The box of pixels with alpha above 8, or null when there are none */
export function paintedBox(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
): PixelBox | null {
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
            if (pixels[(y * width + x) * 4 + 3] > 8) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** An SVG whose root viewBox is `box` instead of its own */
export function withViewBox(
    text: string,
    box: readonly [number, number, number, number],
): string {
    return text.replace(/<svg\b[^>]*>/i, (tag) =>
        tag.replace(
            /\bviewBox\s*=\s*(["'])[^"']*\1/i,
            `viewBox="${box.map((v) => Number(v.toFixed(4))).join(" ")}"`,
        ),
    );
}

/** The largest an SVG is drawn whole to cut a small logo out of a big artboard, pixels a side */
const SVG_WHOLE_MAX_PX = 4096;

/**
 * An SVG item drawn sharp: first whole at `UNIFORM_ITEM_STORED_PX` on its long side, to find the
 * art; then, when the art fills only part of the artboard (a logo on a letter-size page), drawn
 * again with just the art at that size: through a viewBox cut to the art when the SVG has one,
 * otherwise whole at up to 4096 px and cropped. Returns the pixels and their size.
 */
export async function drawSvgItemSharp(
    text: string,
    drawSvg: typeof drawSvgItem = drawSvgItem,
): Promise<{ width: number; height: number; pixels: Uint8ClampedArray }> {
    const long = UNIFORM_ITEM_STORED_PX;
    const fit = (aspect: number) => ({
        width: Math.max(1, Math.round(aspect >= 1 ? long : long * aspect)),
        height: Math.max(1, Math.round(aspect >= 1 ? long / aspect : long)),
    });
    const whole = fit(svgAspect(text));
    const first = await drawSvg(text, whole.width, whole.height);
    const box = paintedBox(first, whole.width, whole.height);
    // nothing painted (the worker says so), or the art already fills the artboard
    if (!box || (box.w >= 0.9 * whole.width && box.h >= 0.9 * whole.height))
        return { ...whole, pixels: first };
    // a pixel of margin, so anti-aliased edges aren't cut
    const m = {
        x: Math.max(0, box.x - 1),
        y: Math.max(0, box.y - 1),
        w: Math.min(whole.width, box.x + box.w + 1) - Math.max(0, box.x - 1),
        h: Math.min(whole.height, box.y + box.h + 1) - Math.max(0, box.y - 1),
    };
    const vb = svgViewBox(text);
    if (vb && vb[2] > 0 && vb[3] > 0) {
        const cut: [number, number, number, number] = [
            vb[0] + (m.x / whole.width) * vb[2],
            vb[1] + (m.y / whole.height) * vb[3],
            (m.w / whole.width) * vb[2],
            (m.h / whole.height) * vb[3],
        ];
        const size = fit(m.w / m.h);
        return {
            ...size,
            pixels: await drawSvg(
                withViewBox(text, cut),
                size.width,
                size.height,
            ),
        };
    }
    const scale = Math.min(
        long / Math.max(m.w, m.h),
        SVG_WHOLE_MAX_PX / Math.max(whole.width, whole.height),
    );
    if (scale <= 1) return { ...whole, pixels: first };
    const crop = {
        x: Math.floor(m.x * scale),
        y: Math.floor(m.y * scale),
        w: Math.max(1, Math.ceil(m.w * scale)),
        h: Math.max(1, Math.ceil(m.h * scale)),
    };
    return {
        width: crop.w,
        height: crop.h,
        pixels: await drawSvg(
            text,
            Math.round(whole.width * scale),
            Math.round(whole.height * scale),
            crop,
        ),
    };
}

/** A picked file as an item image. Throws {@link UniformImportError}. */
export async function importItemFile(
    file: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> },
    {
        runJob = runUniformPackJob,
        drawSvg = drawSvgItem,
    }: {
        runJob?: typeof runUniformPackJob;
        drawSvg?: typeof drawSvgItem;
    } = {},
): Promise<ImportedItem> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let kind = uniformFileKind(file.name, bytes.subarray(0, 4));
    if (
        !kind &&
        /<svg\b/i.test(new TextDecoder().decode(bytes.subarray(0, 512)))
    )
        kind = "svg";
    if (kind !== "png" && kind !== "svg")
        throw new UniformImportError("unsupported", file.name);
    try {
        let result;
        if (kind === "png") {
            if (bytes.byteLength > UNIFORM_ITEM_MAX_BYTES)
                throw new UniformImportError(
                    "tooLarge",
                    `${bytes.byteLength} bytes`,
                );
            result = await runJob({ type: "item", bytes }, [bytes.buffer]);
        } else {
            if (bytes.byteLength > UNIFORM_SVG_MAX_BYTES)
                throw new UniformImportError(
                    "tooLarge",
                    `${bytes.byteLength} bytes`,
                );
            const text = new TextDecoder().decode(bytes);
            if (!/<svg\b/i.test(text))
                throw new UniformImportError("notSvg", file.name);
            const { width, height, pixels } = await drawSvgItemSharp(
                text,
                drawSvg,
            );
            result = await runJob(
                { type: "itemPixels", width, height, pixels },
                [pixels.buffer],
            );
        }
        if (result.type !== "itemImage")
            throw new UniformImportError("unreadable", "no image");
        return {
            name: uniformNameFromFile(file.name),
            image: { png: result.png, bitmap: result.bitmap },
            aspect: result.width / result.height,
        };
    } catch (error) {
        if (error instanceof UniformImportError) throw error;
        if (error instanceof UniformPackJobError)
            throw new UniformImportError(refusalOf(error), error.message);
        throw error;
    }
}
