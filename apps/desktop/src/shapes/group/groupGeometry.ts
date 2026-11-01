import type { ShapeRecipeMember } from "@/db-functions/shapeRecipes";
import {
    fieldToFrame,
    frameCorners,
    frameToField,
    pivotPoint,
    type ShapeFrame,
} from "../frame/frame";
import { pivotOf } from "../frame/pivot";
import type { ToolEnv } from "../tool/toolKind";
import type { Slot, XY } from "../types";

/**
 * A **group** (#603): marchers made a shape as they stand, with no kind laying them out. Its spots
 * are where they stood when grouped, kept in its frame's own axes, so it turns, flips, moves and
 * scales like any shape (ADR 0006, 2026-11-01 group amendment). Everything here is pure.
 */
export interface GroupParams {
    /** The frame's center: the middle of the spots' bounds in the frame's own axes */
    readonly center: XY;
    readonly rotation: number;
    /** Absent rather than false, as the other kinds store them */
    readonly flipX?: boolean;
    readonly flipY?: boolean;
    /**
     * Each spot in the frame's own axes before any flip, in field units, from the center. Slot
     * `i` is `points[i]`. (`spots` is the host's spot count in a recipe, so not this.)
     */
    readonly points: readonly XY[];
}

export function groupFrame(p: GroupParams): ShapeFrame {
    let halfWidth = 0;
    let halfDepth = 0;
    for (const pt of p.points) {
        halfWidth = Math.max(halfWidth, Math.abs(pt.x));
        halfDepth = Math.max(halfDepth, Math.abs(pt.y));
    }
    return {
        center: p.center,
        halfWidth,
        halfDepth,
        rotation: p.rotation,
        flipX: p.flipX === true,
        flipY: p.flipY === true,
    };
}

export function withGroupFrame(p: GroupParams, frame: ShapeFrame): GroupParams {
    return {
        ...p,
        center: frame.center,
        rotation: frame.rotation,
        flipX: frame.flipX ? true : undefined,
        flipY: frame.flipY ? true : undefined,
    };
}

/** The group's spots on the field, in slot order */
export function groupSpots(p: GroupParams): Slot[] {
    const frame = groupFrame(p);
    return p.points.map((pt) =>
        frameToField(frame, {
            x: frame.flipX ? -pt.x : pt.x,
            y: frame.flipY ? -pt.y : pt.y,
        }),
    );
}

/** A group of marchers standing at `positions`, square to the field, its center their middle */
export function groupAt(positions: readonly XY[]): GroupParams {
    if (positions.length === 0)
        return { center: { x: 0, y: 0 }, rotation: 0, points: [] };
    const xs = positions.map((p) => p.x);
    const ys = positions.map((p) => p.y);
    const center = {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
    return {
        center,
        rotation: 0,
        points: positions.map((p) => ({
            x: p.x - center.x,
            y: p.y - center.y,
        })),
    };
}

/** What grouping marchers where they stand saves: a `group` recipe, each one on its own spot */
export function groupRecipe(
    marchers: readonly {
        readonly id: number;
        readonly x: number;
        readonly y: number;
    }[],
): {
    params: GroupParams & { spots: number };
    members: ShapeRecipeMember[];
} {
    const params = groupAt(marchers);
    return {
        params: { ...params, spots: marchers.length },
        members: marchers.map((m, slot) => ({
            marcherId: m.id,
            slot,
            x: m.x,
            y: m.y,
        })),
    };
}

/**
 * The group's interval, in field units: the smallest gap between neighbors (#356), each spot's
 * neighbor being its nearest. A gap under half the median of those is left out, so a pair of
 * marchers standing nearly on top of each other doesn't make the interval tiny (#603, open
 * question 2). It depends only on the spots' proportions, so scaling never picks another gap. Null
 * with fewer than two spots, or all of them on one spot.
 */
export function groupInterval(p: Pick<GroupParams, "points">): number | null {
    const { points } = p;
    if (points.length < 2) return null;
    const nearest = points.map((a, i) => {
        let best = Infinity;
        for (const [j, b] of points.entries()) {
            if (i === j) continue;
            best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y));
        }
        return best;
    });
    const sorted = [...nearest].sort((a, b) => a - b);
    const mid = sorted.length / 2;
    const median =
        sorted.length % 2 === 1
            ? sorted[Math.floor(mid)]!
            : (sorted[mid - 1]! + sorted[mid]!) / 2;
    if (median <= 1e-9) return null;
    return Math.min(...nearest.filter((d) => d >= median / 2 - 1e-9));
}

/** The group `k` times its size about its center, turn and flip kept */
const scaled = (p: GroupParams, k: number): GroupParams => ({
    ...p,
    points: p.points.map((pt) => ({ x: pt.x * k, y: pt.y * k })),
});

/**
 * The group scaled so its interval is `interval` field units, its pivot (the host's, or the
 * shape's own) staying put. Null with no interval to scale by, or a size of nothing.
 */
export function withGroupInterval(
    p: GroupParams,
    interval: number,
    env: Pick<ToolEnv, "pivot">,
): GroupParams | null {
    const was = groupInterval(p);
    if (was === null || !(interval > 1e-9)) return null;
    if (Math.abs(interval - was) < 1e-12) return p;
    const next = scaled(p, interval / was);
    const key = env.pivot ?? pivotOf(p);
    const from = pivotPoint(groupFrame(p), key);
    const to = pivotPoint(groupFrame(next), key);
    return {
        ...next,
        center: {
            x: next.center.x + from.x - to.x,
            y: next.center.y + from.y - to.y,
        },
    };
}

/**
 * The group moved by `delta`; with snapping on, its first spot lands on the half-step grid, so a
 * group whose marchers were on the grid stays on it (its center usually isn't)
 */
export function moveGroup(
    base: GroupParams,
    delta: XY,
    env: Pick<ToolEnv, "snap" | "gridSnap">,
): GroupParams {
    let d = delta;
    const first = groupSpots(base)[0];
    if (env.snap && first) {
        const to = env.gridSnap({ x: first.x + delta.x, y: first.y + delta.y });
        d = { x: to.x - first.x, y: to.y - first.y };
    }
    return {
        ...base,
        center: { x: base.center.x + d.x, y: base.center.y + d.y },
    };
}

/** Whether `at` grabs the group to move it: inside its frame, or within half an interval of it */
export function insideGroup(p: GroupParams, at: XY): boolean {
    const frame = groupFrame(p);
    const margin = (groupInterval(p) ?? 0) / 2;
    const local = fieldToFrame(frame, at);
    return (
        Math.abs(local.x) <= frame.halfWidth + margin &&
        Math.abs(local.y) <= frame.halfDepth + margin
    );
}

/** The frame's corners, then its center: what a moved group pulls onto the field's lines */
export const groupSnapPoints = (p: GroupParams): XY[] => {
    const frame = groupFrame(p);
    return [...frameCorners(frame), frame.center];
};

/**
 * A group of `n` spots filling `frame` as one rank across it. Only the host's kind contract needs
 * it: a group is never drawn or picked, so nothing turns another shape into one.
 */
export function groupInFrame(frame: ShapeFrame, n: number): GroupParams {
    const w = frame.halfWidth;
    return {
        center: frame.center,
        rotation: frame.rotation,
        flipX: frame.flipX ? true : undefined,
        flipY: frame.flipY ? true : undefined,
        points: Array.from({ length: n }, (_, i) => ({
            x: n === 1 ? 0 : -w + (2 * w * i) / (n - 1),
            y: 0,
        })),
    };
}
