import type { FieldView } from "@/field/editor/view";
import { fieldToElement } from "@/field/three/fieldView";
import type { XY } from "../types";
import { editorPlacement, type Placement } from "./editorPlacement";

/**
 * Keeping the shape and its floating editor in view after a discrete edit (#441, owner: a turned
 * box went partly off the canvas unnoticed). Two lab versions: "Keep in view" pans just far enough
 * to bring the shape and the editor back, like scrollIntoView's "nearest"; "Hold the editor still"
 * pans so the editor stays where it was on screen. Pure: the floating editor glides the view by
 * what these return. Only pans, never zooms.
 */

/** Room kept between the shape or editor and the field's edges, in CSS px */
export const VIEW_MARGIN_PX = 24;

/** The lab versions (`lab/shape-keep-in-view`); no version is "Keep in view" */
export type ViewFollow = "keep" | "hold";
export const viewFollowFor = (variant: string | null): ViewFollow =>
    variant === "hold-editor" ? "hold" : "keep";

export interface Pan {
    readonly dx: number;
    readonly dy: number;
}

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
 * doesn't fit, `shapeLo`..`shapeHi` (the shape alone) is centered instead.
 */
function nearest(
    lo: number,
    hi: number,
    size: number,
    margin: number,
    shapeLo: number,
    shapeHi: number,
): number {
    if (hi - lo > size - 2 * margin) return size / 2 - (shapeLo + shapeHi) / 2;
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

/** Where the editor goes with the view panned by `pan` */
const placedAt = (input: KeepInViewInput, pan: Pan) => {
    const view = {
        ...input.view,
        panX: input.view.panX + pan.dx,
        panY: input.view.panY + pan.dy,
    };
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
 * "Keep in view": the pan that brings the shape's outline and the editor inside the field with a
 * margin, as little as it takes; none when both are in view. A shape bigger than the view is
 * centered. The editor flips above or below with the pan, so it is worked out again from the
 * panned view a few times. Side to side only the shape counts, as the editor keeps itself inside.
 */
export function keepInViewPan(input: KeepInViewInput): Pan {
    const margin = input.margin ?? VIEW_MARGIN_PX;
    const { width: w, height: h } = input.view;
    let pan: Pan = { dx: 0, dy: 0 };
    for (let i = 0; i < 3; i++) {
        const { shape, editor } = placedAt(input, pan);
        // The editor keeps itself inside the field side to side: only its height counts
        const top = Math.min(shape.top, editor.top);
        const bottom = Math.max(shape.bottom, editor.top + input.height);
        const dx = nearest(
            shape.left,
            shape.right,
            w,
            margin,
            shape.left,
            shape.right,
        );
        const dy = nearest(top, bottom, h, margin, shape.top, shape.bottom);
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
        pan = { dx: pan.dx + dx, dy: pan.dy + dy };
    }
    return pan;
}

/**
 * "Hold the editor still": the pan that puts the editor back at `shown`, where it sat on screen
 * before the change. It is centered under the shape, so a width that changes later keeps its
 * middle there. Worked out again from the panned view a few times, since the editor is kept
 * inside the field side to side and flips above or below.
 */
export function holdEditorPan(
    input: KeepInViewInput,
    shown: Pick<Placement, "left" | "top">,
): Pan {
    let pan: Pan = { dx: 0, dy: 0 };
    for (let i = 0; i < 3; i++) {
        const { editor } = placedAt(input, pan);
        const dx = shown.left - editor.left;
        const dy = shown.top - editor.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
        pan = { dx: pan.dx + dx, dy: pan.dy + dy };
    }
    return pan;
}
