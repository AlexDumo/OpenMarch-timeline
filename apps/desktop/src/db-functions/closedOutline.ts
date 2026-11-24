/**
 * Any closed outline as a closed route (pathways step 10, fork #1213; owner, 2026-11-23: "if I
 * have a bunch of curves and then it goes back to the original point, I can't have it follow
 * around that shape like I can with a circle").
 *
 * A closed route (R-13‴) holds corners and circular arc legs, never smooth points, so a curve is
 * stored as a chain of arcs that meet without a bend: between two points of the curve, each with
 * the way the curve runs there, two arcs. That keeps the file format as it is (the one a
 * circle's four quarter arcs already use), and the marchers walk a real curve between spots.
 *
 * - `ringOrder`: the marchers in order round the loop they stand in, when they stand in one.
 * - `loopThrough`: the smooth closed loop through points in order (the marchers themselves).
 * - `loopAlong`: a shape's own outline, a closed run of points as the shape tools draw it, its
 *   sharp turns kept as corners and its curves as arcs.
 */
import { EPS_GEOM, type RouteGeometry, type XY } from "@openmarch/core";

const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const len = (a: XY): number => Math.hypot(a[0], a[1]);
const dist = (a: XY, b: XY): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (a: XY): XY => {
    const l = len(a) || 1;
    return [a[0] / l, a[1] / l];
};
const dot = (a: XY, b: XY): number => a[0] * b[0] + a[1] * b[1];
const cross = (a: XY, b: XY): number => a[0] * b[1] - a[1] * b[0];

const median = (xs: readonly number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
};

/**
 * The bulge (R-8: signed sagitta over chord) of the arc from `a` to `b` that leaves `a` along the
 * unit direction `t`; 0 when that is the straight leg. Null when it would be more than half a
 * circle, which a leg can't be.
 */
export function bulgeLeaving(a: XY, b: XY, t: XY): number | null {
    const u = sub(b, a);
    // the angle from the chord to the way it leaves: the arc turns through twice that
    const alpha = Math.atan2(cross(u, t), dot(u, t));
    if (Math.abs(alpha) > Math.PI / 2 + 1e-9) return null;
    const k = Math.tan(alpha / 2) / 2;
    return Math.abs(k) < 1e-7 ? 0 : Math.max(-0.5, Math.min(0.5, k));
}

/** {@link bulgeLeaving} for the arc that arrives at `b` along `t` */
const bulgeArriving = (a: XY, b: XY, t: XY): number | null => {
    const k = bulgeLeaving(b, a, [-t[0], -t[1]]);
    return k === null ? null : k === 0 ? 0 : -k;
};

/** One leg of the loop as built: where it ends, and its bulge when it's an arc */
type Leg = { at: XY; bulge?: number };

/**
 * The legs from `p0`, leaving along `t0`, to `p1`, arriving along `t1` (unit directions): two
 * arcs meeting without a bend (the join where both arcs are equally far from their ends'
 * tangents), or the one straight leg when the curve can't be met that way.
 */
export function twoArcs(p0: XY, t0: XY, p1: XY, t1: XY): Leg[] {
    const v = sub(p1, p0);
    const vv = dot(v, v);
    if (!(vv > EPS_GEOM * EPS_GEOM)) return [{ at: p1 }];
    const c = dot(t0, t1);
    const vt = dot(v, [t0[0] + t1[0], t0[1] + t1[1]]);
    let d: number;
    if (1 - c < 1e-9) {
        const vt1 = dot(v, t1);
        if (!(Math.abs(vt1) > 1e-12)) return [{ at: p1 }];
        d = vv / (4 * vt1);
    } else d = (-vt + Math.sqrt(vt * vt + 2 * (1 - c) * vv)) / (2 * (1 - c));
    if (!(d > 0) || !Number.isFinite(d)) return [{ at: p1 }];
    const mid: XY = [
        (p0[0] + p1[0] + d * (t0[0] - t1[0])) / 2,
        (p0[1] + p1[1] + d * (t0[1] - t1[1])) / 2,
    ];
    const k1 = bulgeLeaving(p0, mid, t0);
    const k2 = bulgeArriving(mid, p1, t1);
    if (k1 === null || k2 === null) return [{ at: p1 }];
    if (dist(p0, mid) < EPS_GEOM || dist(mid, p1) < EPS_GEOM) {
        const k = bulgeLeaving(p0, p1, t0);
        return [{ at: p1, ...(k ? { bulge: k } : {}) }];
    }
    return [
        { at: mid, ...(k1 ? { bulge: k1 } : {}) },
        { at: p1, ...(k2 ? { bulge: k2 } : {}) },
    ];
}

