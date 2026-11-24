// cspell:words fflate
/**
 * The uniform pack worker (fork #1257; ADR 0010 amendment 2026-11-24). Reads pack files and
 * decodes the images a uniform import is given and the layers a show's pack holds, so neither the
 * 3D View window nor the editor parses or decodes them on its main thread.
 *
 * What it isolates: a slow or hanging file stalls only this worker, and the caller ends it after
 * one job or its timeout. It runs in the renderer's process, though, so a decoder crash can still
 * take the page down; the size checks before decoding are what keep that unlikely. It runs under
 * its own policy (`src/security/appCsp.ts`): its own script and nothing else, no network, no
 * `eval`, no WebAssembly. fflate, which reads the zip, is plain JavaScript.
 */
import {
    FLATS_PAGE_DPI,
    FLATS_PAGE_PX,
    UNIFORM_ITEM_MAX_PIXELS,
    UNIFORM_ITEM_MAX_SIDE,
    UNIFORM_ITEM_STORED_PX,
    UNIFORM_LAYER_MAX_PIXELS,
    UniformPackError,
    packWithItems,
    pngHeaderSize,
    readUniformPack,
} from "@/view3d/core/uniformPack/format";
import {
    pageNotes,
    type PageRegions,
} from "@/view3d/core/uniformPack/pageChecks";
import type {
    UniformPackRefusal,
    UniformPackRequest,
    UniformPackResponse,
} from "./protocol";

const reply = (message: UniformPackResponse, transfer: Transferable[] = []) =>
    postMessage(message, { transfer });

class Refused extends Error {
    constructor(
        readonly code: UniformPackRefusal,
        message: string,
    ) {
        super(message);
    }
}

/**
 * A PNG's bitmap at `width` × `height` (its own size when they're left out), after its header is
 * checked against `maxPixels`
 */
async function decodePng(
    bytes: Uint8Array,
    width?: number,
    height?: number,
    maxPixels = UNIFORM_LAYER_MAX_PIXELS,
): Promise<{ bitmap: ImageBitmap; source: { width: number; height: number } }> {
    const source = pngHeaderSize(bytes);
    if (!source) throw new Refused("notPng", "not a PNG");
    if (
        source.width * source.height > maxPixels ||
        // an item image is also capped on each side, so 65536 × 64 isn't an item
        (maxPixels === UNIFORM_ITEM_MAX_PIXELS &&
            Math.max(source.width, source.height) > UNIFORM_ITEM_MAX_SIDE)
    )
        throw new Refused(
            "tooLarge",
            `${source.width} × ${source.height} px is over ${maxPixels} pixels`,
        );
    width ??= source.width;
    height ??= source.height;
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(
            new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }),
            {
                premultiplyAlpha: "none",
                colorSpaceConversion: "none",
                ...(source.width !== width || source.height !== height
                    ? {
                          resizeWidth: width,
                          resizeHeight: height,
                          resizeQuality: "high",
                      }
                    : {}),
            },
        );
    } catch (error) {
        throw new Refused(
            "unreadable",
            error instanceof Error ? error.message : String(error),
        );
    }
    return { bitmap, source };
}

/** A page's notes, from a canvas at the template's size */
function notesOf(canvas: OffscreenCanvas, regions: PageRegions) {
    const { width, height } = canvas;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const pixels = ctx.getImageData(0, 0, width, height).data;
    return pageNotes(pixels, width, height, FLATS_PAGE_DPI, regions);
}

/** A PNG drawn onto a canvas at the template's size */
async function pageCanvas(bytes: Uint8Array) {
    const { width, height } = FLATS_PAGE_PX;
    const { bitmap, source } = await decodePng(bytes, width, height);
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const scaled =
        source.width !== width || source.height !== height ? source : null;
    return { canvas, scaled };
}

/** Checks a page's pixels and encodes them as the pack's PNG */
async function finishPage(
    canvas: OffscreenCanvas,
    regions: PageRegions,
    scaledFrom: { width: number; height: number } | null,
) {
    const notes = notesOf(canvas, regions);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const png = new Uint8Array(await blob.arrayBuffer());
    reply({ type: "page", png, notes, scaledFrom }, [png.buffer]);
}

/**
 * An item image from a canvas holding it: trimmed to its painted pixels (alpha above 8), scaled to
 * at most `UNIFORM_ITEM_STORED_PX` on its long side, and encoded as PNG. Refuses an empty image.
 */
async function finishItem(source: OffscreenCanvas) {
    const { width, height } = source;
    const ctx = source.getContext("2d", { willReadFrequently: true })!;
    const data = ctx.getImageData(0, 0, width, height).data;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
            if (data[(y * width + x) * 4 + 3] > 8) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
    if (x1 < 0) throw new Refused("unreadable", "the image is empty");
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const scale = Math.min(1, UNIFORM_ITEM_STORED_PX / Math.max(w, h));
    const out = new OffscreenCanvas(
        Math.max(1, Math.round(w * scale)),
        Math.max(1, Math.round(h * scale)),
    );
    const outCtx = out.getContext("2d")!;
    outCtx.imageSmoothingQuality = "high";
    outCtx.drawImage(source, x0, y0, w, h, 0, 0, out.width, out.height);
    const blob = await out.convertToBlob({ type: "image/png" });
    const png = new Uint8Array(await blob.arrayBuffer());
    const bitmap = out.transferToImageBitmap();
    reply(
        {
            type: "itemImage",
            png,
            bitmap,
            width: bitmap.width,
            height: bitmap.height,
        },
        [png.buffer, bitmap],
    );
}

