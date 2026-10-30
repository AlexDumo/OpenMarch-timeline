import type { XY } from "../types";

/**
 * An even, natural spread of marchers over a closed outline (owner decisions, 2026-10-11): some
 * on the edge so the silhouette reads, the rest inside, evenly spaced with no ranks or files and
 * purposely irregular.
 *
 * How: the edge gets marchers evenly along it (as many as keep its spacing near the inside's,
 * unless a count is given); the inside starts from a seeded scatter and is relaxed by letting
 * close neighbors push apart. The scatter is laid out in the outline's own unit space, so the same
 * seed gives the same layout scaled and moved with the outline: small edits nudge marchers rather
 * than reshuffle them, and a new layout is a new seed.
 */

/** A closed outline the spread fills */
export interface FillOutline {
    readonly area: number;
    readonly perimeter: number;
    /** The point a fraction `t` (0 to 1) of the way round the edge */
    pointAt(t: number): XY;
    /** A point of the unit shape (both coordinates in -1..1, inside the unit shape) mapped in */
    fromUnit(u: XY): XY;
    /** Whether a unit-space point is inside the unit shape */
    unitContains(u: XY): boolean;
    /** `p` moved inside the outline, at least `margin` from its edge */
    keepInside(p: XY, margin: number): XY;
}

export function circleOutline(center: XY, r: number): FillOutline {
    return {
        area: Math.PI * r * r,
        perimeter: 2 * Math.PI * r,
        // From the front (+y), clockwise on the canvas
        pointAt: (t) => {
            const a = Math.PI / 2 + t * 2 * Math.PI;
            return {
                x: center.x + r * Math.cos(a),
                y: center.y + r * Math.sin(a),
            };
        },
        fromUnit: (u) => ({ x: center.x + u.x * r, y: center.y + u.y * r }),
        unitContains: (u) => u.x * u.x + u.y * u.y <= 1,
        keepInside: (p, margin) => {
            const dx = p.x - center.x;
            const dy = p.y - center.y;
            const d = Math.hypot(dx, dy);
            const max = Math.max(0, r - margin);
            if (d <= max || d === 0) return p;
            return {
                x: center.x + (dx / d) * max,
                y: center.y + (dy / d) * max,
            };
        },
    };
}

/** A box of `width` by `height` about `center`, turned by `rotation` radians */
export function boxOutline(
    center: XY,
    width: number,
    height: number,
    rotation: number,
): FillOutline {
    const hw = width / 2;
    const hh = height / 2;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const toField = (lx: number, ly: number): XY => ({
        x: center.x + lx * cos - ly * sin,
        y: center.y + lx * sin + ly * cos,
    });
    const toLocal = (p: XY) => {
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
    };
    const perimeter = 2 * (width + height);
    return {
        area: width * height,
        perimeter,
        // From the front-left corner, along the front first
        pointAt: (t) => {
            let s = (((t % 1) + 1) % 1) * perimeter;
            if (s <= width) return toField(-hw + s, hh);
            s -= width;
            if (s <= height) return toField(hw, hh - s);
            s -= height;
            if (s <= width) return toField(hw - s, -hh);
            s -= width;
            return toField(-hw, -hh + s);
        },
        fromUnit: (u) => toField(u.x * hw, u.y * hh),
        unitContains: (u) => Math.abs(u.x) <= 1 && Math.abs(u.y) <= 1,
        keepInside: (p, margin) => {
            const l = toLocal(p);
            const mx = Math.max(0, hw - margin);
            const my = Math.max(0, hh - margin);
            return toField(
                Math.max(-mx, Math.min(mx, l.x)),
                Math.max(-my, Math.min(my, l.y)),
            );
        },
    };
}

/** The spacing a hexagonal packing of `count` points over `area` would have */
const packedSpacing = (area: number, count: number) =>
    Math.sqrt((2 * area) / (Math.sqrt(3) * Math.max(count, 1)));

