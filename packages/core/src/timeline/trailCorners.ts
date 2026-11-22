/**
 * Corner counts for block letters, pathways step 6 (spec Appendix L.9, TC-1 to TC-4): the corners
 * of a follow-the-leader trail and the count each member turns on at each one.
 *
 * What the warning is for (owner, 2026-11-22): "turns between counts" matters where a marcher
 * has to plant and turn sharply on a count. So a corner is only a real corner: a vertex of a box
 * or shape the line stands in or goes round, or a corner point drawn on the trail. A curve never
 * has one: not along an arc leg (step 10a), a circle, a smooth point's curve, nor a line standing
 * in a curve, whatever its spacing. A circle shows no corner chips and no warning at all.
 *
 * Counts are derived, never stored or pinned (O-1, draft model §4.5). The way is the resolver's
 * own (R-9′, R-13′, R-13″), built by the same functions, so a member is exactly at the corner at
 * the beat its count names (R-10 read backward).
 */
import {
    alongEnds,
    cumOf,
    makeAlongTrail,
    makeTrail,
    pointsPath,
    type RoutePath,
    type RouteWalk,
} from "./geom";
import type { FtlTrail, XY } from "./types";

/** TC-1: the smallest turn that is a corner, in radians (20°) */
export const CORNER_MIN_TURN = (20 * Math.PI) / 180;

/**
 * TC-1: a bend between two legs of the line-up or the end line (where the marchers stand) is a
 * corner only when it turns this much more than each neighboring bend between two such legs
 * (20°), and those neighbors run straight (each turns less than {@link CORNER_MIN_TURN}): a box's
 * or a block letter's vertex. A line standing in a curve or an arc gets none, even where uneven
 * spacing or a gap makes one bend stand out (owner, 2026-11-22).
 */
export const CORNER_STAND_OUT = (20 * Math.PI) / 180;

/** TC-2: within this many counts of its own start or stop a member starts or stops, not turns */
export const ON_COUNT_TOLERANCE = 0.05;

/** TC-2: how far past its start, and short of its end, a member must be to turn at a corner */
const PASS_EPS = 1e-6;

/** One member's walk on the way: R-10's (or R-13″'s) start, end and straight leg to its spot */
export interface WayWalk {
    startDist: number;
    endDist: number;
    /** R-13″: the straight leg from the way to the spot; 0 or absent otherwise */
    straight?: number;
    /**
     * When its founding span ends, in counts from the move's start (taken over, or cut by a
     * higher layer, partway): it turns at no corner it would reach after that. Absent: the end.
     */
    until?: number;
}

/** A corner of the way (TC-1) */
export interface WayCorner {
    /** Its distance along the way */
    d: number;
    at: XY;
    /** The turn, signed (positive to the left, counterclockwise), in radians */
    turn: number;
    /** The way's direction arriving and leaving, unit vectors (for placing a label outside it) */
    dirIn: XY;
    dirOut: XY;
}

/** One member's turn at a corner (TC-2, TC-3) */
export interface CornerTurn {
    /** The member's index, tail first (q) */
    q: number;
    /** The count it turns on, from the move's start (TC-3) */
    count: number;
    /** TC-4 */
    onCount: boolean;
}

/** A corner with each member's turn there */
export interface CornerCount extends WayCorner {
    /** Who turns there, leader first (the first to reach it) */
    turns: CornerTurn[];
    /** Members that stop on the way, or leave the trail (taken over), before turning there */
    stopBefore: number;
    /** Whether any member turns between counts there (TC-4, TC-5) */
    offCount: boolean;
}

/** TC-4: a count as shown, rounded to a tenth (the display and the warning use this one value) */
export const roundCount = (count: number): number =>
    Math.round(count * 10) / 10;

/** TC-4: whether a count is on a whole count: it is whole once rounded to a tenth */
export const isOnCount = (count: number): boolean =>
    Number.isInteger(roundCount(count));

/** A stretch of the way with its direction at each end */
interface Stretch {
    d0: number;
    d1: number;
    a: XY;
    dirIn: XY | null;
    dirOut: XY | null;
    /** A leg of the line-up or the end line (through where marchers stand), not the drawn part */
    standing?: boolean;
    /** A standing leg of a line that stands in a circular arc ({@link standsOnArc}) */
    arc?: boolean;
}

