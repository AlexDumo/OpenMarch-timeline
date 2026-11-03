import type { ToolEnv } from "../tool/toolKind";
import type { ShapeFrame } from "../frame/frame";
import type { XY } from "../types";
import {
    bends,
    bentSegment,
    drawLine,
    intoCircle,
    isClosed,
    isLineParams,
    lineInFrame,
    lineSegments,
    outOfCircle,
    segmentMidpoint,
    type LineEllipse,
    type LineParams,
    type LinePoint,
} from "../line/lineGeometry";
import { ellipsePoint } from "../geometry/path";
import { linePull } from "../frame/edgeGuides";

/**
 * The Arc (#634): a Line of two points whose segment bends as a circular arc, stored as the
 * Line's params with the first point's `bend` (its sweep in degrees). Closed, it is either the
 * arc and its chord (a straight segment back) or a whole circle (the second point's segment
 * bending round the rest of the way). Its segment can run on an ellipse instead of a circle
 * (`ellipse` on its points, owner on #634): everything round is then done where the ellipse is a
 * circle and stretched back. Everything here is pure.
 */

/** How an arc is closed: open, by its chord, or round to a whole circle */
export type ArcEnds = "open" | "chord" | "circle";

/** The sweep a drawn arc starts with, in degrees: a quarter turn, bowing left of the drag */
export const DRAWN_BEND = 90;
/** The widest an arc can turn: short of a full turn, so its ends stay apart */
export const MAX_BEND = 359;
/** The narrowest: a hair off straight still reads as an arc */
export const MIN_BEND = 1;

/** Whether `params` is an arc this version reads: a Line of two points, the first bent */
export function isArcParams(params: unknown): params is LineParams {
    if (!isLineParams(params)) return false;
    const [a, b, ...rest] = params.points;
    if (!a || !b || rest.length > 0 || !bends(a)) return false;
    // Only the circle's second point bends, the same way round, making up the full turn on the
    // same ellipse
    if (b.bend === undefined) return true;
    return (
        isClosed(params) &&
        Math.sign(b.bend) === Math.sign(a.bend!) &&
        Math.abs(Math.abs(a.bend!) + Math.abs(b.bend) - 360) < 1e-6 &&
        sameEllipse(a.ellipse, b.ellipse)
    );
}

const sameEllipse = (a?: LineEllipse, b?: LineEllipse): boolean =>
    a === b || (!!a && !!b && a.ratio === b.ratio && a.axis === b.axis);