/**
 * The way a smooth curve runs through `p` between its neighbors `a` (before) and `b` (after): the
 * centripetal Catmull–Rom tangent, as a path's smooth points take theirs, so uneven spacing
 * doesn't overshoot
 */
function tangentAt(a: XY, p: XY, b: XY): XY {
    const d1 = Math.sqrt(dist(a, p)) || 1e-6;
    const d2 = Math.sqrt(dist(p, b)) || 1e-6;
    return unit([
        (p[0] - a[0]) / d1 - (b[0] - a[0]) / (d1 + d2) + (b[0] - p[0]) / d2,
        (p[1] - a[1]) / d1 - (b[1] - a[1]) / (d1 + d2) + (b[1] - p[1]) / d2,
    ]);
}

/** Clockwise on the field (y down) is a positive shoelace sum, as a box outline is stored */
const clockwise = (pts: readonly XY[]): boolean => {
    let area = 0;
    pts.forEach((p, i) => {
        const q = pts[(i + 1) % pts.length]!;
        area += p[0] * q[1] - q[0] * p[1];
    });
    return area >= 0;
};

/**
 * The smooth closed loop through `pts` in order and back to the first (fork #1213, with no placed
 * shape): a curve through every point, as Curved draws a trail through its points
 */
export const loopThrough = (pts: readonly XY[]): RouteGeometry | null =>
    loopWithTangents(
        pts,
        pts.map(() => false),
        new Map(),
    );

/** A turn sharper than this between two stretches of a drawn outline is a corner, kept one (30°) */
const OUTLINE_CORNER = (30 * Math.PI) / 180;
/** Along a curve, a point is kept each time the outline has turned this much (15°) */
const OUTLINE_STEP = (15 * Math.PI) / 180;

/**
 * A shape's own outline as a closed route (fork #1213, a placed closed shape): `outline` is the
 * closed run of points the shape tools draw it by (curves as many short stretches). Its sharp
 * turns stay corners; its curves become arcs through points taken every 15° of turning, each
 * with the way the outline runs there. Null when it has fewer than three points.
 */
export function loopAlong(outline: readonly XY[]): RouteGeometry | null {
    // without repeated points (a closing point that restates the first one)
    const pts: XY[] = [];
    for (const p of outline)
        if (pts.length === 0 || dist(pts[pts.length - 1]!, p) > EPS_GEOM)
            pts.push(p);
    if (pts.length > 1 && dist(pts[0]!, pts[pts.length - 1]!) <= EPS_GEOM)
        pts.pop();
    const n = pts.length;
    if (n < 3) return null;
    const turn = (i: number) => {
        const a = sub(pts[i]!, pts[(i + n - 1) % n]!);
        const b = sub(pts[(i + 1) % n]!, pts[i]!);
        return Math.atan2(cross(a, b), dot(a, b));
    };
    const turns = pts.map((_, i) => turn(i));
    const sharp = turns.map((t) => Math.abs(t) > OUTLINE_CORNER);
    // from a corner when there is one, so every curve runs corner to corner
    const first = Math.max(0, sharp.indexOf(true));
    const kept: XY[] = [];
    const corners: boolean[] = [];
    let turned = 0;
    for (let k = 0; k < n; k++) {
        const i = (first + k) % n;
        turned += Math.abs(turns[i]!);
        if (k === 0 || sharp[i] || turned >= OUTLINE_STEP) {
            kept.push(pts[i]!);
            corners.push(sharp[i]!);
            turned = 0;
        }
    }
    // The way the outline runs at a kept point is read from its own neighbors on the outline,
    // not from the kept points either side, so the arcs follow the drawn curve
    const index = new Map(kept.map((p, k) => [p, k]));
    const tangents = new Map<number, XY>();
    pts.forEach((p, i) => {
        const k = index.get(p);
        if (k !== undefined)
            tangents.set(
                k,
                tangentAt(pts[(i + n - 1) % n]!, p, pts[(i + 1) % n]!),
            );
    });
    return loopWithTangents(kept, corners, tangents);
}

