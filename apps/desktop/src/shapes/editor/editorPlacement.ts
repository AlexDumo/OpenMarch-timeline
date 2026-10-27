import type { XY } from "../types";

/**
 * Where the floating editor goes (#437, owner: predictable motion). Pure: the hook in
 * `ShapeEditorBar` springs the editor to it. Two versions are tried in the lab:
 *
 * - **Glide** (default): under the shape's outline, centered, above it when there's no room
 *   below; the editor follows every change, springing there.
 * - **Steady**: an anchor that rarely changes. Centered on the shape's frame center, under the
 *   circle round its outline (so turning doesn't move it), and it only flips above or back with
 *   clear room to spare.
 */
export type EditorMotion = "glide" | "steady";

/** The gap between the shape's outline and the editor, in CSS px */
export const GAP_PX = 14;
/** Room the spots' radius and the handles take beyond the outline */
const CLEAR_PX = 6;
/** Steady: how much room past the editor's own height it takes to flip */
export const FLIP_MARGIN_PX = 24;
/** Kept inside the field side to side */
const MARGIN_PX = 4;

export interface PlacementInput {
    readonly motion: EditorMotion;
    /** The shape's outline in the field element's px */
    readonly outline: readonly XY[];
    /** The shape's frame center in the field element's px */
    readonly center: XY;
    /** The editor's size */
    readonly width: number;
    readonly height: number;
    /** The field element's size */
    readonly fieldWidth: number;
    readonly fieldHeight: number;
    /** Whether it sat above the shape last time (Steady's flip waits for clear room) */
    readonly wasAbove: boolean;
}

export interface Placement {
    readonly left: number;
    readonly top: number;
    readonly above: boolean;
}

export function editorPlacement(input: PlacementInput): Placement {
    const pad = GAP_PX + CLEAR_PX;
    const { width, height, fieldWidth, fieldHeight } = input;
    let x: number;
    let below: number;
    let over: number;
    if (input.motion === "steady") {
        const r = Math.max(
            0,
            ...input.outline.map((p) =>
                Math.hypot(p.x - input.center.x, p.y - input.center.y),
            ),
        );
        x = input.center.x;
        below = input.center.y + r + pad;
        over = input.center.y - r - pad - height;
    } else {
        const xs = input.outline.map((p) => p.x);
        const ys = input.outline.map((p) => p.y);
        x = (Math.min(...xs) + Math.max(...xs)) / 2;
        below = Math.max(...ys) + pad;
        over = Math.min(...ys) - pad - height;
    }
    const roomBelow = fieldHeight - (below + height);
    const roomAbove = over;
    let above: boolean;
    if (input.motion === "steady") {
        // Flips only with clear room on the other side, and back the same way
        above = input.wasAbove
            ? !(roomBelow >= FLIP_MARGIN_PX)
            : roomBelow < -FLIP_MARGIN_PX && roomAbove >= FLIP_MARGIN_PX;
    } else {
        above = roomBelow < 0 && roomAbove > 0;
    }
    const left = Math.max(
        MARGIN_PX,
        Math.min(x - width / 2, fieldWidth - width - MARGIN_PX),
    );
    return { left, top: above ? over : below, above };
}
