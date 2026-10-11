import type { XY } from "../types";
import { cross, sub } from "./vec";

/** A straight walk from `from` to `to` over the same counts as everyone else's */
export interface Walk {
    readonly from: XY;
    readonly to: XY;
}

/** Whether two walks cross strictly inside both (touching at an end doesn't count) */
export function walksCross(p: Walk, q: Walk): boolean {
    const d1 = sub(p.to, p.from);
    const d2 = sub(q.to, q.from);
    const denom = cross(d1, d2);
    if (Math.abs(denom) < 1e-12) return false;
    const w = sub(q.from, p.from);
    const t = cross(w, d2) / denom;
    const u = cross(w, d1) / denom;
    const inside = (v: number) => v > 1e-6 && v < 1 - 1e-6;
    return inside(t) && inside(u);
}

/**
 * How close two marchers get while walking at the same time (both start together and arrive
 * together, so their gap changes linearly): the smallest distance between them over the move.
 */
export function closestApproach(p: Walk, q: Walk): number {
    const wx = p.from.x - q.from.x;
    const wy = p.from.y - q.from.y;
    const vx = p.to.x - p.from.x - (q.to.x - q.from.x);
    const vy = p.to.y - p.from.y - (q.to.y - q.from.y);
    const vv = vx * vx + vy * vy;
    const t =
        vv === 0 ? 0 : Math.min(1, Math.max(0, -(wx * vx + wy * vy) / vv));
    return Math.hypot(wx + t * vx, wy + t * vy);
}
