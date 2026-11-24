import type { XY } from "../types";
import {
    bends,
    isClosed,
    type LineParams,
    type LinePoint,
    type LineSpacing,
} from "./lineGeometry";

/**
 * Joining two Lines into one (#1220, epic #1216), and running a Line the other way, which joining
 * needs. A Line, a Curve and an Arc are all Line recipes, so a figure built from pieces is one
 * Line whose stretches keep their own types. Everything here is pure.
 */

/** Ends this close, in steps, become one point; further apart, a straight stretch joins them */
export const JOIN_REACH_STEPS = 1;

/**
 * `p` run from its last point to its first, the same line on the field. A bend belongs to the
 * stretch after its point ({@link LinePoint.bend}), so each moves to the other end of its stretch
 * and turns the other way; an ellipse goes with its bend. Tensions and a point's own marcher
 * answer stay on their points. Groups of marchers run the other way too, a run laid from one end
 * is laid from the other, and an offset points back.
 */
export function reverseLine(p: LineParams): LineParams {
    const n = p.points.length;
    const closed = isClosed(p);
    const points = p.points.map((_, j): LinePoint => {
        const { bend: _bend, ellipse: _ellipse, ...own } = p.points[n - 1 - j]!;
        // New point j starts what was the stretch from point n - 2 - j, run backwards; an open
        // line's new last point starts none
        const k = n - 2 - j;
        const from =
            k >= 0 ? p.points[k] : closed ? p.points[k + n] : undefined;
        if (!from || !bends(from)) return own;
        return {
            ...own,
            bend: -from.bend!,
            ...(from.ellipse ? { ellipse: from.ellipse } : {}),
        };
    });
    const { offset, ...rest } = p;
    return {
        ...rest,
        points,
        spacing: reversedSpacing(p.spacing),
        ...(offset ? { offset: { x: -offset.x, y: -offset.y } } : {}),
    };
}

function reversedSpacing(spacing: LineSpacing): LineSpacing {
    if (spacing.mode === "fit")
        return spacing.groups
            ? { ...spacing, groups: [...spacing.groups].reverse() }
            : spacing;
    const groups = [...spacing.groups].reverse();
    if (spacing.mode === "keep") return { ...spacing, groups };
    const anchor =
        spacing.anchor === "start"
            ? "end"
            : spacing.anchor === "end"
              ? "start"
              : "center";
    return { ...spacing, groups, anchor };
}

/** How two Lines join: the one Line, and which of them had to run the other way to make it */
export interface JoinedLines {
    readonly params: LineParams;
    /** The first Line runs the other way in the joined one: its joined end was its first point */
    readonly reversedA: boolean;
    /** The second Line runs the other way: its joined end was its last point */
    readonly reversedB: boolean;
    /** Their ends were close enough to become one point */
    readonly merged: boolean;
}

/** A point's place only: no tension, bend or marcher answer */
const placeOf = ({ x, y }: XY): XY => ({ x, y });

/**
 * A point of a line whose corners hold no marchers, kept that way in a joined line whose corners
 * do: a corner with no answer of its own says it holds none
 */
const holdsNone = (q: LinePoint): LinePoint =>
    q.tension === 0 && q.marcher === undefined ? { ...q, marcher: false } : q;

/**
 * Two open Lines joined into one at their nearest ends (#1220): `a`'s points with its joined end
 * last, then `b`'s with its joined end first, each running the other way if it must
 * ({@link reverseLine}). Ends within {@link JOIN_REACH_STEPS} steps of each other (`stepPx` field
 * units a step) become one point halfway between them; further apart, a straight stretch runs from
 * one to the other. Neither line moves otherwise, and each stretch keeps its type: an arc stays an
 * arc, a curve curved. Each joined end is a corner that holds a marcher, so exactly one marcher
 * stands on a joint.
 *
 * The joined line is spaced in Fit, one interval along its path. Its corners hold marchers when
 * either line's did; a corner of a line whose didn't says it holds none, so neither piece changes
 * which of its points hold one. Neither line may be closed.
 */
export function joinLines(
    a: LineParams,
    b: LineParams,
    stepPx: number,
): JoinedLines {
    const ends = [
        { aAtEnd: true, bAtStart: true },
        { aAtEnd: true, bAtStart: false },
        { aAtEnd: false, bAtStart: true },
        { aAtEnd: false, bAtStart: false },
    ].map((pair) => {
        const from = pair.aAtEnd ? a.points.at(-1)! : a.points[0]!;
        const to = pair.bAtStart ? b.points[0]! : b.points.at(-1)!;
        return { ...pair, apart: Math.hypot(to.x - from.x, to.y - from.y) };
    });
    // The nearest pair; on a tie the lines' own order (a's end to b's start) first
    const nearest = ends.reduce((best, pair) =>
        pair.apart < best.apart - 1e-9 ? pair : best,
    );
    const first = nearest.aAtEnd ? a : reverseLine(a);
    const second = nearest.bAtStart ? b : reverseLine(b);
    const end = first.points.at(-1)!;
    const start = second.points[0]!;
    const merged = nearest.apart <= JOIN_REACH_STEPS * stepPx + 1e-9;

    // Corners hold marchers unless both lines' didn't; a piece whose didn't keeps that
    const off = (p: LineParams) => p.corners === false;
    const bothOff = off(a) && off(b);
    const kept = (p: LineParams) => (q: LinePoint) =>
        !bothOff && off(p) ? holdsNone(q) : q;
    const head = first.points.slice(0, -1).map(kept(first));
    const tail = second.points.slice(1).map(kept(second));

    // A joint: a corner with a marcher on it, starting the stretch the second line's end started
    const joint = (at: XY, starts?: LinePoint): LinePoint => ({
        ...placeOf(at),
        tension: 0,
        marcher: true,
        ...(starts && bends(starts)
            ? {
                  bend: starts.bend!,
                  ...(starts.ellipse ? { ellipse: starts.ellipse } : {}),
              }
            : {}),
    });
    const points = merged
        ? [
              ...head,
              joint(
                  { x: (end.x + start.x) / 2, y: (end.y + start.y) / 2 },
                  start,
              ),
              ...tail,
          ]
        : [...head, joint(end), joint(start, start), ...tail];

    return {
        params: {
            points,
            spacing: { mode: "fit" },
            ...(bothOff ? { corners: false } : {}),
        },
        reversedA: !nearest.aAtEnd,
        reversedB: !nearest.bAtStart,
        merged,
    };
}
