import { clampZoom, type FieldView } from "@/field/editor/view";
import { fieldToElement } from "@/field/three/fieldView";
import type { XY } from "../types";
import { CLEAR_PX, editorPlacement, GAP_PX } from "./editorPlacement";

/**
 * Keeping the shape and its floating editor in view after a discrete edit (#441, owner: a turned
 * box went partly off the canvas unnoticed; the owner picked "Keep in view" in the lab over
 * holding the editor still). The view pans just far enough to bring the shape and the editor
 * back, like scrollIntoView's "nearest", and zooms out just enough when they no longer fit, never
 * in. Pure: the floating editor glides the view to what this returns.
 */

/** Room kept between the shape or editor and the field's edges, in CSS px */
export const VIEW_MARGIN_PX = 24;

interface Box {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

const boxOf = (points: readonly XY[]): Box => {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return {
        left: Math.min(...xs),
        top: Math.min(...ys),
        right: Math.max(...xs),
        bottom: Math.max(...ys),
    };
};

/**
 * How far to move `lo`..`hi` to be inside 0..`size` with `margin` to spare, nearest first. When it
 * doesn't fit (at the field's least zoom), `shapeLo`..`shapeHi` (the shape alone) is centered.
 */
function nearest(
    lo: number,
    hi: number,
    size: number,
    margin: number,
    shapeLo: number,
    shapeHi: number,
): number {
    if (hi - lo > size - 2 * margin + 0.5)
        return size / 2 - (shapeLo + shapeHi) / 2;
    if (lo < margin) return margin - lo;
    if (hi > size - margin) return size - margin - hi;
    return 0;
}

export interface KeepInViewInput {
    readonly view: FieldView;
    /** The shape's outline in field units */
    readonly outline: readonly XY[];
    /** The editor's size, in CSS px */
    readonly width: number;
    readonly height: number;
    readonly margin?: number;
}

/** The shape's box and the editor's place in `view` */
const placedIn = (input: KeepInViewInput, view: FieldView) => {
    const outline = input.outline.map((p) => fieldToElement(view, p.x, p.y));
    const editor = editorPlacement({
        outline,
        width: input.width,
        height: input.height,
        fieldWidth: view.width,
        fieldHeight: view.height,
    });
    return { shape: boxOf(outline), editor };
};

/**
 * The zoom at which the shape and its editor fit the field with `margin` on each side: the shape
 * across (the editor keeps itself inside side to side), and the shape, the gap and the editor
 * down. Never more than `view`'s zoom, and never under the field's least zoom.
 */
function fittingZoom(input: KeepInViewInput, margin: number): number {
    const { view } = input;
    const field = boxOf(input.outline);
    const across = field.right - field.left;
    const deep = field.bottom - field.top;
    const roomAcross = view.width - 2 * margin;
    const roomDeep =
        view.height - 2 * margin - GAP_PX - CLEAR_PX - input.height;
    let zoom = view.zoom;
    if (across > 0) zoom = Math.min(zoom, roomAcross / across);
    if (deep > 0) zoom = Math.min(zoom, roomDeep / deep);
    return Math.min(view.zoom, clampZoom(zoom));
}

/**
 * The view that brings the shape's outline and the editor inside the field with a margin, as
 * little as it takes: `view` itself when both are in view. When they don't fit, it zooms out just
 * enough about the shape's middle, never in; a shape still too big at the least zoom is
 * centered. The editor flips above or below as the view moves, so the pan is worked out again a
 * few times.
 */
export function keepInView(input: KeepInViewInput): FieldView {
    const margin = input.margin ?? VIEW_MARGIN_PX;
    let view = input.view;
    const zoom = fittingZoom(input, margin);
    if (zoom < view.zoom) {
        // About the shape's middle, so it stays where it was as much as it can
        const { shape } = placedIn(input, view);
        const cx = (shape.left + shape.right) / 2;
        const cy = (shape.top + shape.bottom) / 2;
        const ratio = zoom / view.zoom;
        view = {
            ...view,
            zoom,
            panX: cx - (cx - view.panX) * ratio,
            panY: cy - (cy - view.panY) * ratio,
        };
    }
    for (let i = 0; i < 3; i++) {
        const { shape, editor } = placedIn(input, view);
        const top = Math.min(shape.top, editor.top);
        const bottom = Math.max(shape.bottom, editor.top + input.height);
        const dx = nearest(
            shape.left,
            shape.right,
            view.width,
            margin,
            shape.left,
            shape.right,
        );
        const dy = nearest(
            top,
            bottom,
            view.height,
            margin,
            shape.top,
            shape.bottom,
        );
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
        view = { ...view, panX: view.panX + dx, panY: view.panY + dy };
    }
    return view;
}
