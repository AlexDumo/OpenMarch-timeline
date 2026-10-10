// cspell:words Kåsa suuu svvv suvv svuu
import type { XY } from "../types";
import { centroid, dot, sub, xy } from "./vec";

/**
 * The two points at the extremes of `points` along their principal axis: a line through a rough
 * row of marchers. Steadier than the farthest pair on noisy input.
 */
export function principalExtremes(points: readonly XY[]): [XY, XY] | undefined {
    if (points.length < 2) return undefined;
    const c = centroid(points);
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const p of points) {
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        sxx += dx * dx;
        sxy += dx * dy;
        syy += dy * dy;
    }
    if (sxx + syy === 0) return undefined;
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const axis = xy(Math.cos(angle), Math.sin(angle));
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of points) {
        const t = dot(sub(p, c), axis);
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
    }
    const a = xy(c.x + axis.x * lo, c.y + axis.y * lo);
    const b = xy(c.x + axis.x * hi, c.y + axis.y * hi);
    // Read left to right (then top to bottom), the way drill is usually written.
    if (a.x > b.x + 1e-9 || (Math.abs(a.x - b.x) <= 1e-9 && a.y > b.y))
        return [b, a];
    return [a, b];
}

/**
 * Least-squares circle through `points` (Kåsa's algebraic fit). Undefined for fewer than three
 * points or points on a line.
 */
export function fitCircle(
    points: readonly XY[],
): { center: XY; r: number } | undefined {
    if (points.length < 3) return undefined;
    const c = centroid(points);
    let suu = 0;
    let suv = 0;
    let svv = 0;
    let suuu = 0;
    let svvv = 0;
    let suvv = 0;
    let svuu = 0;
    for (const p of points) {
        const u = p.x - c.x;
        const v = p.y - c.y;
        suu += u * u;
        suv += u * v;
        svv += v * v;
        suuu += u * u * u;
        svvv += v * v * v;
        suvv += u * v * v;
        svuu += v * u * u;
    }
    const det = suu * svv - suv * suv;
    const scaleSq = suu + svv;
    if (scaleSq === 0 || Math.abs(det) < 1e-12 * scaleSq * scaleSq)
        return undefined;
    const bu = 0.5 * (suuu + suvv);
    const bv = 0.5 * (svvv + svuu);
    const uc = (bu * svv - bv * suv) / det;
    const vc = (suu * bv - suv * bu) / det;
    const r = Math.sqrt(uc * uc + vc * vc + scaleSq / points.length);
    if (!Number.isFinite(r)) return undefined;
    return { center: xy(c.x + uc, c.y + vc), r };
}