const unit = (v: XY): XY | null => {
    const l = Math.hypot(v[0], v[1]);
    return l > 1e-12 ? [v[0] / l, v[1] / l] : null;
};
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const rotate = (u: XY, a: number): XY => [
    u[0] * Math.cos(a) - u[1] * Math.sin(a),
    u[0] * Math.sin(a) + u[1] * Math.cos(a),
];

/**
 * TC-1 (owner, 2026-11-22): how far a marcher may stand off the circle the line fits, as a share
 * of its radius, for the line to stand in an arc
 */
export const ARC_FIT = 0.06;

/**
 * Whether marchers standing at `pts` stand in a circular arc, in order round it (owner,
 * 2026-11-22): four or more, each within {@link ARC_FIT} of the radius of the circle they fit, and
 * each a step on round it the same way, less than half round. Their bends are then a curve, not
 * corners, however uneven the spacing or wide a gap.
 */
export function standsOnArc(pts: readonly XY[]): boolean {
    const n = pts.length;
    if (n < 4) return false;
    // the circle they fit best (x² + y² + a·x + b·y + c = 0 by least squares), about their
    // middle so the sums stay well scaled
    let mx = 0;
    let my = 0;
    for (const p of pts) {
        mx += p[0] / n;
        my += p[1] / n;
    }
    let sxx = 0,
        sxy = 0,
        syy = 0,
        sx = 0,
        sy = 0,
        sxz = 0,
        syz = 0,
        sz = 0;
    for (const p of pts) {
        const x = p[0] - mx;
        const y = p[1] - my;
        const z = x * x + y * y;
        sxx += x * x;
        sxy += x * y;
        syy += y * y;
        sx += x;
        sy += y;
        sxz += x * z;
        syz += y * z;
        sz += z;
    }
    // normal equations for (a, b, c), solved by determinants
    const m = [
        [sxx, sxy, sx],
        [sxy, syy, sy],
        [sx, sy, n],
    ];
    const r = [-sxz, -syz, -sz];
    const det3 = (q: number[][]) =>
        q[0]![0]! * (q[1]![1]! * q[2]![2]! - q[1]![2]! * q[2]![1]!) -
        q[0]![1]! * (q[1]![0]! * q[2]![2]! - q[1]![2]! * q[2]![0]!) +
        q[0]![2]! * (q[1]![0]! * q[2]![1]! - q[1]![1]! * q[2]![0]!);
    const D = det3(m);
    if (!(Math.abs(D) > 1e-12)) return false;
    const col = (k: number) =>
        m.map((row, i) => row.map((v, j) => (j === k ? r[i]! : v)));
    const a = det3(col(0)) / D;
    const b = det3(col(1)) / D;
    const c = det3(col(2)) / D;
    const cx = -a / 2;
    const cy = -b / 2;
    const R2 = cx * cx + cy * cy - c;
    if (!(R2 > 0)) return false;
    const R = Math.sqrt(R2);
    // a near-straight line fits a huge circle: no arc to speak of (it has no bends either)
    let span = 0;
    for (const p of pts)
        span = Math.max(span, Math.hypot(p[0] - pts[0]![0], p[1] - pts[0]![1]));
    if (R > 50 * span) return false;
    let sign = 0;
    for (let i = 0; i < n; i++) {
        const x = pts[i]![0] - mx - cx;
        const y = pts[i]![1] - my - cy;
        if (Math.abs(Math.hypot(x, y) - R) > ARC_FIT * R) return false;
        if (i === 0) continue;
        const px = pts[i - 1]![0] - mx - cx;
        const py = pts[i - 1]![1] - my - cy;
        const step = Math.atan2(px * y - py * x, px * x + py * y);
        if (Math.abs(step) < 1e-9 || Math.abs(step) >= Math.PI / 2)
            return false;
        const s = Math.sign(step);
        if (sign !== 0 && s !== sign) return false;
        sign = s;
    }
    return true;
}

