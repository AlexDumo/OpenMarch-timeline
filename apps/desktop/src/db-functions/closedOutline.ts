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
        pts.map(() => false),
    );

/** A turn sharper than this between two stretches of a drawn outline is a corner, kept one (30°) */
const OUTLINE_CORNER = (30 * Math.PI) / 180;
/** Along a curve, a point is kept each time the outline has turned this much (15°) */
const OUTLINE_STEP = (15 * Math.PI) / 180;

/**
 * A stretch of a drawn outline this many times longer than a stretch beside it is a straight
 * side of the shape, not one more short piece of a curve (curves are drawn as many short ones)
 */
const SIDE_RATIO = 3;
/** Points of a drawn outline in one straight run are one stretch: bends under this are none (0.006°) */
const STRAIGHT_TURN = 1e-4;
/** ... as long as the run hasn't turned more than this in all (0.06°) */
const STRAIGHT_RUN = 1e-3;

/**
 * A shape's own outline as a closed route (fork #1213, a placed closed shape): `outline` is the
 * closed run of points the shape tools draw it by (curves as many short stretches). Its sharp
 * turns stay corners; its curves become arcs through points taken every 15° of turning, each
 * with the way the outline runs there. **Its straight sides stay straight**: a stretch much
 * longer than one beside it (after points along one straight run are taken as one stretch) is a
 * straight leg end to end, and a curve that meets it without a corner runs the side's own way
 * there, so the side isn't bowed by the curve beside it. Null when it has fewer than three points.
 */
export function loopAlong(outline: readonly XY[]): RouteGeometry | null {
    // without repeated points (a closing point that restates the first one)
    const raw: XY[] = [];
    for (const p of outline)
        if (raw.length === 0 || dist(raw[raw.length - 1]!, p) > EPS_GEOM)
            raw.push(p);
    if (raw.length > 1 && dist(raw[0]!, raw[raw.length - 1]!) <= EPS_GEOM)
        raw.pop();
    const pts = withoutStraightRuns(raw);
    const n = pts.length;
    if (n < 3) return null;
    const turns = pts.map((_, i) =>
        turnAt(pts[(i + n - 1) % n]!, pts[i]!, pts[(i + 1) % n]!),
    );
    const sharp = turns.map((t) => Math.abs(t) > OUTLINE_CORNER);
    // stretch i runs from point i to the next; a side when much longer than a stretch beside it
    const lens = pts.map((p, i) => dist(p, pts[(i + 1) % n]!));
    const side = lens.map(
        (l, i) =>
            l >=
            SIDE_RATIO * Math.min(lens[(i + n - 1) % n]!, lens[(i + 1) % n]!),
    );
    // from a corner when there is one, so every curve runs corner to corner
    const first = Math.max(0, sharp.indexOf(true));
    const kept: XY[] = [];
    const corners: boolean[] = [];
    const straight: boolean[] = [];
    const tangents = new Map<number, XY>();
    let turned = 0;
    for (let k = 0; k < n; k++) {
        const i = (first + k) % n;
        const before = (i + n - 1) % n;
        turned += Math.abs(turns[i]!);
        // a side's two ends are kept, so it is one leg of its own
        const ends = side[i]! || side[before]!;
        if (!(k === 0 || sharp[i] || ends || turned >= OUTLINE_STEP)) continue;
        turned = 0;
        // The way the outline runs at a kept point: along the side it ends, else read from its
        // own neighbors on the outline (not the kept points either side), so the arcs follow
        // the drawn curve
        tangents.set(
            kept.length,
            side[before]
                ? unit(sub(pts[i]!, pts[before]!))
                : side[i]
                  ? unit(sub(pts[(i + 1) % n]!, pts[i]!))
                  : tangentAt(pts[before]!, pts[i]!, pts[(i + 1) % n]!),
        );
        kept.push(pts[i]!);
        corners.push(sharp[i]!);
        // the leg out of this point is the side itself: its other end is the next point kept
        straight.push(side[i]!);
    }
    return loopWithTangents(kept, corners, tangents, straight);
}

