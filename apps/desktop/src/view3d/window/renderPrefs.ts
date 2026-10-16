/**
 * How the 3D View draws on this computer, beside the quality
 * (`qualityPreference.ts`) and power choices (`drawPolicy.ts`). Like them it
 * describes the machine, not the show, so it lives in local storage (ADR 0002
 * D-5). The app's Settings window sets these; the 3D window reads them.
 *
 * - Resolution: the most device pixels drawn per screen pixel. `sharp`
 *   draws a HiDPI screen at its full 2x, `balanced` at 1.5x and `fast` at
 *   1x. `low` quality and battery saving draw at 1x whatever this says.
 * - Draw without a GPU: by default the window draws only on a GPU, since
 *   WebGL drawn in software runs the whole view on the CPU.
 */

export type Resolution = "sharp" | "balanced" | "fast";

export const RESOLUTIONS: readonly Resolution[] = ["sharp", "balanced", "fast"];

export const RESOLUTION_STORAGE_KEY = "view3d.resolution";
export const DRAW_WITHOUT_GPU_STORAGE_KEY = "view3d.drawWithoutGpu";

const MAX_PIXEL_RATIO: Record<Resolution, number> = {
    sharp: 2,
    balanced: 1.5,
    fast: 1,
};

/** The highest pixel ratio a resolution draws at. */
export function maxPixelRatio(resolution: Resolution): number {
    return MAX_PIXEL_RATIO[resolution];
}

export function parseResolution(value: unknown): Resolution {
    return RESOLUTIONS.includes(value as Resolution)
        ? (value as Resolution)
        : "sharp";
}

/** The saved choice, or `sharp` when there is none or storage is unavailable. */
export function loadResolution(storage?: Storage): Resolution {
    try {
        return parseResolution(
            (storage ?? window.localStorage).getItem(RESOLUTION_STORAGE_KEY),
        );
    } catch {
        return "sharp";
    }
}

export function saveResolution(resolution: Resolution, storage?: Storage) {
    try {
        (storage ?? window.localStorage).setItem(
            RESOLUTION_STORAGE_KEY,
            resolution,
        );
    } catch {
        // Private or blocked storage: the choice lasts for this session only.
    }
}

/** True only when the viewer turned it on. */
export function loadDrawWithoutGpu(storage?: Storage): boolean {
    try {
        return (
            (storage ?? window.localStorage).getItem(
                DRAW_WITHOUT_GPU_STORAGE_KEY,
            ) === "true"
        );
    } catch {
        return false;
    }
}

export function saveDrawWithoutGpu(on: boolean, storage?: Storage) {
    try {
        (storage ?? window.localStorage).setItem(
            DRAW_WITHOUT_GPU_STORAGE_KEY,
            String(on),
        );
    } catch {
        // Private or blocked storage: the choice lasts for this session only.
    }
}
