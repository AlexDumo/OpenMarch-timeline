import { create } from "zustand";

/**
 * The new field's view: how field units map to the field element's CSS
 * pixels. The one shared view store (ADR 0005 D-2.4): the WebGL camera, the
 * field test API and, later, the SVG overlay all read it, so they can't drift
 * apart.
 *
 * Field units are the timeline's (x right, y toward the front sideline). A
 * field point (x, y) sits at `(panX + x * zoom, panY + y * zoom)` CSS pixels
 * from the element's top-left corner.
 *
 * #192 only fits the field to the element. Zooming and panning (#194) write
 * the same state.
 */
export type FieldView = {
    /** The field element's size in CSS pixels. */
    width: number;
    height: number;
    /** CSS pixels per field unit. */
    zoom: number;
    /** Where field (0, 0) sits, in CSS pixels from the element's top-left. */
    panX: number;
    panY: number;
};

/** Field units of margin kept around the field when fitting, for its edge labels. */
export const FIT_MARGIN = 60;

/**
 * The view that shows the whole field, centered, with `margin` field units
 * around it.
 */
export function fitView(
    width: number,
    height: number,
    field: { width: number; height: number },
    margin = FIT_MARGIN,
): FieldView {
    const w = field.width + margin * 2;
    const h = field.height + margin * 2;
    const zoom =
        width > 0 && height > 0 && w > 0 && h > 0
            ? Math.min(width / w, height / h)
            : 1;
    return {
        width,
        height,
        zoom,
        panX: (width - field.width * zoom) / 2,
        panY: (height - field.height * zoom) / 2,
    };
}

/** A field point's position in the element, in CSS pixels. */
export function fieldToElement(
    view: FieldView,
    x: number,
    y: number,
): { x: number; y: number } {
    return { x: view.panX + x * view.zoom, y: view.panY + y * view.zoom };
}

/** The field point at a position in the element, in CSS pixels: the inverse of {@link fieldToElement}. */
export function elementToField(
    view: FieldView,
    x: number,
    y: number,
): { x: number; y: number } {
    return { x: (x - view.panX) / view.zoom, y: (y - view.panY) / view.zoom };
}

/**
 * The orthographic camera bounds, in field units, that draw `view`. `top` is
 * less than `bottom` because field y grows downward on screen.
 */
export function cameraBounds(view: FieldView) {
    const { width, height, zoom, panX, panY } = view;
    return {
        left: -panX / zoom,
        right: (width - panX) / zoom,
        top: -panY / zoom,
        bottom: (height - panY) / zoom,
    };
}

export const useFieldViewStore = create<FieldView>(() => ({
    width: 0,
    height: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
}));