/** How far the way turns at `p`, coming from `a` and going on to `b`, signed */
const turnAt = (a: XY, p: XY, b: XY): number => {
    const u = sub(p, a);
    const v = sub(b, p);
    return Math.atan2(cross(u, v), dot(u, v));
};

/**
 * `pts` (a closed run) without the points inside its straight runs: a point where the way doesn't
 * bend ({@link STRAIGHT_TURN}) goes, while the run it's in hasn't bent {@link STRAIGHT_RUN} in
 * all, so a straight side drawn through several points is one stretch
 */
function withoutStraightRuns(pts: readonly XY[]): XY[] {
    const n = pts.length;
    if (n < 4) return [...pts];
    const bends = pts.map((_, i) =>
        Math.abs(turnAt(pts[(i + n - 1) % n]!, pts[i]!, pts[(i + 1) % n]!)),
    );
    // from a point that bends, so a run isn't cut in two by where the outline starts
    const first = bends.findIndex((t) => t > STRAIGHT_TURN);
    if (first < 0) return [...pts];
    const out: XY[] = [];
    let run = 0;
    for (let k = 0; k < n; k++) {
        const i = (first + k) % n;
        run += bends[i]!;
        if (bends[i]! > STRAIGHT_TURN || run > STRAIGHT_RUN) {
            out.push(pts[i]!);
            run = 0;
        }
    }
    return out;
}

/**
 * The closed route through `given` in order, back to the first: a corner where `corners` says so,
 * elsewhere a smooth curve through the point (arcs meeting without a bend), running the way
 * `tangents` gives for it (else as a curve through its neighbors would); the leg out of a point
 * `straight` marks is a straight one, whatever its ends are. Stored clockwise on the field, as
 * the other outlines are. Null for fewer than three points.
 */
function loopWithTangents(
    given: readonly XY[],
    corners: readonly boolean[],
    tangents: ReadonlyMap<number, XY>,
    straight: readonly boolean[],
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
        // walked the other way, the leg from i to j is the given leg out of j's point
        const side = straight[turned ? at(j) : at(i)]!;
        if (side || (corner(i) && corner(j))) legs.push({ at: b });
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

/** A loop's two sides this near each other for its length are a line walked out and back, not a loop */
const LOOP_ROUNDNESS = 0.03;
/** A marcher where the loop would turn back sharper than this isn't standing in a loop (135°) */
const LOOP_SHARPEST = (135 * Math.PI) / 180;
/** A loop winds round once; with its bends in and out it turns no more than this in all (two turns) */
const LOOP_TURNING = 4 * Math.PI;

/**
 * The chain of nearest neighbors from `first`: each next the nearest marcher not yet taken. Null
 * when a step has two marchers equally near to go to (after the first step, where a ring has its
 * two neighbors): the chain would then depend on which is asked about first, not on where they
 * stand. The first step's tie goes to the one further left (then up), for the same reason.
 */
function chainFrom(starts: readonly XY[], first: number): number[] | null {
    const n = starts.length;
    const order = [first];
    const left = new Set(starts.map((_, i) => i));
    left.delete(first);
    while (left.size > 0) {
        const from = starts[order[order.length - 1]!]!;
        let next = -1;
        let best = Infinity;
        let tied = false;
        for (const i of left) {
            const d = dist(from, starts[i]!);
            const same = Math.abs(d - best) <= 1e-9 * Math.max(1, best);
            if (same && next >= 0) {
                tied = true;
                const [a, b] = [starts[i]!, starts[next]!];
                if (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])) next = i;
            } else if (d < best) {
                best = d;
                next = i;
                tied = false;
            }
        }
        if (tied && order.length > 1) return null;
        order.push(next);
        left.delete(next);
    }
    return order.length === n ? order : null;
}

/** Whether the closed chains `a` and `b` are the same ring: the same neighbors, whichever way round */
function sameRing(a: readonly number[], b: readonly number[]): boolean {
    const n = a.length;
    const at = b.indexOf(a[0]!);
    if (at < 0 || b.length !== n) return false;
    return [1, -1].some((way) =>
        a.every((x, k) => x === b[(((at + way * k) % n) + n) % n]),
    );
}

