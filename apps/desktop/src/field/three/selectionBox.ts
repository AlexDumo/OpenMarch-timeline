import type { FieldRect } from "@/field/editor/selectionArea";
import type { FieldMarchers } from "./fieldMarchers";
import { ringReach } from "./selectionRing";

/** CSS px between the selection rings and the selection box. */
const BOX_GAP = 3;

/**
 * The bounds of the selected marchers, in field units, or null when fewer
 * than two are selected (a single marcher gets its ring and no box).
 */
export function selectedBounds(marchers: FieldMarchers): FieldRect | null {
    const { selected, positions } = marchers;
    let count = 0;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let i = 0; i < selected.length; i++) {
        if (!selected[i]) continue;
        count++;
        const x = positions[i * 2];
        const y = positions[i * 2 + 1];
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
    }
    return count < 2 ? null : { left, top, right, bottom };
}

/** How far the box sits outside the selection's bounds at `zoom`, in field units: clear of the rings. */
export const boxPadding = (zoom: number) => ringReach(zoom) + BOX_GAP / zoom;

/** The selection box as the overlay draws it, in field units, or null when none is drawn. */
export function selectionBox(
    marchers: FieldMarchers,
    zoom: number,
): FieldRect | null {
    const bounds = selectedBounds(marchers);
    if (!bounds) return null;
    const pad = boxPadding(zoom);
    return {
        left: bounds.left - pad,
        top: bounds.top - pad,
        right: bounds.right + pad,
        bottom: bounds.bottom + pad,
    };
}
