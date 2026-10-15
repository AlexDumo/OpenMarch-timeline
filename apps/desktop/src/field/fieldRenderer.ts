/**
 * The hidden dev switch between the Fabric field and the three.js field
 * (ADR 0005, fork ticket #192). Fabric is the default. The switch is removed
 * when the new field replaces Fabric (#209).
 *
 * Turn the new field on with either:
 * - `localStorage.setItem("openmarch:dev:field", "three")`, then reload;
 * - `?field=three` in the page's URL (the browser builds).
 *
 * Anything else, or nothing, means Fabric. The choice is read once, when the
 * app starts.
 */
export type FieldRenderer = "fabric" | "three";

export const FIELD_RENDERER_STORAGE_KEY = "openmarch:dev:field";

const parse = (value: string | null | undefined): FieldRenderer | null =>
    value === "three" || value === "fabric" ? value : null;

let chosen: FieldRenderer | null = null;

/** The field renderer this session uses. */
export function fieldRenderer(): FieldRenderer {
    if (chosen) return chosen;
    let fromUrl: FieldRenderer | null = null;
    let fromStorage: FieldRenderer | null = null;
    try {
        fromUrl = parse(
            new URLSearchParams(window.location.search).get("field"),
        );
        fromStorage = parse(localStorage.getItem(FIELD_RENDERER_STORAGE_KEY));
    } catch {
        // No window or storage (tests, a locked-down browser): Fabric.
    }
    chosen = fromUrl ?? fromStorage ?? "fabric";
    return chosen;
}
