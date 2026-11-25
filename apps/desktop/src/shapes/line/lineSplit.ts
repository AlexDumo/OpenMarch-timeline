import { makePath, type Segment } from "../geometry/path";
import { layGroups } from "../spacing";
import type { Slot, XY } from "../types";
import {
    isClosed,
    lineSegments,
    lineSpots,
    type LineGroup,
    type LineParams,
    type LinePoint,
    type LineSpacing,
    MAX_TENSION,
} from "./lineGeometry";

/**
 * **Split here** (#1336, epic #1335): an open Line, Curve or Arc cut in two in the gap between two
 * of its marchers. Nobody moves: the first piece ends on the last marcher before the cut and the
 * second starts on the first marcher after it. Each piece keeps its stretches' types (an arc's
 * piece is an arc with its share of the sweep) and the line's settings. Everything here is pure.
 */

/** Spots closer than this along the line are one, in field units */
const SAME_SPOT = 1e-6;

/** The first `count` of a run of marchers in `groups`, from marcher `from` on, as groups */
function groupsOf(
    groups: readonly LineGroup[],
    n: number,
    from: number,
    count: number,
): LineGroup[] {
    const laid = layGroups(groups, n);
    const out: LineGroup[] = [];
    let start = 0;
    laid.forEach(({ count: c }, i) => {
        const lo = Math.max(start, from);
        const hi = Math.min(start + c, from + count);
        if (hi > lo)
            out.push({ interval: groups[i]!.interval, count: hi - lo });
        start += c;
    });
    // One group is every gap at its interval, as a line with one interval has it
    if (out.length <= 1)
        return groups[0] ? [{ interval: (out[0] ?? groups[0]).interval }] : [];
    return out;
}

/**
 * How a piece of `count` marchers, from marcher `from` on, is spaced: as the line is, its interval
 * groups cut where it's cut. On the path, the first piece's run lies from its end and the second's
 * from its start, the cut being where each run meets it.
 */
function pieceSpacing(
    spacing: LineSpacing,
    n: number,
    from: number,
    count: number,
    first: boolean,
): LineSpacing {
    switch (spacing.mode) {
        case "fit":
            return spacing.groups
                ? {
                      mode: "fit",
                      groups: groupsOf(spacing.groups, n, from, count),
                  }
                : { mode: "fit" };
        case "keep":
            return {
                mode: "keep",
                groups: groupsOf(spacing.groups, n, from, count),
            };
        case "path":
            return {
                mode: "path",
                groups: groupsOf(spacing.groups, n, from, count),
                anchor: first ? "end" : "start",
            };
    }
}

/** How far round segment `seg` the point `at` on it is, from 0 at its start to 1 at its end */
function sweptTo(seg: Segment, at: XY, along: number, length: number): number {
    if (seg.type === "ellipse") {
        // The bend is the angle round the ellipse, not its length along it
        const c = Math.cos(-seg.rotation);
        const s = Math.sin(-seg.rotation);
        const dx = at.x - seg.center.x;
        const dy = at.y - seg.center.y;
        const u = (dx * c - dy * s) / seg.rx;
        const v = (dx * s + dy * c) / seg.ry;
        const turn = 2 * Math.PI;
        const angle = Math.sign(seg.sweep) * (Math.atan2(v, u) - seg.start);
        const round = ((angle % turn) + turn) % turn;
        // Its end, a whole turn round from its start, reads as its end
        const f = round / Math.abs(seg.sweep);
        return f > 1 + 1e-9 && along >= length - SAME_SPOT ? 1 : Math.min(1, f);
    }
    return length > 0 ? along / length : 0;
}

/**
 * The open line `p` from `from` to `to` along it (field units, `0 ≤ from < to ≤` its length),
 * through its points between. A stretch cut keeps its type: an arc's piece is the arc's own,
 * turning its share of the sweep; a new end inside a curve is as smooth as the smoother of the
 * curve's points, so the curve near it bends a little differently. The ends say nothing of holding
 * a marcher: an open line's always hold one.
 */