/** Straight stretches through `pts` from distance `d0`, skipping repeated points */
function polylineStretches(pts: readonly XY[], d0: number): Stretch[] {
    const out: Stretch[] = [];
    const cum = cumOf(pts);
    for (let i = 1; i < pts.length; i++) {
        const dir = unit(sub(pts[i]!, pts[i - 1]!));
        if (!dir) continue;
        out.push({
            d0: d0 + cum[i - 1]!,
            d1: d0 + cum[i]!,
            a: pts[i - 1]!,
            dirIn: dir,
            dirOut: dir,
            standing: true,
        });
    }
    return out;
}

/** R-14's pieces of a drawn part, with each piece's direction at its two ends (TC-1) */
function drawnStretches(W: RoutePath, d0: number): Stretch[] {
    return W.pieces.map((piece, j) => {
        const P0 = W.V[j]!;
        const P3 = W.V[j + 1]!;
        let start: XY | null;
        let end: XY | null;
        if (piece.kind === "line") start = end = unit(sub(P3, P0));
        else if (piece.kind === "arc") {
            // R-8's minor arc: its tangent is the chord turned by the half-angle φ = 2·atan(2k),
            // toward the bulge at its start and back at its end (arcPoint's frame)
            const chord = unit(sub(P3, P0));
            const phi = 2 * Math.atan(2 * piece.k);
            start = chord && rotate(chord, phi);
            end = chord && rotate(chord, -phi);
            // a chord too short for R-8 is drawn straight
            if (chord && Math.abs(phi) < 1e-12) start = end = chord;
        } else {
            start =
                unit(sub(piece.c1, P0)) ??
                unit(sub(piece.c2, P0)) ??
                unit(sub(P3, P0));
            end =
                unit(sub(P3, piece.c2)) ??
                unit(sub(P3, piece.c1)) ??
                unit(sub(P3, P0));
        }
        return {
            d0: d0 + W.D[j]!,
            d1: d0 + W.D[j + 1]!,
            a: P0,
            dirIn: start,
            dirOut: end,
        };
    });
}

/**
 * TC-1: the corners of a trail `trail` whose line-up runs through `origins` (tail first), and
 * whose end line (R-13′, from the entrance) is `endLine`, or none when its ends are along the way.
 */
export function wayCorners(
    trail: FtlTrail,
    origins: readonly XY[],
    endLine: readonly XY[] | null,
    minTurn = CORNER_MIN_TURN,
): WayCorner[] {
    // a line standing in an arc bends at every marcher, and none of it is a corner
    const standing = (pts: readonly XY[], d0: number): Stretch[] => {
        const arc = standsOnArc(pts);
        return polylineStretches(pts, d0).map((st) =>
            arc ? { ...st, arc } : st,
        );
    };
    const stretches: Stretch[] = standing(origins, 0);
    const lineLen = trail.cum[origins.length - 1] ?? 0;
    if (trail.drawn)
        stretches.push(...drawnStretches(trail.drawn.path, trail.drawn.start));
    else if (endLine?.length && origins.length)
        // no drawn part kept: R-9's straight leg from the leader to the entrance
        stretches.push(
            ...polylineStretches(
                [origins[origins.length - 1]!, endLine[0]!],
                lineLen,
            ).map((st) => ({ ...st, standing: false })),
        );
    if (endLine) stretches.push(...standing(endLine, trail.destOffset));
    // the turn at each joint, between stretch i - 1 and stretch i (null where a stretch has no
    // direction)
    const turns: (number | null)[] = stretches.map((st, i) => {
        if (i === 0) return null;
        const a = stretches[i - 1]!.dirOut;
        const b = st.dirIn;
        if (!a || !b) return null;
        return Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
    });
    // a bend between two standing legs (the line-up's or the end line's own)
    const standingBend = (i: number) =>
        i > 0 &&
        i < stretches.length &&
        !!stretches[i - 1]!.standing &&
        !!stretches[i]!.standing;
    const corners: WayCorner[] = [];
    for (let i = 1; i < stretches.length; i++) {
        const turn = turns[i];
        if (turn == null || Math.abs(turn) < minTurn) continue;
        // TC-1: a bend in the line-up or the end line (both legs standing) must stand out from
        // the standing bends beside it, and they must run straight, so a line in a curve or an
        // arc gets no corner at any marcher (owner, 2026-11-22: only a real vertex); the leader's
        // start and the entrance take the plain rule
        if (standingBend(i)) {
            if (stretches[i - 1]!.arc && stretches[i]!.arc) continue;
            const outdone = [i - 1, i + 1].some(
                (j) =>
                    standingBend(j) &&
                    (Math.abs(turn) <
                        Math.abs(turns[j] ?? 0) + CORNER_STAND_OUT ||
                        Math.abs(turns[j] ?? 0) >= minTurn),
            );
            if (outdone) continue;
        }
        corners.push({
            d: stretches[i]!.d0,
            at: stretches[i]!.a,
            turn,
            dirIn: stretches[i - 1]!.dirOut!,
            dirOut: stretches[i]!.dirIn!,
        });
    }
    return corners;
}

