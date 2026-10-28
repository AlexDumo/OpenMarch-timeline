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
