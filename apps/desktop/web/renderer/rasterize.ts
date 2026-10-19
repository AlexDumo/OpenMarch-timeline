/**
 * Draws an SVG, or a PDF's first page, as a PNG for the worker (`PAGE_CHANNELS.rasterizeImage`),
 * which has no DOM: a legacy field image that is an SVG or a PDF becomes the show's floor in the
 * web build too (ADR 0002 D-23). pdf.js loads only for a PDF.
 */
import type { RasterizedImage } from "../protocol";

/** `width` × `height` scaled so the long edge is `long`. */
function scaledTo(width: number, height: number, long: number) {
    const scale = long / Math.max(width, height);
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
    const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("The image couldn't be drawn");
    return new Uint8Array(await blob.arrayBuffer());
}

async function rasterizeSvg(
    bytes: Uint8Array,
    long: number,
): Promise<RasterizedImage> {
    const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: "image/svg+xml" }),
    );
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        // An SVG without its own size draws at the browser's default, 300 × 150
        const natural = {
            width: image.naturalWidth || 300,
            height: image.naturalHeight || 150,
        };
        const size = scaledTo(natural.width, natural.height, long);
        const canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No 2D canvas in this browser");
        context.drawImage(image, 0, 0, size.width, size.height);
        return { png: await canvasPng(canvas), ...size, pageCount: 1 };
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function rasterizePdf(
    bytes: Uint8Array,
    long: number,
): Promise<RasterizedImage> {
    const [pdfjs, { default: workerUrl }] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const task = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        enableXfa: false,
    });
    try {
        const doc = await task.promise;
        const page = await doc.getPage(1);
        const unit = page.getViewport({ scale: 1 });
        const size = scaledTo(unit.width, unit.height, long);
        const viewport = page.getViewport({ scale: size.width / unit.width });
        const canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No 2D canvas in this browser");
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        return {
            png: await canvasPng(canvas),
            ...size,
            pageCount: doc.numPages,
        };
    } finally {
        await task.destroy();
    }
}

export function rasterizeImage(
    bytes: Uint8Array,
    format: "svg" | "pdf",
    long: number,
): Promise<RasterizedImage> {
    if (!(bytes instanceof Uint8Array)) throw new Error("Not an image");
    if (!Number.isInteger(long) || long < 1 || long > 16384)
        throw new Error("Not a size to draw at");
    return format === "pdf"
        ? rasterizePdf(bytes, long)
        : rasterizeSvg(bytes, long);
}
