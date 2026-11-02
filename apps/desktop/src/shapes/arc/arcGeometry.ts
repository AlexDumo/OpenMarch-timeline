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
/** Sweeps a dragged bend sticks to, in degrees (the owner's "90°, 180° …") */
const STICKY_BENDS = [45, 90, 135, 180, 225, 270, 315];
/** How near a sticky sweep a dragged bend sticks to it, in degrees */
const STICK = 6;

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

/** Which side of the guide's center the arc's middle is, along its depth: 1 or -1 */
const middleSide = (g: ArcGuide) =>
    Math.sin(g.start + g.sweep / 2) >= 0 ? 1 : -1;

/** The handles that set the guide's width and depth, by key */
export const WIDTH_KEY = "rw";
export const DEPTH_KEY = "rd";

/**
 * Where the radius handles sit on the guide (owner on #634): the depth one where the depth axis
 * crosses it away from the arc's middle, the width one where the width axis crosses it
 */
export function radiusHandlePoints(
    p: LineParams,
): { width: XY; depth: XY } | null {
    const g = arcGuide(p);
    if (!g) return null;
    const back = (-middleSide(g) * Math.PI) / 2;
    // Where the width axis crosses the guide off the arc, else partway round its bare back
    const width =
        [0, Math.PI].find((t) => !onArc(g, t)) ??
        back + (middleSide(g) * Math.PI) / 4;
    return { width: guidePoint(g, width), depth: guidePoint(g, back) };
}

/** How far off an arc's end a handle on its guide stays, in radians */
const OFF_ARC = (8 * Math.PI) / 180;

