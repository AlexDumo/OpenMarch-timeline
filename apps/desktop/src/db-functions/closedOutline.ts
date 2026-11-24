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
    loopWithWays(
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
 * ... and at least every this many drawn stretches, so a long run that hardly bends and then
 * does (a curve leaving a corner) isn't met by two arcs alone
 */
const OUTLINE_PIECES = 8;

/**
 * A stretch of a drawn outline this many times longer than a stretch beside it is a straight
 * side of the shape, not one more short piece of a curve (curves are drawn as many short ones)
 */
const SIDE_RATIO = 3;
/** At the end of a straight side, a turn past this is a corner: the curve doesn't run on from the side (5°) */
const SIDE_CORNER = (5 * Math.PI) / 180;
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
    // stretch i runs from point i to the next; a side when much longer than a stretch beside it
    const lens = pts.map((p, i) => dist(p, pts[(i + 1) % n]!));
    const side = lens.map(
        (l, i) =>
            l >=
            SIDE_RATIO * Math.min(lens[(i + n - 1) % n]!, lens[(i + 1) % n]!),
    );
    // a sharp turn is a corner; at the end of a straight side a slighter one is too, where a
    // curve leaves the side at an angle instead of running on from it
    const sharp = turns.map(
        (t, i) =>
            Math.abs(t) >
            (side[i] || side[(i + n - 1) % n] ? SIDE_CORNER : OUTLINE_CORNER),
    );
    // from a corner when there is one, so every curve runs corner to corner
    const first = Math.max(0, sharp.indexOf(true));
    const kept: XY[] = [];
    const corners: boolean[] = [];
    const ways = new Map<number, Way>();
    // where each kept point is on the outline, to tell a leg that is one drawn stretch
    const where: number[] = [];
    let turned = 0;
    let pieces = 0;
    for (let k = 0; k < n; k++) {
        const i = (first + k) % n;
        const before = (i + n - 1) % n;
        const after = (i + 1) % n;
        turned += Math.abs(turns[i]!);
        pieces++;
        // a side's two ends are kept, so it is one leg of its own
        const ends = side[i]! || side[before]!;
        if (
            !(
                k === 0 ||
                sharp[i] ||
                ends ||
                turned >= OUTLINE_STEP ||
                pieces >= OUTLINE_PIECES
            )
        )
            continue;
        turned = 0;
        pieces = 0;
        // The way the outline runs at a kept point, read from the outline itself (not from the
        // kept points either side), so the arcs follow the drawn curve. A corner is come into
        // one way and left another, the ways of the stretches either side of it. Anywhere else
        // it runs on: along the side it ends or starts, else as a curve through its neighbors.
        const into = unit(sub(pts[i]!, pts[before]!));
        const out = unit(sub(pts[after]!, pts[i]!));
        const on = side[before]
            ? into
            : side[i]
              ? out
              : tangentAt(pts[before]!, pts[i]!, pts[after]!);
        ways.set(kept.length, sharp[i] ? { into, out } : { into: on, out: on });
        where.push(i);
        kept.push(pts[i]!);
        corners.push(sharp[i]!);
    }
    // A leg that is one drawn stretch between two corners, or a side, is that straight stretch
    const straight = where.map((i, k) => {
        const next = where[(k + 1) % where.length]!;
        const one = next === (i + 1) % n;
        return (
            one &&
            (side[i]! || (corners[k]! && corners[(k + 1) % where.length]!))
        );
    });
    return loopWithWays(kept, corners, ways, straight);
}

/** The way an outline runs at a point: coming into it, and going out of it (the same unless it's a corner) */
type Way = { into: XY; out: XY };

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
 * The closed route through `given` in order, back to the first. Between two points it is two arcs
 * meeting without a bend, leaving the first the way the outline goes out of it and arriving at
 * the second the way it comes in (`ways`; without one, a point is run through as a curve through
 * its neighbors would). A point `corners` marks is a corner: the legs either side of it needn't
 * agree there. The leg out of a point `straight` marks is a straight one. Stored clockwise on
 * the field, as the other outlines are. Null for fewer than three points.
 */
