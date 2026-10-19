import type { NewItemArgs } from "@/db-functions/items";
import {
    normalizeOutlinePoints,
    PIXELS_PER_METER,
    type DrawnOutline,
} from "./itemOutlines";

/**
 * A new prop from an Outline drawn on the field: home at the Outline's center, on field from
 * `beatId`, sized in meters. It is a Floor prop: a drawn Outline has no height, and an obstacle
 * or platform needs one (props-spec section 5). A polygon, arc or freehand Outline keeps its drawn points,
 * size-free (see `CustomOutline`).
 */
export function newPropFromDrawing(
    outline: DrawnOutline,
    beatId: number,
): NewItemArgs {
    const custom = outline.points
        ? { points: normalizeOutlinePoints(outline) }
        : null;
    return {
        kind: "prop",
        surfaceType: "floor",
        home: [outline.centerX, outline.centerY],
        beatId,
        geometry: {
            outlineType: outline.outlineType,
            width: outline.widthPixels / PIXELS_PER_METER,
            depth: outline.depthPixels / PIXELS_PER_METER,
            customOutline: custom,
        },
    };
}
