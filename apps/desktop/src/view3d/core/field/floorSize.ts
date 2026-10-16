/**
 * The physical size of a show's floor made from its legacy field image (ADR 0002 D-23, convert
 * on open): the image placed on the field the way 2D and 3D draw it (`planImage`, fill or fit),
 * so the floor keeps the image's shape and lands where the image was.
 */
import { fieldFootprint, type FieldProperties } from "@openmarch/core";
import { planImage } from "./imagePlan";
import type { ImageSize } from "./plan";

export interface FloorSize {
    widthM: number;
    heightM: number;
}

export function floorSizeForImage(
    fieldProperties: FieldProperties,
    image: ImageSize,
): FloorSize {
    const placed = planImage({ fieldProperties }, image, 1);
    return {
        widthM: placed.maxX - placed.minX,
        heightM: placed.maxZ - placed.minZ,
    };
}

/** The field's own size, which "Upload floor…" pre-fills the import review with (Q82). */
export function fieldFloorSize(fieldProperties: FieldProperties): FloorSize {
    const f = fieldFootprint(fieldProperties);
    return { widthM: f.maxX - f.minX, heightM: f.maxZ - f.minZ };
}