export function lineBetween(
    p: LineParams,
    from: number,
    to: number,
): LineParams {
    const segments = lineSegments(p);
    const lengths = segments.map((seg) => makePath([seg]).length);
    const starts: number[] = [];
    let total = 0;
    for (const l of lengths) {
        starts.push(total);
        total += l;
    }
    const path = makePath(segments);
    const eps = 1e-9 * Math.max(1, total);
    /** The segment `s` is in: the one starting before it, or after it for an end (`late`) */
    const segmentAt = (s: number, late: boolean): number => {
        const i = starts.findLastIndex((t) =>
            late ? t < s - eps : t <= s + eps,
        );
        return Math.min(Math.max(i, 0), segments.length - 1);
    };
    /** How far round segment `i` the point `s` along the line is */
    const fraction = (i: number, s: number): number =>
        sweptTo(segments[i]!, path.at(s), s - starts[i]!, lengths[i]!);
    /** Point `i`'s bend over its stretch from `s0` to `s1` along the line, scaled to that share */
    const bendOver = (
        q: LinePoint,
        i: number,
        s0: number,
        s1: number,
    ): Partial<LinePoint> => {
        if (!q.bend) return {};
        const share = fraction(i, s1) - fraction(i, s0);
        return {
            bend: q.bend * share,
            ...(q.ellipse ? { ellipse: q.ellipse } : {}),
        };
    };
    const plain = ({
        marcher: _marcher,
        bend: _bend,
        ellipse: _ellipse,
        ...q
    }: LinePoint): LinePoint => q;
    const pointStart = (s: number): number => {
        const i = p.points.findIndex(
            (_, k) =>
                k < segments.length &&
                Math.abs((starts[k] ?? total) - s) <= eps,
        );
        return i;
    };

    const points: LinePoint[] = [];
    // Its first point: one of the line's, or a new one inside the stretch there
    const first = segmentAt(from, false);
    const firstEnd = Math.min(to, starts[first]! + lengths[first]!);
    const own = pointStart(from);
    const firstAt = own >= 0 ? p.points[own]! : null;
    const a = p.points[first]!;
    const b = p.points[first + 1]!;
    const corner = firstAt ?? {
        ...path.at(from),
        tension: Math.max(a.tension, b.tension),
    };
    points.push({
        ...plain(corner),
        ...bendOver(a, first, from, firstEnd),
    });
    // The points between, each bending over as much of its stretch as is kept
    for (let i = first + 1; i < p.points.length - 1; i++) {
        const at = starts[i]!;
        if (at >= to - eps) break;
        const q = p.points[i]!;
        const end = Math.min(to, at + lengths[i]!);
        const { bend: _b, ellipse: _e, ...rest } = q;
        points.push({ ...rest, ...bendOver(q, i, at, end) });
    }
    // Its last point: the line's end or a point of it, or a new one inside the stretch there
    const last = segmentAt(to, true);
    const ownEnd = p.points.findIndex(
        (_, k) =>
            Math.abs((k < segments.length ? starts[k]! : total) - to) <= eps,
    );
    const endAt = ownEnd >= 0 ? p.points[ownEnd]! : null;
    const c = p.points[last]!;
    const d = p.points[last + 1]!;
    points.push(
        plain(
            endAt ?? {
                ...path.at(to),
                tension: Math.max(c.tension, d.tension),
            },
        ),
    );
    const {
        closed: _closed,
        distribution: _distribution,
        rows: _rows,
        ...rest
    } = p;
    return { ...rest, points };
}

/** The line's `n` spots in order along it */
function spotsAlong(p: LineParams, n: number): Slot[] {
    const path = makePath(lineSegments(p));
    return lineSpots(p, n)
        .map((spot) => ({ ...spot, s: spot.s ?? path.project(spot) }))
        .sort((x, y) => x.s - y.s);
}

