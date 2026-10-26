import { useLabVariant } from "@/lab/labVariant";

/**
 * How the floating editor looks while the pointer is elsewhere (#426 lab, owner comparing). It
 * turns solid on hover, with focus inside it and while one of its menus is open, and stays solid
 * on touch screens and for people who ask for less transparency (`ShapeEditorSurface.css`):
 * - `glass`: about 15% surface with a backdrop blur
 * - `clear`: about 10% surface, no blur
 * - `solid`: always solid, as before
 *
 * TEMPORARY: the lab's Version switch picks one. This is the only place that reads it, so the
 * winner is a one-line change here (and the losers' rules in the CSS go).
 */
export type EditorSurface = "glass" | "clear" | "solid";

const SURFACES: readonly EditorSurface[] = ["glass", "clear", "solid"];

/** The surface for lab version `variant`: glass unless it names another */
export function editorSurface(variant: string | null): EditorSurface {
    return SURFACES.find((s) => s === variant) ?? "glass";
}

export const useEditorSurface = (): EditorSurface =>
    editorSurface(useLabVariant());