/** How many marchers stand on the edge when not set: about the inside's spacing apart */
export function autoEdgeCount(outline: FillOutline, n: number): number {
    if (n <= 0) return 0;
    const spacing = packedSpacing(outline.area, n);
    if (!(spacing > 0)) return n;
    const k = Math.round(outline.perimeter / spacing);
    // At least a quarter inside, so a small band still fills (sims, draw round 1: eight marchers
    // all went to the rim, a ring, not a filled circle)
    const most = n >= 4 ? n - Math.ceil(n / 4) : n;
    return Math.max(Math.min(3, most), Math.min(most, k));
}

/**
 * A small seeded random generator (mulberry32), so a layout repeats. Integer arithmetic and one
 * division, so every engine gives the same numbers.
 */
export function seeded(seed: number): () => number {
    let a = (Math.floor(seed) * 0x9e3779b1) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const RELAX_ROUNDS = 40;
/** Neighbors nearer than this many spacings push apart */
const REACH = 1.5;

/**
 * `n` spots: the edge's first, in order round it, then the inside's.
 *
 * @param edge marchers on the edge; undefined for the automatic count
 * @param seed which layout (any whole number; the same one repeats)
 */
export function naturalFill(
    outline: FillOutline,
    n: number,
    edge: number | undefined,
    seed: number,
): XY[] {
    if (n <= 0 || !(outline.area > 0)) return [];
    const onEdge = Math.max(0, Math.min(n, edge ?? autoEdgeCount(outline, n)));
    const random = seeded(seed);
    // The edge: evenly round it, from a point the seed turns a little, so layouts differ
    const phase = random();
    const spots: XY[] = Array.from({ length: onEdge }, (_, i) =>
        outline.pointAt((i + phase) / onEdge),
    );
    const inside = n - onEdge;
    if (inside === 0) return spots;

    // The inside: a seeded scatter in the unit shape, then relaxed apart
    const spacing = packedSpacing(outline.area, inside + onEdge / 2);
    const points: XY[] = [];
    for (
        let guard = 0;
        points.length < inside && guard < inside * 200;
        guard++
    ) {
        const u = { x: random() * 2 - 1, y: random() * 2 - 1 };
        // Not right against the edge, where the edge marchers stand
        if (outline.unitContains({ x: u.x / 0.85, y: u.y / 0.85 }))
            points.push(outline.keepInside(outline.fromUnit(u), spacing / 2));
    }
    while (points.length < inside)
        points.push(outline.fromUnit({ x: 0, y: 0 }));

    const reach = REACH * spacing;
    for (let round = 0; round < RELAX_ROUNDS; round++) {
        const step = 0.3 * (1 - round / RELAX_ROUNDS) + 0.05;
        const moves = points.map((p, i) => {
            let fx = 0;
            let fy = 0;
            const push = (q: XY) => {
                const dx = p.x - q.x;
                const dy = p.y - q.y;
                const d = Math.hypot(dx, dy);
                if (d >= reach) return;
                if (d < 1e-9) {
                    // Exactly on top of each other: part in a seeded direction
                    const a = random() * 2 * Math.PI;
                    fx += Math.cos(a) * reach;
                    fy += Math.sin(a) * reach;
                    return;
                }
                const strength = (reach - d) / d;
                fx += dx * strength;
                fy += dy * strength;
            };
            points.forEach((q, j) => j !== i && push(q));
            spots.forEach(push);
            return { x: p.x + fx * step, y: p.y + fy * step };
        });
        for (let i = 0; i < points.length; i++)
            points[i] = outline.keepInside(moves[i]!, spacing / 2);
    }
    return [...spots, ...points];
}

/** The typical distance from a spot to its nearest neighbor, for a "≈ X steps apart" readout */
export function typicalNeighborDistance(spots: readonly XY[]): number {
    if (spots.length < 2) return 0;
    const nearest = spots.map((p, i) => {
        let best = Infinity;
        spots.forEach((q, j) => {
            if (i !== j)
                best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
        });
        return best;
    });
    nearest.sort((a, b) => a - b);
    return nearest[Math.floor(nearest.length / 2)]!;
}