/** Whether the stretches `a`–`b` and `c`–`d` cross or touch (they share no end) */
function crosses(a: XY, b: XY, c: XY, d: XY): boolean {
    const side = (p: XY, q: XY, r: XY) => cross(sub(q, p), sub(r, p));
    const within = (p: XY, q: XY, r: XY) =>
        Math.min(p[0], q[0]) - 1e-9 <= r[0] &&
        r[0] <= Math.max(p[0], q[0]) + 1e-9 &&
        Math.min(p[1], q[1]) - 1e-9 <= r[1] &&
        r[1] <= Math.max(p[1], q[1]) + 1e-9;
    const d1 = side(c, d, a);
    const d2 = side(c, d, b);
    const d3 = side(a, b, c);
    const d4 = side(a, b, d);
    const eps = 1e-9;
    if (
        ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
        ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
    )
        return true;
    return (
        (Math.abs(d1) <= eps && within(c, d, a)) ||
        (Math.abs(d2) <= eps && within(c, d, b)) ||
        (Math.abs(d3) <= eps && within(a, b, c)) ||
        (Math.abs(d4) <= eps && within(a, b, d))
    );
}

/**
 * Whether the closed chain `order` through `starts` is the outline of a loop: it never crosses
 * or touches itself, it encloses real room for its length ({@link LOOP_ROUNDNESS}: a line walked
 * out and back encloses none), it turns back on itself nowhere ({@link LOOP_SHARPEST}) and winds
 * round no more than a loop does ({@link LOOP_TURNING}).
 */
function outlinesALoop(
    starts: readonly XY[],
    order: readonly number[],
): boolean {
    const n = order.length;
    const p = (k: number) => starts[order[((k % n) + n) % n]!]!;
    for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
            // neighbors share an end
            if (j === i + 1 || (i === 0 && j === n - 1)) continue;
            if (crosses(p(i), p(i + 1), p(j), p(j + 1))) return false;
        }
    let area = 0;
    let around = 0;
    let turning = 0;
    for (let k = 0; k < n; k++) {
        area += cross(p(k), p(k + 1));
        around += dist(p(k), p(k + 1));
        const t = Math.abs(turnAt(p(k - 1), p(k), p(k + 1)));
        if (t > LOOP_SHARPEST) return false;
        turning += t;
    }
    if (turning > LOOP_TURNING + 1e-9) return false;
    // 4π·area / length²: 1 for a circle, 0 for a line walked out and back
    return (2 * Math.PI * Math.abs(area)) / (around * around) >= LOOP_ROUNDNESS;
}

/**
 * The marchers at `starts` in order round the closed loop they stand in (fork #1213), as indexes
 * into `starts`, from the first of them. They stand in a loop when:
 *
 * - the chain of nearest neighbors (each next the nearest not yet taken) is **the same ring
 *   whichever marcher it starts from**, and never has two equally near to choose between, so it
 *   is read from where they stand and not from the order they are asked about (a line, a block
 *   and scattered marchers give different chains from different starts);
 * - it closes: no gap more than 2.5 times the usual one, the closing one included;
 * - each marcher's nearest other stands beside it in the ring;
 * - the ring is the outline of a loop ({@link outlinesALoop}): it doesn't cross itself, it
 *   encloses room, and it turns back on itself nowhere.
 *
 * Four or more. Null otherwise: an open line or curve, a block, scattered marchers.
 */
export function ringOrder(starts: readonly XY[]): number[] | null {
    const n = starts.length;
    if (n < 4) return null;
    const order = chainFrom(starts, 0);
    if (!order) return null;
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
    if (!beside || !outlinesALoop(starts, order)) return null;
    // the same ring from every one of them
    for (let first = 1; first < n; first++) {
        const other = chainFrom(starts, first);
        if (!other || !sameRing(order, other)) return null;
    }
    return order;
}
