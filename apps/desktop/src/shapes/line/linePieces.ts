import { makePath, type Segment } from "../geometry/path";
import { dist, len, sub } from "../geometry/vec";
import type { XY } from "../types";
import {
    bends,
    bentSegment,
    holdsMarcher,
    lineSpots,
    splitSegment,
    intoCircle,
    isClosed,
    lineSegments,
    outOfCircle,
    setSegmentCurved,
    type LineParams,
    type LinePoint,
} from "./lineGeometry";

/**
 * A Line built from pieces (#1216, step 1 #1218): each stretch from one point to the next is
 * straight, curved (it follows its points' tension) or an arc (its first point's `bend`). The
 * storage is the Line's own ({@link LinePoint.bend}), so nothing here needs a migration. Pure.
 */

/** What a stretch of a line is */
export type PieceType = "straight" | "curved" | "arc";

/** The sweep an arc stretch gets when no neighbor gives it a direction, in degrees */
export const PIECE_BEND = 90;
/** The most an arc stretch turns either way, in degrees (a full turn isn't a stretch) */
export const MAX_PIECE_BEND = 359;
/** The least an arc stretch turns, so dragging it flat keeps it an arc */
export const MIN_PIECE_BEND = 1;
/**
 * Below this angle between a neighbor's direction and the stretch, the stretch carries straight
 * on, and an arc tangent to it would be too flat to see: it gets {@link PIECE_BEND} instead
 */
const STRAIGHT_ON = 10;

const RAD = Math.PI / 180;

/** Segment `index`'s point and the one after it (a closed line's last wraps to its first) */
function endsOf(p: LineParams, index: number): [LinePoint, LinePoint] {
    const count = p.points.length;
    return [p.points[index]!, p.points[(index + 1) % count]!];
}

/** What segment `index` is: an arc where its point bends, else straight or curved as drawn */
export function pieceType(p: LineParams, index: number): PieceType {
    const point = p.points[index];
    if (point && bends(point)) return "arc";
    return lineSegments(p)[index]?.type === "line" ? "straight" : "curved";
}

/** `p` with segment `index`'s arc taken off, so it follows its points' tension again */
function withoutBend(p: LineParams, index: number): LineParams {
    const q = p.points[index];
    if (!q || (q.bend === undefined && q.ellipse === undefined)) return p;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { bend, ellipse, ...rest } = q;
    return {
        ...p,
        points: p.points.map((point, i) => (i === index ? rest : point)),
    };
}

/** The angle from `a` to `b`, in degrees, signed as the path's arcs turn (toward +y positive) */
function turnBetween(a: XY, b: XY): number {
    return Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y) / RAD;
}

/** The way a segment runs at its end (`at` 1) or start (`at` 0), measured on its path */
function directionOf(segment: Segment, at: 0 | 1): XY | null {
    const path = makePath([segment]);
    if (path.length < 1e-9) return null;
    const step = Math.min(path.length / 100, 0.5);
    const d =
        at === 1
            ? sub(path.at(path.length), path.at(path.length - step))
            : sub(path.at(step), path.at(0));
    return len(d) < 1e-12 ? null : d;
}

/**
 * The sweep an arc on segment `index` starts with: tangent to the stretch before it, so it carries
 * on from it without a kink, else to the stretch after it, else {@link PIECE_BEND}. A tangent arc
 * turns twice the angle between the neighbor's direction and the chord.
 */
export function startingBend(p: LineParams, index: number): number {
    const segments = lineSegments(p);
    const count = segments.length;
    const closed = isClosed(p);
    const [a, b] = endsOf(p, index);
    const chord = sub(b, a);
    if (len(chord) < 1e-9) return PIECE_BEND;
    const before = index > 0 || closed ? (index - 1 + count) % count : -1;
    const after = index < count - 1 || closed ? (index + 1) % count : -1;
    const tangentTo = (direction: XY | null, flip: boolean): number | null => {
        if (!direction) return null;
        // Into the stretch's start, or out of its end (read backwards, so the turn is the same)
        const angle = flip
            ? turnBetween(chord, direction)
            : turnBetween(direction, chord);
        if (Math.abs(angle) < STRAIGHT_ON) return null;
        return clampBend(2 * angle);
    };
    if (before >= 0 && before !== index) {
        const bend = tangentTo(directionOf(segments[before]!, 1), false);
        if (bend !== null) return bend;
    }
    if (after >= 0 && after !== index) {
        const bend = tangentTo(directionOf(segments[after]!, 0), true);
        if (bend !== null) return bend;
    }
    return PIECE_BEND;
}

/** A sweep kept short of a full turn and away from flat, its sign kept */
function clampBend(degrees: number): number {
    const sign = degrees < 0 ? -1 : 1;
    const size = Math.min(
        MAX_PIECE_BEND,
        Math.max(MIN_PIECE_BEND, Math.abs(degrees)),
    );
    return sign * size;
}

