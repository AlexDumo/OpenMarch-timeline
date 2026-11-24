/**
 * The uniform pack worker (fork #1257; ADR 0010 amendment 2026-11-24). Decodes the images a
 * uniform import is given, and the layers a show's pack holds, so the window never decodes an
 * untrusted file. It runs under its own policy (`src/security/appCsp.ts`): its own script and
 * nothing else, no network, no `eval`, no WebAssembly.
 *
 * Bytes in, bytes out: a PNG's size is read from its header and checked before anything decodes
 * it, and the window ends the worker after one job.
 */
import {
    FLATS_PAGE_DPI,
    FLATS_PAGE_PX,
    UNIFORM_LAYER_MAX_PIXELS,
    pngHeaderSize,
} from "@/view3d/core/uniformPack/format";
import {
    pageNotes,
    type PageRegions,
} from "@/view3d/core/uniformPack/pageChecks";
import type { UniformPackRequest, UniformPackResponse } from "./protocol";

const reply = (message: UniformPackResponse, transfer: Transferable[] = []) =>
    postMessage(message, { transfer });

class Refused extends Error {
    constructor(
        readonly code: "notPng" | "tooLarge" | "unreadable",
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
    premultiply: boolean,
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
                premultiplyAlpha: premultiply ? "premultiply" : "none",
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

/** Checks a page's pixels and encodes them as the pack's PNG */
async function finishPage(
    canvas: OffscreenCanvas,
    regions: PageRegions,
    scaledFrom: { width: number; height: number } | null,
) {
    const { width, height } = canvas;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const notes = pageNotes(pixels, width, height, FLATS_PAGE_DPI, regions);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const png = new Uint8Array(await blob.arrayBuffer());
    reply({ type: "page", png, notes, scaledFrom }, [png.buffer]);
}

async function handle(request: UniformPackRequest) {
    const { width, height } = FLATS_PAGE_PX;
    if (request.type === "png") {
        const { bitmap, source } = await decodePng(
            request.bytes,
            width,
            height,
            false,
        );
        const canvas = new OffscreenCanvas(width, height);
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
        const scaled =
            source.width !== width || source.height !== height ? source : null;
        await finishPage(canvas, request.regions, scaled);
        return;
    }
    if (request.type === "pixels") {
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
    const w = Math.max(1, Math.min(8192, Math.round(request.width)));
    const h = Math.max(1, Math.min(8192, Math.round(request.height)));
    const { bitmap } = await decodePng(request.png, w, h, true);
    reply({ type: "bitmap", bitmap }, [bitmap]);
}

onmessage = (event: MessageEvent<UniformPackRequest>) => {
    handle(event.data).catch((error: unknown) => {
        if (error instanceof Refused)
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
