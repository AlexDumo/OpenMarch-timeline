import {
    DEGREE,
    pivotPoint,
    type PivotKey,
    type ShapeFrame,
} from "../frame/frame";
import type { XY } from "../types";

/**
 * Turning and flipping a plain selection, one that isn't a shape (#349): the marchers' positions
 * change and nothing else, no recipe. Its frame is the box around them, square to the field, so
 * the Transform section's pivot grid means the same as on a shape. Everything here is pure.
 */

/** The box around `points`, square to the field; null with none */
export function selectionFrame(points: readonly XY[]): ShapeFrame | null {
    if (points.length === 0) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    return {
        center: { x: (left + right) / 2, y: (top + bottom) / 2 },
        halfWidth: (right - left) / 2,
        halfDepth: (bottom - top) / 2,
        rotation: 0,
        flipX: false,
        flipY: false,
    };
}

/** Where `pivot` is on the box around `points` */
export function selectionPivot(
    points: readonly XY[],
    pivot: PivotKey,
): XY | null {
    const frame = selectionFrame(points);
    return frame && pivotPoint(frame, pivot);
}

/**
 * `points` mirrored side to side (`across`) or front to back (`deep`) about a line through
 * `pivot`, in the same order
 */
export function flipSelection<P extends XY>(
    points: readonly P[],
    axis: "across" | "deep",
    pivot: PivotKey,
): P[] {
    const at = selectionPivot(points, pivot);
    if (!at) return [];
    return points.map((p) =>
        axis === "across"
            ? { ...p, x: 2 * at.x - p.x }
            : { ...p, y: 2 * at.y - p.y },
    );
}

/** `points` turned `degrees` clockwise on screen about `pivot`, in the same order */
export function turnSelection<P extends XY>(
    points: readonly P[],
    degrees: number,
    pivot: PivotKey,
): P[] {
    const at = selectionPivot(points, pivot);
    if (!at) return [];
    const c = Math.cos(degrees * DEGREE);
    const s = Math.sin(degrees * DEGREE);
    return points.map((p) => {
        const dx = p.x - at.x;
        const dy = p.y - at.y;
        return { ...p, x: at.x + dx * c - dy * s, y: at.y + dx * s + dy * c };
    });
}
