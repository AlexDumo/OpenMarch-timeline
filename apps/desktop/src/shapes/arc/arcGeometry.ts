import type { ToolEnv } from "../tool/toolKind";
import type { ShapeFrame } from "../frame/frame";
import type { XY } from "../types";
import {
    bends,
    drawLine,
    isClosed,
    isLineParams,
    lineInFrame,
    segmentMidpoint,
    type LineParams,
    type LinePoint,
} from "../line/lineGeometry";

/**
 * The Arc (#634): a Line of two points whose segment bends as a circular arc, stored as the
 * Line's params with the first point's `bend` (its sweep in degrees). Closed, it is either the
 * arc and its chord (a straight segment back) or a whole circle (the second point's segment
 * bending round the rest of the way). Everything here is pure.
 */

/** How an arc is closed: open, by its chord, or round to a whole circle */
export type ArcEnds = "open" | "chord" | "circle";

/** The sweep a drawn arc starts with, in degrees: a quarter turn, bowing left of the drag */
export const DRAWN_BEND = 90;
/** The widest an arc can turn: short of a full turn, so its ends stay apart */
export const MAX_BEND = 359;
/** The narrowest: a hair off straight still reads as an arc */
export const MIN_BEND = 1;
/** Sweeps a dragged bend sticks to, in degrees (the owner's "90°, 180° …") */
const STICKY_BENDS = [45, 90, 135, 180, 225, 270, 315];
/** How near a sticky sweep a dragged bend sticks to it, in degrees */
const STICK = 6;

/** Whether `params` is an arc this version reads: a Line of two points, the first bent */
export function isArcParams(params: unknown): params is LineParams {
    if (!isLineParams(params)) return false;
    const [a, b, ...rest] = params.points;
    if (!a || !b || rest.length > 0 || !bends(a)) return false;
    // Only the circle's second point bends, the same way round, making up the full turn
    if (b.bend === undefined) return true;
    return (
        isClosed(params) &&
        Math.sign(b.bend) === Math.sign(a.bend!) &&
        Math.abs(Math.abs(a.bend!) + Math.abs(b.bend) - 360) < 1e-6
    );
}

/** The arc's sweep in degrees, signed (positive bows to the left from its first end) */
export const bendOf = (p: LineParams): number => p.points[0]?.bend ?? 0;

/** How the arc is closed */
export function arcEnds(p: LineParams): ArcEnds {
    if (!isClosed(p)) return "open";
    return p.points[1]?.bend !== undefined ? "circle" : "chord";
}

/** The two points with `bend` on the first, and the circle's rest of the turn on the second */
function withPoints(
    p: LineParams,
    bend: number,
    ends: ArcEnds,
): readonly LinePoint[] {
    const [a, b] = p.points as [LinePoint, LinePoint];
    const { bend: _was, ...second } = b;
    return [
        { ...a, bend },
        ends === "circle"
            ? { ...second, bend: Math.sign(bend) * (360 - Math.abs(bend)) }
            : second,
    ];
}

/** The arc turning through `bend` degrees, its ends where they are */
export function withBend(p: LineParams, bend: number): LineParams {
    const clamped =
        Math.sign(bend || 1) *
        Math.min(MAX_BEND, Math.max(MIN_BEND, Math.abs(bend)));
    if (clamped === bendOf(p)) return p;
    return { ...p, points: withPoints(p, clamped, arcEnds(p)) };
}

/**
 * The arc closed by its chord, closed round to a whole circle, or opened again. Its ends and
 * sweep stay, so opening gives back the arc it was; a fill goes with the opening.
 */
export function withEnds(p: LineParams, ends: ArcEnds): LineParams {
    if (ends === arcEnds(p)) return p;
    const points = withPoints(p, bendOf(p), ends);
    const {
        closed: _closed,
        distribution: _distribution,
        corners: _corners,
        ...rest
    } = p;
    if (ends === "open") return { ...rest, points };
    // Round a circle the marchers go evenly, with no corner holding one at the ends
    return ends === "circle"
        ? { ...rest, points, closed: true, corners: false }
        : {
              ...rest,
              points,
              closed: true,
              ...(p.distribution ? { distribution: p.distribution } : {}),
          };
}

/** Where the bend handle sits: halfway along the arc */
export const bendHandlePoint = (p: LineParams): XY => segmentMidpoint(p, 0);

/** The sweep, in degrees, of an arc between `a` and `b` passing through `through` */
function sweepThrough(a: XY, b: XY, through: XY): number {
    const d = { x: b.x - a.x, y: b.y - a.y };
    const chord = Math.hypot(d.x, d.y);
    if (chord < 1e-9) return 0;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // A positive sweep bows to the left of a → b on the field (toward -normal)
    const height = ((through.x - m.x) * d.y - (through.y - m.y) * d.x) / chord;
    return (4 * Math.atan((2 * height) / chord) * 180) / Math.PI;
}

/**
 * The sweep dragged to `degrees`: sticking to the common sweeps and in whole degrees with the
 * ladder on, whole degrees with `fine`, as dragged with the Snap toggle off
 */
export function landBend(degrees: number, env: ToolEnv): number {
    if (env.snap) {
        const size = Math.abs(degrees);
        const sticky = STICKY_BENDS.find((s) => Math.abs(size - s) <= STICK);
        if (sticky !== undefined) return Math.sign(degrees) * sticky;
        return Math.round(degrees);
    }
    if (env.fine) return Math.round(degrees);
    return Math.round(degrees * 10) / 10;
}

/**
 * The bend handle dragged to `to`: the arc through its two ends and `to`, its sweep landed
 * ({@link landBend}). It never straightens or flips through straight in one drag past
 * {@link MIN_BEND}, and a closed arc keeps bowing the way it did.
 */
export function dragBend(base: LineParams, to: XY, env: ToolEnv): LineParams {
    const [a, b] = base.points as [LinePoint, LinePoint];
    let sweep = sweepThrough(a, b, to);
    if (isClosed(base) && Math.sign(sweep) !== Math.sign(bendOf(base)))
        sweep = Math.sign(bendOf(base)) * MIN_BEND;
    return withBend(base, landBend(sweep, env));
}

/** An arc drawn from `from` to `to`: its ends landed as a Line's, bowing a quarter turn left */
export function drawArc(
    from: XY,
    to: XY,
    env: ToolEnv,
): LineParams | undefined {
    const line = drawLine(from, to, env);
    if (!line) return undefined;
    // A Line's diagonal yard-to-yard measure is for straight lines
    const { measured: _measured, ...rest } = line;
    return withBend(rest, DRAWN_BEND);
}

/** An arc across `frame` (another shape turned into an Arc): its width, as a half circle */
export function arcInFrame(
    frame: ShapeFrame,
    n: number,
    env: ToolEnv,
): LineParams {
    return withBend(lineInFrame(frame, n, env), 180);
}

/** The readout for a sweep: "90°" */
export const formatBend = (degrees: number): string =>
    `${Math.round(Math.abs(degrees) * 10) / 10}°`;
