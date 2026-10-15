/**
 * The field test API: one read-only view of the field for the browser scenario
 * harness (`e2e/browser`), so the same scenarios run against any field renderer.
 *
 * It says what the field shows, never how it's drawn. Keep this file free of
 * renderer imports: each field renderer implements it and installs it with
 * `installFieldTestApi`.
 *
 * Units: field positions are in field units, as the timeline stores them.
 * Screen positions are CSS pixels in the window's viewport, ready for mouse
 * events.
 */

/** A point in viewport CSS pixels. */
export type ScreenPoint = { x: number; y: number };

export type FieldTestMarcher = {
    id: number;
    /** The marcher's label text, as drawn on the field (its drill number). */
    label: string;
    /** Where the dot is drawn, in field units. */
    x: number;
    y: number;
    /** The dot's center in the viewport. */
    screen: ScreenPoint;
    /** False when the dot is scrolled out of the visible field. */
    onScreen: boolean;
};

export type FieldTestHandle =
    | "nw"
    | "n"
    | "ne"
    | "e"
    | "se"
    | "s"
    | "sw"
    | "w"
    | "rot";

/**
 * What the user is doing on the field right now. `line` covers the whole line
 * tool, from choosing it until it applies or cancels.
 */
export type FieldTestGesture =
    | "marquee"
    | "lasso"
    | "move"
    | "scale"
    | "rotate"
    | "pan"
    | "line";

export interface FieldTestApi {
    /** Every marcher drawn on the field. */
    marchers(): FieldTestMarcher[];
    /** The ids of the selected marchers, ascending. */
    selection(): number[];
    /**
     * `zoom` is screen pixels per field unit; `pan` is where field point (0, 0)
     * sits, in CSS pixels from the field's top-left corner.
     */
    viewport(): { zoom: number; pan: { x: number; y: number } };
    /** The selection box's handles, or null when none are shown. */
    handles(): Record<FieldTestHandle, ScreenPoint> | null;
    /** The gesture in progress, or null. */
    activeGesture(): FieldTestGesture | null;
    /** The id of the page the field shows, or null before one is shown. */
    pageId(): number | null;
}

declare global {
    // eslint-disable-next-line no-unused-vars
    interface Window {
        /** The field test API of the field on screen; see `fieldTestApi.ts`. */
        fieldTest?: FieldTestApi;
    }
}

/** Makes `api` the page's field test API (`window.fieldTest`). */
export function installFieldTestApi(api: FieldTestApi | undefined) {
    window.fieldTest = api;
}
