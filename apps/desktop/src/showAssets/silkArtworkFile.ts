/**
 * Reading a painted silk Artwork PNG the designer picks, and writing a silk template PNG: shared by
 * the 3D View's show Artwork (fork #973) and the show's flags in the Assets view (fork #985).
 * Browser only (Blob, createImageBitmap, OffscreenCanvas).
 */
import {
    SILK_ARTWORK_MAX_BYTES,
    SILK_ARTWORK_MAX_FILE_BYTES,
    SILK_ARTWORK_MAX_PIXELS,
    SILK_ARTWORK_MAX_PX,
    pngSize,
    type SilkArtworkImport,
} from "@/view3d/core/silkArtwork";

/** zlib deflate with the browser's own compressor, for the template PNG. */
export async function deflate(data: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([data as Uint8Array<ArrayBuffer>])
        .stream()
        .pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A picked file as an Artwork import, or the reason it can't be one. The
 * size comes from the PNG's header; an image longer than the silk texture
 * (`SILK_ARTWORK_MAX_PX`) is scaled down to it before the show stores it,
 * so a template painted at full size imports without a size limit getting
 * in the way.
 */
export async function readArtwork(
    file: File,
): Promise<SilkArtworkImport | "notPng" | "tooLarge"> {
    if (file.size > SILK_ARTWORK_MAX_FILE_BYTES) return "tooLarge";
    const original = new Uint8Array(await file.arrayBuffer());
    const size = pngSize(original);
    if (!size) return "notPng";
    if (size.width * size.height > SILK_ARTWORK_MAX_PIXELS) return "tooLarge";
    const scale = Math.min(
        1,
        SILK_ARTWORK_MAX_PX / Math.max(size.width, size.height),
    );
    if (scale === 1) {
        return original.length > SILK_ARTWORK_MAX_BYTES
            ? "tooLarge"
            : { name: file.name, data: original, ...size };
    }
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    const bitmap = await createImageBitmap(file, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: "high",
        premultiplyAlpha: "none",
    });
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const data = new Uint8Array(await blob.arrayBuffer());
    if (data.length > SILK_ARTWORK_MAX_BYTES) return "tooLarge";
    return { name: file.name, data, width, height };
}