/** Whether angle `t` round the guide is on the arc, or within {@link OFF_ARC} of it */
function onArc(g: ArcGuide, t: number): boolean {
    const turn = 2 * Math.PI;
    const wrap = (x: number) => ((x % turn) + turn) % turn;
    const sign = Math.sign(g.sweep) || 1;
    const along = wrap(sign * (t - g.start) + OFF_ARC);
    return along <= Math.abs(g.sweep) + 2 * OFF_ARC;
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
 * A radius handle dragged to `to` (owner on #634): the guide's width or depth set by it, the
 * other side staying where it is, or both sides moving with `fromCenter`. Radii land on half
 * steps with the ladder on and stick to a circle within {@link ROUND_STICK}. The arc keeps its
 * angles around the guide, so its ends ride along.
 */
export function dragRadius(
    base: LineParams,
    key: string,
    to: XY,
    env: ToolEnv,
): LineParams {
    const g = arcGuide(base);
    if (!g) return base;
    const width = key === WIDTH_KEY;
    const local = onAxes(g, to);
    const was = width ? g.rx : g.ry;
    // The handle's side of the center along its axis: where it's drawn
    const handles = radiusHandlePoints(base)!;
    const side = width
        ? onAxes(g, handles.width).x >= 0
            ? 1
            : -1
        : -middleSide(g);
    const reach = side * (width ? local.x : local.y);
    let r = env.fromCenter ? Math.abs(reach) : (reach + was) / 2;
    if (env.snap) r = Math.round(r / (env.stepPx / 2)) * (env.stepPx / 2);
    r = Math.max(env.stepPx / 2, r);
    const other = width ? g.ry : g.rx;
    if (Math.abs(r - other) <= ROUND_STICK * Math.max(r, other)) r = other;
    // The far side stays put: the center moves half as far as the handle's side
    const shift = env.fromCenter ? 0 : side * (r - was);
    const c = Math.cos(g.axis);
    const s = Math.sin(g.axis);
    const along = width ? { x: c, y: s } : { x: -s, y: c };
    const center = {
        x: g.center.x + along.x * shift,
        y: g.center.y + along.y * shift,
    };
    return onGuide(base, {
        ...g,
        center,
        ...(width ? { rx: r } : { ry: r }),
    });
}

/** Angles an end dragged on an ellipse sticks to: where the axes cross it */
const END_STICK = (4 * Math.PI) / 180;

/**
 * An end of an arc on an ellipse dragged to `to` (owner on #634): it slides round the ellipse to
 * where the pointer is, the other end staying, the arc never turning a full circle. On a circle
 * the ends drag as a Line's do, so this is for an ellipse only.
 */
export function slideEnd(
    base: LineParams,
    index: number,
    to: XY,
    env: ToolEnv,
): LineParams {
    const g = arcGuide(base);
    if (!g) return base;
    const local = onAxes(g, to);
    let t = Math.atan2(local.y / g.ry, local.x / g.rx);
    if (env.snap) {
        const quarter = Math.round(t / (Math.PI / 2)) * (Math.PI / 2);
        if (Math.abs(t - quarter) <= END_STICK) t = quarter;
    }
    const sign = Math.sign(g.sweep) || 1;
    const turn = 2 * Math.PI;
    const wrap = (x: number) => ((x % turn) + turn) % turn;
    const end = g.start + g.sweep;
    const size =
        index === 0 ? wrap(sign * (end - t)) : wrap(sign * (t - g.start));
    const min = (MIN_BEND * Math.PI) / 180;
    const max = (MAX_BEND * Math.PI) / 180;
    const sweep = sign * Math.min(max, Math.max(min, size));
    return onGuide(base, {
        ...g,
        start: index === 0 ? end - sweep : g.start,
        sweep,
    });
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

/** How far an arc turns before a bend drag closes it round to a whole circle, in degrees */
export const CLOSE_AT = 350;

/** The arc with these ends, sweep and ends kind, its other numbers kept */
function arcWith(
    base: LineParams,
    a: XY,
    b: XY,
    bend: number,
    ends: ArcEnds,
): LineParams {
    const [p, q] = base.points as [LinePoint, LinePoint];
    const moved: LineParams = {
        ...base,
        points: [
            { ...p, x: a.x, y: a.y },
            { ...q, x: b.x, y: b.y },
        ],
    };
    // The ends kind first (it rebuilds the second point's bend), then the sweep on top
    const kind = withEnds(moved, ends);
    return { ...kind, points: withPoints(kind, bend, ends) };
}

const polar = (c: XY, r: number, angle: number): XY => ({
    x: c.x + r * Math.cos(angle),
    y: c.y + r * Math.sin(angle),
});

/**
 * The bend handle dragged to `to` (owner on #634). Up to a half turn the ends stay where they are
 * and the arc bows out through the pointer. Past a half turn the circle stays its size and the
 * ends come round it toward each other, the sweep growing as the pointer goes on out past the
 * arc's middle, so the circle never balloons; from {@link CLOSE_AT} the arc closes round to a
 * whole circle on that circle, and dragging back opens it again. A circle closed this way, or from
 * the menu, opens below {@link CLOSE_AT}; an arc closed by its chord stays closed and never flips.
 * The sweep is landed as {@link landBend} has it.
 */
export function dragBend(base: LineParams, to: XY, env: ToolEnv): LineParams {
    const ellipse = ellipseOf(base);
    if (!ellipse) return dragBendRound(base, to, env);
    // Round where the ellipse is a circle, then stretched back onto it
    const round: LineParams = {
        ...base,
        points: base.points.map(({ ellipse: _e, ...q }) => ({
            ...q,
            ...intoCircle(q, ellipse),
        })),
    };
    const bent = dragBendRound(round, intoCircle(to, ellipse), env);
    return {
        ...bent,
        points: bent.points.map((q) => ({
            ...q,
            ...outOfCircle(q, ellipse),
            ...(q.bend === undefined ? {} : { ellipse }),
        })),
    };
}

function dragBendRound(base: LineParams, to: XY, env: ToolEnv): LineParams {
    const [a, b] = base.points as [LinePoint, LinePoint];
    const bend = bendOf(base);
    const sign = Math.sign(bend) || 1;
    const ends = arcEnds(base);
    // The arc as it is at a half turn: its circle, and the way from its center to its middle
    let center: XY;
    let r: number;
    let middle: number;
    if (Math.abs(bend) < 180) {
        center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        r = Math.hypot(b.x - a.x, b.y - a.y) / 2;
        // Bowing left of a → b for a positive sweep
        middle = Math.atan2(-(b.x - a.x) * sign, (b.y - a.y) * sign);
    } else {
        const segment = bentSegment(a, b, bend);
        if (segment.type !== "arc") return base;
        center = segment.center;
        r = segment.r;
        middle = segment.start + segment.sweep / 2;
    }
    if (r < 1e-9) return base;
    const out = {
        x: Math.cos(middle),
        y: Math.sin(middle),
    };
    const d = (to.x - center.x) * out.x + (to.y - center.y) * out.y;
    const sweepAt = (degrees: number) => {
        const half = (sign * degrees * Math.PI) / 360;
        return [
            polar(center, r, middle - half),
            polar(center, r, middle + half),
        ];
    };
    if (d <= r) {
        // Ends held on the half turn's diameter, the arc bowing out to the pointer
        let degrees = landBend(
            (4 * Math.atan((2 * d) / (2 * r)) * 180) / Math.PI,
            env,
        );
        if (Math.abs(degrees) < MIN_BEND)
            degrees = Math.sign(degrees || 1) * MIN_BEND;
        // A closed arc never flips through straight
        if (ends !== "open" && degrees < MIN_BEND) degrees = MIN_BEND;
        const [from, until] = sweepAt(180);
        return arcWith(
            base,
            from!,
            until!,
            sign * degrees,
            ends === "circle" ? "open" : ends,
        );
    }
    // Past the half turn: the circle held, each end going round by as far as the pointer is out
    const degrees = Math.min(
        MAX_BEND,
        landBend(180 + ((2 * (d - r)) / r) * (180 / Math.PI), env),
    );
    const closes = ends !== "chord" && degrees >= CLOSE_AT;
    const kept = closes ? CLOSE_AT : degrees;
    const [from, until] = sweepAt(kept);
    return arcWith(
        base,
        from!,
        until!,
        sign * kept,
        closes ? "circle" : ends === "circle" ? "open" : ends,
    );
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
