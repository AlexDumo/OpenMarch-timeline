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
    UNIFORM_LAYER_MAX_PIXELS,
    UniformPackError,
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

/** A PNG's bitmap at `width` × `height`, after its header is checked */
async function decodePng(
    bytes: Uint8Array,
    width: number,
    height: number,
): Promise<{ bitmap: ImageBitmap; source: { width: number; height: number } }> {
    const source = pngHeaderSize(bytes);
    if (!source) throw new Refused("notPng", "not a PNG");
    if (source.width * source.height > UNIFORM_LAYER_MAX_PIXELS)
        throw new Refused(
            "tooLarge",
            `${source.width} × ${source.height} px is over ${UNIFORM_LAYER_MAX_PIXELS} pixels`,
        );
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
            reply({ type: "pack", manifest: pack.manifest, notes });
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
            reply({ type: "bitmap", bitmap }, [bitmap]);
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
