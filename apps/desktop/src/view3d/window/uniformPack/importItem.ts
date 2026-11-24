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

/** Draws an SVG as an image at `width` × `height`; RGBA pixels, not premultiplied */
async function drawSvgItem(
    text: string,
    width: number,
    height: number,
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
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height).data;
        canvas.width = 0;
        return pixels;
    } finally {
        URL.revokeObjectURL(url);
    }
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
            const aspect = svgAspect(text);
            const long = UNIFORM_ITEM_STORED_PX;
            const width = Math.max(
                1,
                Math.round(aspect >= 1 ? long : long * aspect),
            );
            const height = Math.max(
                1,
                Math.round(aspect >= 1 ? long / aspect : long),
            );
            const pixels = await drawSvg(text, width, height);
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
            throw new UniformImportError(error.code, error.message);
        throw error;
    }
}
