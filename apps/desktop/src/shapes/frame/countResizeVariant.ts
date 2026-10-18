/**
 * The 2026-10-18 A/B on what a new count does to a box (docs/timeline/research/shapes/
 * 08-shape-system-ux.md): "keep-spacing" (A, the default) grows or shrinks the box around its
 * center; "keep-size" (B) keeps the box's size and refits the spacing. Set by the study through
 * localStorage; to be settled by the owner, then this goes.
 */
export const COUNT_RESIZE_KEY = "openmarch.boxCountResize";

export function countKeepsSize(): boolean {
    try {
        return localStorage.getItem(COUNT_RESIZE_KEY) === "keep-size";
    } catch {
        return false;
    }
}