/**
 * How many of the line's `n` spots a split at `at` (a field point on or by it) leaves in the
 * first piece: the spots before it along the line, one it's on among them. Null when every spot
 * is on one side, so there'd be nothing to split off.
 */
export function splitCount(p: LineParams, n: number, at: XY): number | null {
    if (isClosed(p) || n < 2) return null;
    const path = makePath(lineSegments(p));
    const s = path.project(at);
    const k = spotsAlong(p, n).filter(
        (spot) => spot.s! <= s + SAME_SPOT,
    ).length;
    return k >= 1 && k <= n - 1 ? k : null;
}

/** A piece of a split line: its params (null for one spot, which is no line) and spot count */
export interface LinePiece {
    readonly params: LineParams | null;
    readonly spots: number;
}

/** The farthest any of `spots` is from where `want` says it should be */
function drift(spots: readonly XY[], want: readonly XY[]): number {
    if (spots.length !== want.length) return Infinity;
    return Math.max(
        0,
        ...spots.map((q, i) => Math.hypot(q.x - want[i]!.x, q.y - want[i]!.y)),
    );
}

/**
 * The piece with the roundness of its new end (point `index`, cut inside a curve) the one that
 * keeps its spots nearest where they were: a curve's new end can't bend exactly as the whole
 * curve did there, so it's tuned to come closest
 */
function tunedEnd(
    piece: LineParams,
    index: number,
    want: readonly XY[],
): LineParams {
    const q = piece.points[index]!;
    if (q.tension === 0) return piece;
    const withT = (tension: number): LineParams => ({
        ...piece,
        points: piece.points.map((r, i) =>
            i === index ? { ...r, tension } : r,
        ),
    });
    const cost = (t: number) => drift(lineSpots(withT(t), want.length), want);
    // Golden-section search over the roundness, from a corner to the roundest
    let lo = 0;
    let hi = MAX_TENSION;
    const g = (Math.sqrt(5) - 1) / 2;
    let x1 = hi - g * (hi - lo);
    let x2 = lo + g * (hi - lo);
    let f1 = cost(x1);
    let f2 = cost(x2);
    for (let i = 0; i < 30; i++) {
        if (f1 < f2) {
            hi = x2;
            x2 = x1;
            f2 = f1;
            x1 = hi - g * (hi - lo);
            f1 = cost(x1);
        } else {
            lo = x1;
            x1 = x2;
            f1 = f2;
            x2 = lo + g * (hi - lo);
            f2 = cost(x2);
        }
    }
    const best = (lo + hi) / 2;
    return cost(best) < cost(q.tension) ? withT(best) : piece;
}

/**
 * The open line `p` of `n` spots split after its first `k` along it: the first piece from its
 * first spot to spot `k − 1`, the second from spot `k` to its last, each with its spots where they
 * were (see the module's note); on the path, from the line's own ends, so each run lies where it
 * did on the drawn line. A piece of one spot has no params.
 */
export function splitLine(
    p: LineParams,
    n: number,
    k: number,
): readonly [LinePiece, LinePiece] {
    const spots = spotsAlong(p, n);
    const total = makePath(lineSegments(p)).length;
    const onPath = p.spacing.mode === "path";
    const piece = (
        from: number,
        to: number,
        first: number,
        count: number,
        isFirst: boolean,
    ): LinePiece => {
        if (count < 2) return { spots: count, params: null };
        const cut: LineParams = {
            ...lineBetween(p, from, to),
            spacing: pieceSpacing(p.spacing, n, first, count, isFirst),
        };
        const want = spots.slice(first, first + count);
        const index = isFirst ? cut.points.length - 1 : 0;
        return { spots: count, params: tunedEnd(cut, index, want) };
    };
    return [
        piece(onPath ? 0 : spots[0]!.s!, spots[k - 1]!.s!, 0, k, true),
        piece(spots[k]!.s!, onPath ? total : spots[n - 1]!.s!, k, n - k, false),
    ];
}