async function handle(request: UniformPackRequest) {
    const { width, height } = FLATS_PAGE_PX;
    switch (request.type) {
        case "png": {
            const { canvas, scaled } = await pageCanvas(request.bytes);
            await finishPage(canvas, request.regions, scaled);
            return;
        }
        case "pixels": {
            if (
                request.width !== width ||
                request.height !== height ||
                request.pixels.length !== width * height * 4
            )
                throw new Refused(
                    "unreadable",
                    "the drawn page isn't the template's size",
                );
            const canvas = new OffscreenCanvas(width, height);
            canvas
                .getContext("2d")!
                .putImageData(
                    new ImageData(
                        request.pixels as Uint8ClampedArray<ArrayBuffer>,
                        width,
                        height,
                    ),
                    0,
                    0,
                );
            await finishPage(canvas, request.regions, null);
            return;
        }
        case "pack": {
            const pack = readUniformPack(request.bytes);
            let notes: ReturnType<typeof pageNotes> = [];
            if (request.regions) {
                const { canvas } = await pageCanvas(pack.layers[0].png);
                notes = notesOf(canvas, request.regions);
            }
            const itemSizes: Record<string, { width: number; height: number }> =
                {};
            for (const { file, png } of pack.itemFiles) {
                const size = pngHeaderSize(png);
                if (size) itemSizes[file] = size;
            }
            reply({ type: "pack", manifest: pack.manifest, notes, itemSizes });
            return;
        }
        case "flatten": {
            const pack = readUniformPack(request.bytes);
            const w = Math.max(1, Math.min(8192, Math.round(request.width)));
            const h = Math.max(1, Math.min(8192, Math.round(request.height)));
            const canvas = new OffscreenCanvas(w, h);
            const ctx = canvas.getContext("2d")!;
            for (const layer of pack.layers) {
                const { bitmap } = await decodePng(layer.png, w, h);
                ctx.drawImage(bitmap, 0, 0, w, h);
                bitmap.close();
            }
            const bitmap = canvas.transferToImageBitmap();
            const itemBitmaps: { file: string; bitmap: ImageBitmap }[] = [];
            for (const { file, png } of pack.itemFiles) {
                // decoded at most UNIFORM_ITEM_STORED_PX on its long side, whatever it says
                const size = pngHeaderSize(png);
                const scale = size
                    ? Math.min(
                          1,
                          UNIFORM_ITEM_STORED_PX /
                              Math.max(size.width, size.height),
                      )
                    : 1;
                const decoded = await decodePng(
                    png,
                    size
                        ? Math.max(1, Math.round(size.width * scale))
                        : undefined,
                    size
                        ? Math.max(1, Math.round(size.height * scale))
                        : undefined,
                    UNIFORM_ITEM_MAX_PIXELS,
                );
                itemBitmaps.push({ file, bitmap: decoded.bitmap });
            }
            reply(
                {
                    type: "flattened",
                    bitmap,
                    items: pack.manifest.items ?? [],
                    itemBitmaps,
                },
                [bitmap, ...itemBitmaps.map((i) => i.bitmap)],
            );
            return;
        }
        case "item": {
            const { bitmap } = await decodePng(
                request.bytes,
                undefined,
                undefined,
                UNIFORM_ITEM_MAX_PIXELS,
            );
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
            bitmap.close();
            await finishItem(canvas);
            return;
        }
        case "itemPixels": {
            const { width: w, height: h, pixels } = request;
            if (
                !Number.isInteger(w) ||
                !Number.isInteger(h) ||
                w < 1 ||
                h < 1 ||
                w * h > UNIFORM_ITEM_MAX_PIXELS ||
                pixels.length !== w * h * 4
            )
                throw new Refused("unreadable", "the drawn item's size");
            const canvas = new OffscreenCanvas(w, h);
            canvas
                .getContext("2d")!
                .putImageData(
                    new ImageData(
                        pixels as Uint8ClampedArray<ArrayBuffer>,
                        w,
                        h,
                    ),
                    0,
                    0,
                );
            await finishItem(canvas);
            return;
        }
        case "withItems": {
            const pack = readUniformPack(request.bytes);
            for (const [file, png] of Object.entries(request.files)) {
                const size = pngHeaderSize(png);
                if (
                    !size ||
                    size.width * size.height > UNIFORM_ITEM_MAX_PIXELS ||
                    Math.max(size.width, size.height) > UNIFORM_ITEM_MAX_SIDE
                )
                    throw new Refused("notPng", `${file} isn't an item image`);
            }
            let bytes: Uint8Array;
            try {
                bytes = packWithItems(pack, request.items, request.files);
            } catch (error) {
                throw new Refused(
                    "damaged",
                    error instanceof Error ? error.message : String(error),
                );
            }
            reply({ type: "packFile", bytes }, [bytes.buffer]);
            return;
        }
    }
}

onmessage = (event: MessageEvent<UniformPackRequest>) => {
    handle(event.data).catch((error: unknown) => {
        if (error instanceof Refused || error instanceof UniformPackError)
            reply({
                type: "refused",
                code: error.code,
                message: error.message,
            });
        else
            reply({
                type: "refused",
                code: "unreadable",
                message: error instanceof Error ? error.message : String(error),
            });
    });
};
