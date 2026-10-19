import { pixelsToWorld } from "@openmarch/core";
import type { ImageSize, PlanContext, PlanImage } from "./plan";

/**
 * Places the field background image like the 2D field (`planFieldImage`):
 * "fit" shows the whole
 * image inside the field's canvas rectangle, "fill" covers the rectangle and
 * crops the overflow (the painter clips to the surface). Anything other than
 * "fill" is treated as "fit", as in 2D.
 */
export function planImage(
    ctx: Pick<PlanContext, "fieldProperties">,
    image: ImageSize,
    opacity: number,
): PlanImage {
    const fp = ctx.fieldProperties;
    const { width, height } = fp;
    if (image.sizeM) {
        // A floor at its physical size, centered on the canvas like 2D's `floorPlacement`
        const center = pixelsToWorld(fp, { x: width / 2, y: height / 2 });
        const { widthM, heightM } = image.sizeM;
        return {
            type: "image",
            role: "image",
            minX: center.x - widthM / 2,
            maxX: center.x + widthM / 2,
            minZ: center.z - heightM / 2,
            maxZ: center.z + heightM / 2,
            opacity,
        };
    }
    const imgAspect = image.width / image.height;
    const canvasAspect = width / height;
    const fill = fp.imageFillOrFit === "fill";
    // "fill" scales to the axis that overflows; "fit" to the one that fits.
    const byHeight = fill
        ? imgAspect > canvasAspect
        : imgAspect <= canvasAspect;
    const scale = byHeight ? height / image.height : width / image.width;
    const left = byHeight ? (width - image.width * scale) / 2 : 0;
    const top = byHeight ? 0 : (height - image.height * scale) / 2;
    const a = pixelsToWorld(fp, { x: left, y: top });
    const b = pixelsToWorld(fp, {
        x: left + image.width * scale,
        y: top + image.height * scale,
    });
    return {
        type: "image",
        role: "image",
        minX: a.x,
        maxX: b.x,
        minZ: a.z,
        maxZ: b.z,
        opacity,
    };
}