/**
 * The closed route through `given` in order, back to the first: a corner where `corners` says so,
 * elsewhere a smooth curve through the point (arcs meeting without a bend), running the way
 * `tangents` gives for it (else as a curve through its neighbors would). Stored clockwise on the
 * field, as the other outlines are. Null for fewer than three points.
 */
function loopWithTangents(
    given: readonly XY[],
    corners: readonly boolean[],
    tangents: ReadonlyMap<number, XY>,
): RouteGeometry | null {
    const n = given.length;
    if (n < 3) return null;
    const turned = !clockwise(given);
    const at = (i: number) =>
        turned ? (((n - i) % n) + n) % n : ((i % n) + n) % n;
    const pts = Array.from({ length: n }, (_, i) => given[at(i)]!);
    const corner = (i: number) => corners[at(i)]!;
    const tangent = (i: number): XY => {
        const t = tangents.get(at(i));
        if (!t)
            return tangentAt(pts[(i + n - 1) % n]!, pts[i]!, pts[(i + 1) % n]!);
        // walked the other way, the outline runs the other way through the point
        return turned ? [-t[0], -t[1]] : t;
    };
    const legs: Leg[] = [];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = pts[i]!;
        const b = pts[j]!;
        if (dist(a, b) < EPS_GEOM) continue;
        if (corner(i) && corner(j)) legs.push({ at: b });
        else if (corner(i)) {
            const k = bulgeArriving(a, b, tangent(j));
            legs.push({ at: b, ...(k ? { bulge: k } : {}) });
        } else if (corner(j)) {
            const k = bulgeLeaving(a, b, tangent(i));
            legs.push({ at: b, ...(k ? { bulge: k } : {}) });
        } else legs.push(...twoArcs(a, tangent(i), b, tangent(j)));
    }
    if (legs.length < 2) return null;
    const closing = legs.pop()!;
    return {
        v: 1,
        closed: true,
        from: pts[0]!,
        to: pts[0]!,
        points: legs.map((leg, i) => ({
            id: `p${i + 1}`,
            at: leg.at,
            ...(leg.bulge ? { bulge: leg.bulge } : {}),
        })),
        ...(closing.bulge ? { toBulge: closing.bulge } : {}),
    };
}

/**
 * The marchers at `starts` in order round the closed loop they stand in (fork #1213), as indexes
 * into `starts`: each next the nearest not yet taken, from any one of them, when that chain closes
 * (its last is as near its first as neighbors are: no gap more than 2.5 times the usual one, the
 * closing one included) and each marcher's nearest other is beside it in the chain. Four or more.
 * Null when they don't stand in a loop: an open line or curve, a block, scattered marchers.
 */
export function ringOrder(starts: readonly XY[]): number[] | null {
    const n = starts.length;
    if (n < 4) return null;
    const order = [0];
    const left = new Set(starts.map((_, i) => i));
    left.delete(0);
    while (left.size > 0) {
        const from = starts[order[order.length - 1]!]!;
        let next = -1;
        let best = Infinity;
        for (const i of left) {
            const d = dist(from, starts[i]!);
            if (d < best) {
                best = d;
                next = i;
            }
        }
        order.push(next);
        left.delete(next);
    }
    const gaps = order.map((i, k) =>
        dist(starts[i]!, starts[order[(k + 1) % n]!]!),
    );
    const usual = median(gaps);
    if (!(usual > EPS_GEOM) || Math.max(...gaps) > 2.5 * usual) return null;
    // a chain of near neighbors, none skipped: each one's nearest other stands beside it
    const tol = usual / 4;
    const beside = order.every((i, k) => {
        const nearest = Math.min(
            ...starts.map((q, j) => (j === i ? Infinity : dist(starts[i]!, q))),
        );
        const side = Math.min(gaps[k]!, gaps[(k + n - 1) % n]!);
        return side <= nearest + tol;
    });
    return beside ? order : null;
}