/** The ellipse the arc runs on, or undefined for a circle */
export const ellipseOf = (p: LineParams): LineEllipse | undefined =>
    p.points[0]?.ellipse;

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
    const { bend: _was, ellipse: _ellipse, ...second } = b;
    return [
        { ...a, bend },
        ends === "circle"
            ? {
                  ...second,
                  bend: Math.sign(bend) * (360 - Math.abs(bend)),
                  ...(a.ellipse ? { ellipse: a.ellipse } : {}),
              }
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

/**
 * The circle or ellipse the arc runs on, in its own axes: `axis` (radians) the way its width
 * (`rx`) points, its depth (`ry`) a quarter turn on; `start` and `sweep` the arc's angles around
 * it from the width axis. A circle's axes follow the arc: its depth runs out through the arc's
 * middle. Null while the arc is straight.
 */
export interface ArcGuide {
    readonly center: XY;
    readonly rx: number;
    readonly ry: number;
    readonly axis: number;
    readonly start: number;
    readonly sweep: number;
}

export function arcGuide(p: LineParams): ArcGuide | null {
    const segment = lineSegments(p)[0];
    if (segment?.type === "ellipse")
        return {
            center: segment.center,
            rx: segment.rx,
            ry: segment.ry,
            axis: segment.rotation,
            start: segment.start,
            sweep: segment.sweep,
        };
    if (segment?.type !== "arc") return null;
    const axis = segment.start + segment.sweep / 2 - Math.PI / 2;
    return {
        center: segment.center,
        rx: segment.r,
        ry: segment.r,
        axis,
        start: segment.start - axis,
        sweep: segment.sweep,
    };
}

/** The point at angle `t` around the guide */
export const guidePoint = (g: ArcGuide, t: number): XY =>
    ellipsePoint(
        {
            type: "ellipse",
            center: g.center,
            rx: g.rx,
            ry: g.ry,
            rotation: g.axis,
            start: 0,
            sweep: 0,
        },
        t,
    );

/** Where the bend handle sits: halfway round the arc */
export function bendHandlePoint(p: LineParams): XY {
    const g = arcGuide(p);
    return g ? guidePoint(g, g.start + g.sweep / 2) : segmentMidpoint(p, 0);
}

/** `p` in the guide's own axes, from its center */
function onAxes(g: ArcGuide, p: XY): XY {
    const dx = p.x - g.center.x;
    const dy = p.y - g.center.y;
    const c = Math.cos(-g.axis);
    const s = Math.sin(-g.axis);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
}

/** The arc on `g`, its ends at its angles, as `base` with its other numbers kept */
function onGuide(base: LineParams, g: ArcGuide): LineParams {
    const a = guidePoint(g, g.start);
    const b = guidePoint(g, g.start + g.sweep);
    const round = Math.abs(g.rx - g.ry) <= 1e-9 * Math.max(g.rx, g.ry);
    const ellipse: LineEllipse | undefined = round
        ? undefined
        : { ratio: g.ry / g.rx, axis: (g.axis * 180) / Math.PI };
    const ends = arcEnds(base);
    const bend = (g.sweep * 180) / Math.PI;
    const [p, q] = base.points as [LinePoint, LinePoint];
    const { ellipse: _p, ...first } = p;
    const { ellipse: _q, ...second } = q;
    const points: LinePoint[] = [
        { ...first, x: a.x, y: a.y, bend, ...(ellipse ? { ellipse } : {}) },
        { ...second, x: b.x, y: b.y },
    ];
    return { ...base, points: withPoints({ ...base, points }, bend, ends) };
}

/** How near equal the guide's radii stick to a circle, as a share of the larger */
const ROUND_STICK = 0.05;

/**
 * The arc turning `degrees` around its circle or ellipse, which stays where it is (owner on #634):
 * it grows or shrinks evenly from its middle, so in Fit its marchers spread out or close up
 */
export function withSweep(p: LineParams, degrees: number): LineParams {
    const g = arcGuide(p);
    if (!g) return withBend(p, degrees);
    const size = Math.min(MAX_BEND, Math.max(MIN_BEND, Math.abs(degrees)));
    const sweep = ((Math.sign(g.sweep) || 1) * size * Math.PI) / 180;
    if (Math.abs(sweep - g.sweep) < 1e-12) return p;
    const middle = g.start + g.sweep / 2;
    return onGuide(p, { ...g, start: middle - sweep / 2, sweep });
}

/** The handle in the middle of the arc, which stretches it front to back */
export const MIDDLE_KEY = "mid";
/** The arc's ends, as the Line's points: `p0` is the first marcher's end */
export const END_KEYS = ["p0", "p1"] as const;

/** How many points along the arc its extent is measured from */
const EXTENT_SAMPLES = 64;

/** The arc's extent in the guide's own axes, from its center */
function extentOnAxes(g: ArcGuide): {
    left: number;
    right: number;
    low: number;
    high: number;
} {
    let left = Infinity;
    let right = -Infinity;
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i <= EXTENT_SAMPLES; i++) {
        const t = g.start + (g.sweep * i) / EXTENT_SAMPLES;
        const x = g.rx * Math.cos(t);
        const y = g.ry * Math.sin(t);
        left = Math.min(left, x);
        right = Math.max(right, x);
        low = Math.min(low, y);
        high = Math.max(high, y);
    }
    return { left, right, low, high };
}

/**
 * One of the arc's handles dragged to `to` (owner on #634), stretching the arc as a box's handles
 * do, its sweep kept: an end stretches it side to side along its width, the middle front to back
 * along its depth. The opposite side of the arc stays put, or with `fromCenter` the circle's
 * center; `constrain` keeps its proportions. Sizes land on half steps across with the ladder on,
 * and stick to a circle within {@link ROUND_STICK}. Stretched one way only, a circle becomes an
 * ellipse.
 */