/**
 * TC-2 to TC-4: each corner with the members who turn there and their counts, `counts` being the
 * move's length in counts. `walks` are the members' walks on the way, tail first. Corners nobody
 * turns at are left out.
 */
export function cornerCounts(
    corners: readonly WayCorner[],
    walks: readonly WayWalk[],
    counts: number,
): CornerCount[] {
    const out: CornerCount[] = [];
    for (const corner of corners) {
        const turns: CornerTurn[] = [];
        let stopBefore = 0;
        walks.forEach((w, q) => {
            const total = w.endDist - w.startDist + (w.straight ?? 0);
            // a member starting on the corner, or behind its own start (waiting), never turns there
            if (corner.d <= w.startDist + PASS_EPS || !(total > 0)) return;
            const count = ((corner.d - w.startDist) / total) * counts;
            // the count it leaves the way on: the move's end, or its straight leg's start (R-13″)
            const leaves = ((w.endDist - w.startDist) / total) * counts;
            // TC-2: within a twentieth of a count of its own start or stop is starting or
            // stopping there, not turning
            if (
                corner.d >= w.endDist - PASS_EPS ||
                count > leaves - ON_COUNT_TOLERANCE
            ) {
                stopBefore++;
                return;
            }
            if (count < ON_COUNT_TOLERANCE) return;
            // taken over (or cut short) before reaching it: it leaves the trail first (TC-2)
            if (w.until !== undefined && count > w.until - ON_COUNT_TOLERANCE) {
                stopBefore++;
                return;
            }
            turns.push({ q, count, onCount: isOnCount(count) });
        });
        if (turns.length === 0) continue;
        turns.sort((a, b) => a.count - b.count || b.q - a.q);
        out.push({
            ...corner,
            turns,
            stopBefore,
            offCount: turns.some((t) => !t.onCount),
        });
    }
    return out;
}

/** How a trail's members end, as the resolver reads it */
export type TrailEnds =
    /** R-13″: along the way, each to its own spot (tail first) */
    | { kind: "along"; spots: readonly XY[] }
    /**
     * R-9′ with R-13′: into the end line through every slot's destination, in the order the line
     * enters it (slot order, or reversed with R-12′); `at[q]` is member `q`'s index on it
     */
    | { kind: "line"; endLine: readonly XY[]; at: readonly number[] };

/**
 * Step 6 (spec L.9): the corners of a follow-the-leader trail and each member's turning count
 * there. `origins` are the founders' starts, tail first; `route` the trail route (null for none);
 * `counts` the move's length in counts. The way and each member's walk are built exactly as the
 * resolver builds them (`makeTrail` or `makeAlongTrail`, `alongEnds`).
 */
export function trailCornerCounts(input: {
    origins: readonly XY[];
    route: RouteWalk | null;
    ends: TrailEnds;
    counts: number;
    /** Each member's founding span end in counts (`WayWalk.until`), tail first */
    until?: readonly (number | undefined)[];
    minTurn?: number;
}): CornerCount[] {
    const { origins, route, ends, counts } = input;
    if (origins.length === 0) return [];
    const startDist = (trail: FtlTrail) => origins.map((_, q) => trail.cum[q]!);
    const untilOf = (q: number) => {
        const u = input.until?.[q];
        return u === undefined ? {} : { until: u };
    };
    if (ends.kind === "along") {
        const trail = makeAlongTrail(origins, route);
        const s = startDist(trail);
        const e = alongEnds(trail, ends.spots, s);
        return cornerCounts(
            wayCorners(trail, origins, null, input.minTurn),
            s.map((d, q) => ({
                startDist: d,
                endDist: e.endDist[q]!,
                straight: e.straight[q]!,
                ...untilOf(q),
            })),
            counts,
        );
    }
    const line = ends.endLine.length ? ends.endLine : [origins.at(-1)!];
    const trail = makeTrail(origins, [], pointsPath(line), route);
    const s = startDist(trail);
    const along = cumOf(line);
    return cornerCounts(
        wayCorners(trail, origins, line, input.minTurn),
        s.map((d, q) => ({
            startDist: d,
            endDist: trail.destOffset + (along[ends.at[q] ?? 0] ?? 0),
            ...untilOf(q),
        })),
        counts,
    );
}