function loopWithWays(
    given: readonly XY[],
    corners: readonly boolean[],
    ways: ReadonlyMap<number, Way>,
    straight: readonly boolean[],
): RouteGeometry | null {
    const n = given.length;
    if (n < 3) return null;
    const turned = !clockwise(given);
    const at = (i: number) =>
        turned ? (((n - i) % n) + n) % n : ((i % n) + n) % n;
    const pts = Array.from({ length: n }, (_, i) => given[at(i)]!);
    const corner = (i: number) => corners[at(i)]!;
    /** The way the walk goes at point `i`: out of it, or into it */
    const way = (i: number, going: "out" | "into"): XY | null => {
        const w = ways.get(at(i));
        if (!w)
            // a corner with no way given has none: its legs are straight to it
            return corner(i)
                ? null
                : tangentAt(pts[(i + n - 1) % n]!, pts[i]!, pts[(i + 1) % n]!);
        if (!turned) return w[going];
        // walked the other way, going out of a point is coming into it backwards
        const back = going === "out" ? w.into : w.out;
        return [-back[0], -back[1]];
    };
    const legs: Leg[] = [];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = pts[i]!;
        const b = pts[j]!;
        if (dist(a, b) < EPS_GEOM) continue;
        // walked the other way, the leg from i to j is the given leg out of j's point
        const side = straight[turned ? at(j) : at(i)]!;
        const out = way(i, "out");
        const into = way(j, "into");
        if (side || (!out && !into)) legs.push({ at: b });
        else if (!out) {
            // out of a bare corner into the curve: one arc that arrives the way the curve runs
            const k = bulgeArriving(a, b, into!);
            legs.push({ at: b, ...(k ? { bulge: k } : {}) });
        } else if (!into) {
            const k = bulgeLeaving(a, b, out);
            legs.push({ at: b, ...(k ? { bulge: k } : {}) });
        } else legs.push(...twoArcs(a, out, b, into));
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
 * Past this angle from one neighbor, another marcher is on a marcher's other side (70°): its two
 * neighbors in a loop stand on either side of it, however the loop bends there. Measured on
 * loops placed by hand a step off their places and on scattered marchers: narrower misses real
 * loops of eight where they bend most, wider takes more scatters for loops.
 */
const OTHER_SIDE = Math.cos((70 * Math.PI) / 180);

/**
 * Each marcher's two neighbors, read from where they stand and nothing else: the nearest other
 * marcher, and the nearest one on its other side ({@link OTHER_SIDE}). Marchers equally near go
 * to the one further left, then further up, so the answer never depends on the order they are
 * asked about. Null when one of them has nobody on its other side (the end of a line).
 */
function neighborsOf(starts: readonly XY[]): [number, number][] | null {
    const n = starts.length;
    const first = (a: XY, b: XY) =>
        a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    const nearest = (i: number, ok: (j: number) => boolean): number => {
        let best = -1;
        let d = Infinity;
        for (let j = 0; j < n; j++) {
            if (j === i || !ok(j)) continue;
            const dj = dist(starts[i]!, starts[j]!);
            const same = Math.abs(dj - d) <= 1e-9 * Math.max(1, d);
            if (best < 0 || (!same && dj < d)) {
                best = j;
                d = dj;
            } else if (same && first(starts[j]!, starts[best]!)) best = j;
        }
        return best;
    };
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
        const one = nearest(i, () => true);
        if (one < 0) return null;
        const u = sub(starts[one]!, starts[i]!);
        const lu = len(u);
        const other = nearest(i, (j) => {
            if (j === one) return false;
            const v = sub(starts[j]!, starts[i]!);
            const lv = len(v);
            return lv > EPS_GEOM && dot(u, v) < OTHER_SIDE * lu * lv;
        });
        if (other < 0) return null;
        out.push([one, other]);
    }
    return out;
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
 * - every marcher has **two neighbors, one on either side** ({@link neighborsOf}: its nearest
 *   marcher, and the nearest on its other side), and each of those names it back, so it is read
 *   from where they stand and never from the order they are asked about (the end of a line has
 *   nobody on its other side; in a block and among scattered marchers the neighbors don't agree);
 * - following those neighbors goes round every one of them once and comes back;
 * - no gap is more than 2.5 times the usual one, the closing one included;
 * - the ring is the outline of a loop ({@link outlinesALoop}): it doesn't cross itself, it
 *   encloses room, and it turns back on itself nowhere.
 *
 * Four or more. Null otherwise: an open line or curve, a block, scattered marchers.
 */
export function ringOrder(starts: readonly XY[]): number[] | null {
    const n = starts.length;
    if (n < 4) return null;
    const beside = neighborsOf(starts);
    if (!beside) return null;
    // each one's neighbors name it back
    for (let i = 0; i < n; i++)
        for (const j of beside[i]!) if (!beside[j]!.includes(i)) return null;
    // round from the first, never back the way it came: every one of them, once
    const order = [0];
    for (let from = -1, at = 0; order.length < n; ) {
        const [a, b] = beside[at]!;
        const next = a === from ? b : a;
        if (next === 0 || order.includes(next)) return null;
        order.push(next);
        from = at;
        at = next;
    }
    if (!beside[order[n - 1]!]!.includes(0)) return null;
    const gaps = order.map((i, k) =>
        dist(starts[i]!, starts[order[(k + 1) % n]!]!),
    );
    const usual = median(gaps);
    if (!(usual > EPS_GEOM) || Math.max(...gaps) > 2.5 * usual) return null;
    return outlinesALoop(starts, order) ? order : null;
}
