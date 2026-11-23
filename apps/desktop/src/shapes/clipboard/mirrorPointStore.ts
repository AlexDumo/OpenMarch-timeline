import type { XY } from "../types";

/**
 * Where the last mirrored paste's mirror point was (Paste mirrored), so the next one opens
 * through the same point: mirroring several groups across the same line takes one key each. Kept
 * in localStorage with the copied picture, in field units, per field size.
 */
export const MIRROR_POINT_STORAGE_KEY = "openmarch:mirrorPoint";

interface Stored {
    readonly x: number;
    readonly y: number;
    /** The field's size when it was kept: a point from another field isn't used */
    readonly width: number;
    readonly height: number;
}

/** The mirror point last used on a field `width` by `height`, or null */
export function lastMirrorPoint(width: number, height: number): XY | null {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem(MIRROR_POINT_STORAGE_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw) as Partial<Stored>;
        if (
            typeof s.x !== "number" ||
            typeof s.y !== "number" ||
            !Number.isFinite(s.x) ||
            !Number.isFinite(s.y) ||
            s.width !== width ||
            s.height !== height ||
            s.x < 0 ||
            s.x > width ||
            s.y < 0 ||
            s.y > height
        )
            return null;
        return { x: s.x, y: s.y };
    } catch {
        return null;
    }
}

/** Keeps `point` as the mirror point the next Paste mirrored opens through */
export function keepMirrorPoint(
    point: XY,
    width: number,
    height: number,
): void {
    if (typeof localStorage === "undefined") return;
    try {
        const stored: Stored = { x: point.x, y: point.y, width, height };
        localStorage.setItem(MIRROR_POINT_STORAGE_KEY, JSON.stringify(stored));
    } catch {
        // Storage full or blocked: the next one opens through the field's center
    }
}
