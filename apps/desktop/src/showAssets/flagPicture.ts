/**
 * A flag's small picture (fork #985): its silk, cut to its shape and painted with its Artwork,
 * hanging from the top of a pole on the left. Stored with the flag as its `thumbnail` part, and
 * shown wherever the flag is named: the Assets view, the equipment menus, and the 2D field's
 * equipment icons, so a designer can tell at a glance who holds which flag.
 *
 * Browser only (createImageBitmap, OffscreenCanvas, Path2D).
 */
import { silkArtworkTrimRect } from "@/view3d/core/silkArtwork";
import { silkShapeSurface } from "@/view3d/core/artworkTemplates";
import { cutPathBounds, cutPathData } from "@/view3d/core/sizes/silkCuts";
import { silkShape, type SilkShapeId } from "@/view3d/core/sizes/silkShapes";

/** The picture's width and height in pixels: drawn small, so a few sizes of mipmaps are enough */
export const FLAG_PICTURE_PX = 128;

/** Where a flag's parts sit in its picture, in pixels: shared with tests and the drawing */
export function flagPictureLayout(shape: SilkShapeId, px = FLAG_PICTURE_PX) {
    const { path } = silkShape(shape);
    const b = cutPathBounds(path);
    const pad = Math.round(px * 0.04);
    const pole = Math.max(2, Math.round(px * 0.06));
    const boxX = pad + pole;
    const boxW = px - boxX - pad;
    const boxH = px - 2 * pad;
    const silkW = b.maxX - b.minX;
    const silkH = b.maxY - b.minY;
    const scale = Math.min(boxW / silkW, boxH / silkH);
    return {
        pad,
        pole,
        scale,
        // the silk's header at the top of the pole, its pole edge against it
        silkX: boxX - b.minX * scale,
        silkY: pad - b.minY * scale,
    };
}

/**
 * Draws a flag's picture as PNG bytes: `artwork` (a PNG painted on the shape's template, or any
 * image, which is stretched over the silk) cut to `shape`.
 */
export async function drawFlagPicture(
    artwork: Uint8Array,
    shape: SilkShapeId,
    px = FLAG_PICTURE_PX,
): Promise<Uint8Array> {
    const bitmap = await createImageBitmap(
        new Blob([artwork as Uint8Array<ArrayBuffer>], { type: "image/png" }),
        { premultiplyAlpha: "none" },
    );
    try {
        const canvas = new OffscreenCanvas(px, px);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("No 2D canvas for the flag's picture");
        const silk = silkShape(shape);
        const surface = silkShapeSurface(silk);
        const trim = silkArtworkTrimRect(bitmap.width, bitmap.height, surface);
        const { pad, pole, scale, silkX, silkY } = flagPictureLayout(shape, px);

        // The pole: mid grey with a darker edge, seen on light and dark fields alike
        ctx.fillStyle = "#9a9a9a";
        ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(pad, pad, pole, px - 2 * pad, pole / 2);
        ctx.fill();
        ctx.stroke();

        // The silk: the Artwork's trim laid over the template's box, cut to the outline
        ctx.save();
        ctx.translate(silkX, silkY);
        ctx.scale(scale, scale);
        const outline = new Path2D(cutPathData(silk.path));
        ctx.save();
        ctx.clip(outline, "evenodd");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(
            bitmap,
            trim.x * bitmap.width,
            trim.y * bitmap.height,
            trim.width * bitmap.width,
            trim.height * bitmap.height,
            0,
            0,
            surface.width.m,
            surface.height.m,
        );
        ctx.restore();
        ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
        ctx.lineWidth = 1.5 / scale;
        ctx.lineJoin = "round";
        ctx.stroke(outline);
        ctx.restore();

        const blob = await canvas.convertToBlob({ type: "image/png" });
        return new Uint8Array(await blob.arrayBuffer());
    } finally {
        bitmap.close();
    }
}