export function stretchArc(
    base: LineParams,
    key: string,
    to: XY,
    env: ToolEnv,
): LineParams {
    const g = arcGuide(base);
    if (!g) return base;
    const end = (END_KEYS as readonly string[]).indexOf(key);
    if (end < 0 && key !== MIDDLE_KEY) return base;
    const width = end >= 0;
    const box = extentOnAxes(g);
    const local = onAxes(g, to);
    const handle = onAxes(
        g,
        width
            ? guidePoint(g, end === 0 ? g.start : g.start + g.sweep)
            : guidePoint(g, g.start + g.sweep / 2),
    );
    // The side that stays: across from the handle, or the circle's center
    const along = (q: XY) => (width ? q.x : q.y);
    const far = env.fromCenter
        ? 0
        : along(handle) >= 0
          ? width
              ? box.left
              : box.low
          : width
            ? box.right
            : box.high;
    const reach = along(handle) - far;
    if (Math.abs(reach) < 1e-9) return base;
    // The handle pulled onto a field line it comes near, as a box's edge is (#425): a yard line
    // for an end, a hash or sideline for the middle, on an arc square to the field
    const pulled = pullAlong(g, width, handle, local, env);
    const k = ((pulled ?? along(local)) - far) / reach;
    // The size across that way, landed on half steps unless the handle's on a line
    const was = (width ? g.rx : g.ry) * 2;
    let size = Math.max(env.stepPx / 2, was * k);
    if (env.snap && pulled === null)
        size = Math.round(size / (env.stepPx / 2)) * (env.stepPx / 2);
    const scale = size / was;
    // The ratio lock, flipped by constrain for the drag (as a box's side is)
    const keep = env.ratioLocked ?? env.constrain;
    let rx = width || keep ? g.rx * scale : g.rx;
    let ry = !width || keep ? g.ry * scale : g.ry;
    if (
        !keep &&
        pulled === null &&
        Math.abs(rx - ry) <= ROUND_STICK * Math.max(rx, ry)
    ) {
        if (width) rx = ry;
        else ry = rx;
    }
    // Scaled about the side that stays: along the handle's way about `far`; the other way (kept
    // in proportion) about the arc's back, so a stretched arc keeps its ends' line
    const middleY = g.ry * Math.sin(g.start + g.sweep / 2);
    const back = middleY >= 0 ? box.low : box.high;
    const otherFar = env.fromCenter || !width ? 0 : back;
    const kx = rx / g.rx;
    const ky = ry / g.ry;
    const cx = width ? far * (1 - kx) : otherFar * (1 - kx);
    const cy = width ? otherFar * (1 - ky) : far * (1 - ky);
    const c = Math.cos(g.axis);
    const s = Math.sin(g.axis);
    const center = {
        x: g.center.x + cx * c - cy * s,
        y: g.center.y + cx * s + cy * c,
    };
    return onGuide(base, { ...g, center, rx, ry });
}

/**
 * Where along its way (on the guide's axes) a handle at `handle`, dragged to `local`, lands when
 * the field line nearest it is within reach: null when none is, the pulls are off, or the arc is
 * turned off the field's axes (its handle then moves slantwise across the lines)
 */
function pullAlong(
    g: ArcGuide,
    width: boolean,
    handle: XY,
    local: XY,
    env: ToolEnv,
): number | null {
    if (env.pull === false || !env.fieldLines) return null;
    const c = Math.cos(g.axis);
    const s = Math.sin(g.axis);
    // The handle's way on the field, and where it is with the pointer's reach
    const way = width ? { x: c, y: s } : { x: -s, y: c };
    const at = width ? local.x : local.y;
    const off = width ? handle.y : handle.x;
    const ax = width ? at : off;
    const ay = width ? off : at;
    const raw = {
        x: g.center.x + ax * c - ay * s,
        y: g.center.y + ax * s + ay * c,
    };
    const pull = linePull(
        [raw],
        env.fieldLines,
        Math.min(env.pullRadius ?? 0, env.stepPx / 4),
    );
    const SQUARE = 0.999;
    if (Math.abs(way.x) > SQUARE && pull.x !== null) return at + pull.x / way.x;
    if (Math.abs(way.y) > SQUARE && pull.y !== null) return at + pull.y / way.y;
    return null;
}

/**
 * The arc stretched to the shape `g` gives it, its ellipse and angles round it kept: the guide in
 * steps, for the size typed or dragged in the editor
 */
export function withGuideSize(
    base: LineParams,
    rx: number,
    ry: number,
): LineParams {
    const g = arcGuide(base);
    if (!g || !(rx > 0) || !(ry > 0)) return base;
    return onGuide(base, { ...g, rx, ry });
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
