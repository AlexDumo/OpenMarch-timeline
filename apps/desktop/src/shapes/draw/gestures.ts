import { dist, mid } from "../geometry/vec";
import type { ArcParams } from "../kinds/arc";
import type { BlockParams } from "../kinds/block";
import type { CircleParams } from "../kinds/circle";
import type { CurveParams } from "../kinds/curve";
import type { LineParams } from "../kinds/line";
import type { XY } from "../types";

/**
 * Drawing a shape on the field (owner decisions, 2026-10-11): each kind has a gesture, and the
 * gesture sets the kind's points. Everything else in the params (spacing, pattern, order) is kept
 * from the shape being redrawn, so a locked interval carries over and the session settles the
 * size to it afterwards.
 *
 * - Line: drag end to end.
 * - Arc: drag the chord; a default bend toward the front, adjusted with its handle.
 * - Circle: drag from the center to the rim (the rim point is where the first marcher stands).
 * - Box (block): drag corner to corner.
 * - Curve: click its points.
 */

/** How a kind is drawn: a drag, or clicked points */
export type GestureKind = "drag" | "clicks";

export const GESTURES: Readonly<Record<string, GestureKind>> = {
    line: "drag",
    arc: "drag",
    circle: "drag",
    block: "drag",
    curve: "clicks",
};

/** The handle that plays the dragged end, so a locked interval keeps the start where it was put */
export const DRAGGED_HANDLE: Readonly<Record<string, string>> = {
    line: "b",
    arc: "b",
    circle: "radius",
};

/**
 * The params a drag from `from` to `to` draws, built on `base` (the shape being redrawn).
 * Undefined when the kind isn't drawn by dragging, or the drag is too short to mean anything.
 *
 * @param n the number of marchers, for how a box's ranks and files split
 */
export function paramsFromDrag(
    kindId: string,
    base: unknown,
    from: XY,
    to: XY,
    n: number,
): unknown {
    if (dist(from, to) < 1e-6) return undefined;
    switch (kindId) {
        case "line":
            return { ...(base as LineParams), a: from, b: to };
        case "circle":
            return {
                ...(base as CircleParams),
                center: from,
                r: dist(from, to),
                start: Math.atan2(to.y - from.y, to.x - from.x),
            };
        case "arc": {
            // The chord's normal, turned toward the front (+y), as the arc's own fit bends it
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const length = Math.hypot(dx, dy);
            const towardFront = dx >= 0 ? 1 : -1;
            return {
                ...(base as ArcParams),
                a: from,
                b: to,
                bulge: (towardFront * length) / 4,
            };
        }
        case "block":
            return boxFromCorners(base as BlockParams, from, to, n);
        default:
            return undefined;
    }
}

/** The params clicked points draw (a curve through them), built on `base` */
export function paramsFromClicks(
    kindId: string,
    base: unknown,
    points: readonly XY[],
): unknown {
    if (kindId !== "curve" || points.length < 2) return undefined;
    return { ...(base as CurveParams), points: [...points] };
}

/**
 * A box from two opposite corners, square to the field. With the intervals kept, the width
 * decides how many files fit at the across interval; otherwise the ranks and files split the
 * marchers to suit the box's shape and the intervals stretch to fill it.
 */
function boxFromCorners(
    base: BlockParams,
    from: XY,
    to: XY,
    n: number,
): BlockParams {
    const width = Math.abs(to.x - from.x);
    const depth = Math.abs(to.y - from.y);
    const count = Math.max(1, n);
    const center = mid(from, to);
    if (base.keepIntervals) {
        const files = Math.min(
            count,
            Math.max(1, Math.round(width / Math.max(base.across, 1e-9)) + 1),
        );
        return { ...base, center, rotation: 0, files };
    }
    // Files for the box's proportions: files / ranks about width / depth
    const aspect = depth > 1e-9 ? width / depth : count;
    const files = Math.min(
        count,
        Math.max(1, Math.round(Math.sqrt(count * aspect))),
    );
    const ranks = Math.ceil(count / files);
    return {
        ...base,
        center,
        rotation: 0,
        files,
        across: files > 1 ? width / (files - 1) : base.across,
        deep: ranks > 1 ? depth / (ranks - 1) : base.deep,
    };
}

/** A pointer sample of a stroke, kept for recognizing drawn shapes later */
export interface StrokeSample {
    readonly x: number;
    readonly y: number;
    /** Milliseconds since the stroke began */
    readonly t: number;
}