/**
 * `p` with segment `index` made `type` (#1218): straight (both its points corners), curved (both
 * smooth) or an arc ({@link startingBend}). An arc made straight or curved loses its bend; a
 * stretch already that type is returned as it is.
 */
export function setPieceType(
    p: LineParams,
    index: number,
    type: PieceType,
): LineParams {
    if (index < 0 || index >= lineSegments(p).length) return p;
    if (pieceType(p, index) === type) return p;
    if (type === "arc") {
        const bend = startingBend(p, index);
        return {
            ...p,
            points: p.points.map((q, i) => (i === index ? { ...q, bend } : q)),
        };
    }
    return setSegmentCurved(withoutBend(p, index), index, type === "curved");
}

/**
 * The signed sweep of the arc from `a` to `b` through `m` (in degrees), clamped as
 * {@link clampBend}: the inscribed angle at `m` is half the turn of the arc that doesn't hold it
 */
export function bendThrough(a: XY, b: XY, m: XY): number {
    const ma = sub(a, m);
    const mb = sub(b, m);
    if (len(ma) < 1e-9 || len(mb) < 1e-9) return MIN_PIECE_BEND;
    const inscribed = Math.abs(turnBetween(ma, mb));
    const size = 360 - 2 * inscribed;
    // Which way: the side of the chord `m` is on. A positive sweep bulges to the chord's left
    // (toward -y from a chord along +x), as `bentSegment` draws it
    const side = Math.sign(
        (b.x - a.x) * (m.y - a.y) - (b.y - a.y) * (m.x - a.x),
    );
    return clampBend((side >= 0 ? -1 : 1) * size);
}

/**
 * `p` with arc segment `index` bent to pass through `to` (its middle handle dragged, #1218), its
 * ends kept. On an ellipse the turn is found where the ellipse is a circle.
 */
export function bendPieceThrough(
    p: LineParams,
    index: number,
    to: XY,
): LineParams {
    const q = p.points[index];
    if (!q || !bends(q)) return p;
    const [a, b] = endsOf(p, index);
    const bend = q.ellipse
        ? bendThrough(
              intoCircle(a, q.ellipse),
              intoCircle(b, q.ellipse),
              intoCircle(to, q.ellipse),
          )
        : bendThrough(a, b, to);
    if (bend === q.bend) return p;
    return {
        ...p,
        points: p.points.map((point, i) =>
            i === index ? { ...point, bend } : point,
        ),
    };
}

/**
 * The point halfway round arc segment `index`, by its turn: on a circle the middle of its length,
 * on an ellipse the middle where the ellipse is a circle, so both halves share its ellipse
 */
function arcHalfway(p: LineParams, index: number): XY {
    const q = p.points[index]!;
    const [a, b] = endsOf(p, index);
    if (!q.ellipse) {
        const path = makePath([lineSegments(p)[index]!]);
        return path.at(path.length / 2);
    }
    const round = makePath([
        bentSegment(
            intoCircle(a, q.ellipse),
            intoCircle(b, q.ellipse),
            q.bend!,
        ),
    ]);
    return outOfCircle(round.at(round.length / 2), q.ellipse);
}

/**
 * Arc segment `index` split at its middle into two arcs, each half its turn, so the line looks the
 * same (#1218). The new point is a corner; `more` is set on it (a marcher answer). Null when the
 * segment isn't an arc.
 */
export function splitArc(
    p: LineParams,
    index: number,
    more?: Partial<LinePoint>,
): LineParams | null {
    const q = p.points[index];
    if (!q || !bends(q) || index >= lineSegments(p).length) return null;
    const at = arcHalfway(p, index);
    const half = q.bend! / 2;
    const point: LinePoint = {
        x: at.x,
        y: at.y,
        tension: 0,
        bend: half,
        ...(q.ellipse ? { ellipse: q.ellipse } : {}),
        ...more,
    };
    return {
        ...p,
        points: [
            ...p.points.slice(0, index),
            { ...q, bend: half },
            point,
            ...p.points.slice(index + 1),
        ],
    };
}

/**
 * Segment `index` split with a new point (a click on its middle, Add point here, or the start of
 * a drag): an arc into two half arcs ({@link splitArc}), anything else as `splitSegment`. On an
 * arc the new corner holds a marcher only where one of the `n` already stands, so splitting moves
 * no one (as `splitSegment` does on a straight stretch); elsewhere it keeps the spacing even.
 */
export function splitPiece(
    p: LineParams,
    index: number,
    n?: number,
): LineParams {
    const arc = splitArc(p, index);
    if (!arc) return splitSegment(p, index, n);
    if (n === undefined || !holdsMarcher(arc, index + 1)) return arc;
    const at = arc.points[index + 1]!;
    if (lineSpots(p, n).some((spot) => dist(spot, at) < 1e-3)) return arc;
    return p.spacing.mode === "path"
        ? arc
        : splitArc(p, index, { marcher: false })!;
}