/**
 * The corners of a closed outline walked round (R-13‴, pathways step 10): where its pieces meet
 * at a turn of `minTurn` or more, the joint back at its start included. A box outline's four
 * vertices; none on a circle, whose quarter arcs meet without turning (owner, 2026-11-22).
 */
export function outlineCorners(
    loop: RoutePath,
    minTurn = CORNER_MIN_TURN,
): WayCorner[] {
    const stretches = drawnStretches(loop, 0);
    const n = stretches.length;
    const corners: WayCorner[] = [];
    for (let i = 0; i < n; i++) {
        const a = stretches[(i + n - 1) % n]!.dirOut;
        const b = stretches[i]!.dirIn;
        if (!a || !b || n < 2) continue;
        const turn = Math.atan2(
            a[0] * b[1] - a[1] * b[0],
            a[0] * b[0] + a[1] * b[1],
        );
        if (Math.abs(turn) < minTurn) continue;
        corners.push({
            d: stretches[i]!.d0,
            at: stretches[i]!.a,
            turn,
            dirIn: a,
            dirOut: b,
        });
    }
    return corners;
}

/** One member's walk round a closed outline (R-13‴), as the resolver has it */
export interface AroundWalk {
    /** Where it starts round the outline, and where it stops: past the start, laps included */
    startDist: number;
    endDist: number;
    /** Its straight step onto the outline first, and off it to its spot last; 0 for none */
    inStraight: number;
    straight: number;
    /** When its founding span ends, in counts from the move's start (`WayWalk.until`) */
    until?: number;
}

/**
 * TC-2 to TC-4 for a line going round a closed outline (R-13‴, pathways step 10): each of the
 * outline's corners ({@link outlineCorners}) with every time a member passes it, on which count,
 * leader first. Going more than once round, a member turns at a corner more than once. Starting or
 * stopping on a corner isn't turning there. Corners nobody turns at are left out, so a circle has
 * none.
 */
export function aroundCornerCounts(
    loop: RoutePath,
    walks: readonly AroundWalk[],
    counts: number,
    minTurn = CORNER_MIN_TURN,
): CornerCount[] {
    const L = loop.L;
    if (!(L > 0)) return [];
    const out: CornerCount[] = [];
    for (const corner of outlineCorners(loop, minTurn)) {
        const turns: CornerTurn[] = [];
        let stopBefore = 0;
        walks.forEach((w, q) => {
            const total = w.inStraight + w.endDist - w.startDist + w.straight;
            if (!(total > 0)) return;
            const leaves =
                ((w.inStraight + w.endDist - w.startDist) / total) * counts;
            // every time round it passes the corner: the first at or past its start
            let x = corner.d + Math.ceil((w.startDist - corner.d) / L) * L;
            let cut = false;
            for (; x < w.endDist - PASS_EPS; x += L) {
                if (x <= w.startDist + PASS_EPS) continue;
                const count =
                    ((w.inStraight + x - w.startDist) / total) * counts;
                if (count < ON_COUNT_TOLERANCE) continue;
                if (count > leaves - ON_COUNT_TOLERANCE) break;
                if (
                    w.until !== undefined &&
                    count > w.until - ON_COUNT_TOLERANCE
                ) {
                    cut = true;
                    break;
                }
                turns.push({ q, count, onCount: isOnCount(count) });
            }
            if (cut) stopBefore++;
        });
        if (turns.length === 0) continue;
        turns.sort((a, b) => a.count - b.count || b.q - a.q);
        out.push({
            ...corner,
            turns,
            stopBefore,
            offCount: turns.some((t) => !t.onCount),
        });
    }
    return out;
}
