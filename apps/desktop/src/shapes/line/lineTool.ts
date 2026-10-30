import tolgee from "@/global/singletons/Tolgee";
import { resizeCursor } from "../frame/frame";
import { formatSteps, parseSteps } from "../editor/format";
import { scrubDistance, scrubValue, spacingRate } from "../editor/scrub";
import { snapInterval } from "../box/boxGeometry";
import type {
    ToolChoice,
    ToolEnv,
    ToolKind,
    ToolParam,
} from "../tool/toolKind";
import { curveShape, lineShape } from "./lineShape";
import {
    cornerOffInterval,
    curveInFrame,
    dragPoint,
    dragTension,
    drawLine,
    drawPoints,
    intervalRange,
    landClicked,
    isLineParams,
    lineFrame,
    lineInFrame,
    lineInterval,
    lineOutline,
    lineRuns,
    moveLine,
    onLine,
    segmentMidpoint,
    setTension,
    SMOOTH,
    splitSegment,
    tensionHandle,
    typedInterval,
    withInterval,
    withLineFrame,
    withSpacing,
    type LineAnchor,
    type LineParams,
} from "./lineGeometry";

/** A handle's key for point `i`: `p0` is the first marcher's end */
const POINT_KEY = /^p(\d+)$/;
/** A handle's key for the midpoint of segment `i`, from point `i` to the next (#524) */
const MIDPOINT_KEY = /^m(\d+)$/;
/** A handle's key for smooth point `i`'s tension (#525) */
const TENSION_KEY = /^t(\d+)$/;

/** The point whose handle `key` is (`p<i>`, or `t<i>` with `pattern`), or -1 */
const pointOf = (p: LineParams, key: string, pattern = POINT_KEY): number => {
    const match = pattern.exec(key);
    const index = match ? Number(match[1]) : -1;
    return index >= 0 && index < p.points.length ? index : -1;
};

/**
 * A change that turns points into corners or corners into smooth points, with a typed interval
 * kept: its runs whole intervals again, as typing it would (#524)
 */
const keptInterval = (next: LineParams, n: number): LineParams => {
    const interval = typedInterval(next);
    return next.spacing.mode === "keep" && interval !== null && n > 1
        ? withInterval(next, n, interval, {})
        : next;
};

/** The segment whose midpoint handle `key` is, or -1 */
const midpointOf = (p: LineParams, key: string): number => {
    const match = MIDPOINT_KEY.exec(key);
    const index = match ? Number(match[1]) : -1;
    return index >= 0 && index < p.points.length - 1 ? index : -1;
};

/** Whether `steps` is on the half-step ladder */
const onHalves = (steps: number) =>
    Math.abs(steps * 2 - Math.round(steps * 2)) < 1e-6;

/** An interval set as typed: kept as it is (1⅔, 1.37), not on half steps (#411, #423) */
const typed = (p: LineParams, n: number, steps: number, env: ToolEnv) =>
    withInterval(p, n, snapInterval(steps * env.stepPx, env, true), env);

/**
 * The line's interval between neighbors. In Fit it's worked out from the line as drawn; typing or
 * dragging it fixes it (Keep interval, or the run on the path).
 */
const INTERVAL: ToolParam<LineParams> = {
    key: "interval",
    get label() {
        return tolgee.t(
            "shapes.kinds.line.params.interval",
            "Spacing between neighbors, in steps",
        );
    },
    unit: "steps",
    primary: true,
    drag: "x",
    interval: true,
    blends: true,
    default: 2,
    range: { min: 0.5 },
    glyph: "↔",
    shown: (_p, n) => n > 1,
    // Off the half steps in Fit, or uneven around corners, it shows as about so much
    derived: (p, n, stepPx) =>
        p.spacing.mode === "fit" &&
        (!onHalves(lineInterval(p, n) / stepPx) || isRange(p, n)),
    snap: (p, n, env) =>
        withInterval(
            p,
            n,
            snapInterval(lineInterval(p, n), { ...env, snap: true }),
            env,
        ),
    // A cornered Fit line shows its narrowest and widest segment: "2–2½" (#524)
    display(p, n, stepPx) {
        const range = intervalRange(p, n);
        if (range && isRange(p, n))
            return `${formatSteps(range.min / stepPx)}–${formatSteps(range.max / stepPx)}`;
        return formatSteps(lineInterval(p, n) / stepPx);
    },
    note: (p, n) =>
        cornerOffInterval(p, n)
            ? tolgee.t(
                  "shapes.kinds.line.params.cornerOff",
                  "corner off its interval",
              )
            : null,
    value: (p, n, stepPx) => lineInterval(p, n) / stepPx,
    type(p, n, text, env) {
        const steps = parseSteps(text);
        return steps === null ? null : typed(p, n, steps, env);
    },
    set: (p, n, steps, env) => typed(p, n, steps, env),
    scrub(base, n, m, env) {
        const was = lineInterval(base, n) / env.stepPx;
        const steps = scrubValue(
            was,
            scrubDistance("x", m.dx, m.dy),
            0,
            spacingRate(env.snap, "x"),
        );
        // A drag that ends where it started changes nothing; it doesn't round the value
        if (steps === was) return base;
        return withInterval(
            base,
            n,
            snapInterval(steps * env.stepPx, env),
            env,
        );
    },
    widen(p, n, by, env) {
        const steps = lineInterval(p, n) / env.stepPx + by;
        if (steps < 0.5 - 1e-9) return null;
        return withInterval(p, n, snapInterval(steps * env.stepPx, env), env);
    },
};

/** Whether a cornered Fit line's segments have different intervals */
function isRange(p: LineParams, n: number): boolean {
    const range = intervalRange(p, n);
    return range !== null && range.max - range.min > 1e-6 * range.max;
}

const ANCHORS: readonly LineAnchor[] = ["start", "center", "end"];

/** The spacing menu (05-interval-modes.md): Fit, Keep interval, or Interval on the path */
const SPACING: ToolChoice<LineParams> = {
    key: "spacing",
    get label() {
        return tolgee.t("shapes.kinds.line.spacing.label", "Spacing");
    },
    options: () => [
        {
            value: "fit",
            label: tolgee.t("shapes.kinds.line.spacing.fit", "Fit"),
        },
        {
            value: "keep",
            label: tolgee.t("shapes.kinds.line.spacing.keep", "Keep interval"),
        },
        {
            value: "path-start",
            label: tolgee.t(
                "shapes.kinds.line.spacing.pathStart",
                "Interval on the path, from the start",
            ),
        },
        {
            value: "path-center",
            label: tolgee.t(
                "shapes.kinds.line.spacing.pathCenter",
                "Interval on the path, centered",
            ),
        },
        {
            value: "path-end",
            label: tolgee.t(
                "shapes.kinds.line.spacing.pathEnd",
                "Interval on the path, from the end",
            ),
        },
    ],
    current: (p) =>
        p.spacing.mode === "path" ? `path-${p.spacing.anchor}` : p.spacing.mode,
    pick(p, n, value, env) {
        if (value === "fit" || value === "keep")
            return withSpacing(p, n, value, env);
        const anchor = ANCHORS.find((a) => value === `path-${a}`);
        return anchor ? withSpacing(p, n, anchor, env) : p;
    },
};

/**
 * The corners switch (#524): every corner holds a marcher, or the intervals run around the
 * corners. Only on a line with a corner, where corners can hold marchers (`cornerGaps`).
 */
const CORNERS: ToolChoice<LineParams> = {
    key: "corners",
    get label() {
        return tolgee.t("shapes.kinds.line.corners.label", "Corners");
    },
    options: () => [
        {
            value: "on",
            label: tolgee.t(
                "shapes.kinds.line.corners.on",
                "Marcher on every corner",
            ),
        },
        {
            value: "off",
            label: tolgee.t(
                "shapes.kinds.line.corners.off",
                "Intervals run around corners",
            ),
        },
    ],
    current: (p) => (p.corners === false ? "off" : "on"),
    pick(p, n, value, env) {
        if (value !== "on" && value !== "off") return p;
        const { corners: _corners, ...rest } = p;
        const next: LineParams =
            value === "off" ? { ...rest, corners: false } : rest;
        // A typed interval keeps the line as long as its marchers need
        const interval = lineInterval(p, n);
        return next.spacing.mode === "keep" && interval > 0
            ? withInterval(next, n, interval, env)
            : next;
    },
    // Corners hold marchers only in Fit and Keep interval, with a gap for every run between
    // corners (n - 1 gaps); smooth points aren't corners (#525)
    shown: (p, n) => {
        const runs = lineRuns(p).length;
        return runs > 1 && p.spacing.mode !== "path" && n > runs;
    },
};

/**
 * The points menu (#525): every point a corner, or every point smooth so the line bends through
 * them. A line with both says so; a point's own handle changes one point.
 */
const POINTS: ToolChoice<LineParams> = {
    key: "points",
    get label() {
        return tolgee.t("shapes.kinds.line.points.label", "Points");
    },
    options: (p) => [
        {
            value: "corner",
            label: tolgee.t("shapes.kinds.line.points.corner", "Corners"),
        },
        {
            value: "smooth",
            label: tolgee.t("shapes.kinds.line.points.smooth", "Smooth"),
        },
        ...(pointsKind(p) === "mixed"
            ? [
                  {
                      value: "mixed",
                      label: tolgee.t(
                          "shapes.kinds.line.points.mixed",
                          "Corners and smooth points",
                      ),
                  },
              ]
            : []),
    ],
    current: (p) => pointsKind(p),
    pick(p, n, value) {
        if (value !== "corner" && value !== "smooth") return p;
        const points = p.points.map((q) => ({
            ...q,
            // A smooth point made smooth keeps its own tension
            tension: value === "corner" ? 0 : q.tension || SMOOTH,
        }));
        if (points.every((q, i) => q.tension === p.points[i]!.tension))
            return p;
        return keptInterval({ ...p, points }, n);
    },
    // Two points make a straight line however smooth they are
    shown: (p) => p.points.length > 2,
};

/** Whether every point is a corner, every one is smooth, or there are both */
function pointsKind(p: LineParams): "corner" | "smooth" | "mixed" {
    if (p.points.every((q) => q.tension === 0)) return "corner";
    return p.points.every((q) => q.tension > 0) ? "smooth" : "mixed";
}

/**
 * The Line (#523, #524, #525, spec #522): a line of marchers drawn with one drag (two points) or by
 * clicking point after point, every point and every segment's midpoint a handle, moved from its
 * body, and turned and flipped through its frame like every shape. Drawn in Fit; typing an interval
 * keeps it, the length following from the pivot. Every corner holds a marcher unless switched off.
 * A click on a point makes it smooth, or a corner again; a smooth point's tension handle sets how
 * round the line bends through it.
 */
export const lineTool: ToolKind<LineParams> = {
    shape: lineShape,
    params: [INTERVAL],
    choices: [SPACING, CORNERS, POINTS],
    readable: isLineParams,
    scaling: "interval",
    draw: (from, to, _n, env) => drawLine(from, to, env),
    clickPoints: {
        land: landClicked,
        draw: (points, _n, env) => drawPoints(points, env),
    },
    handles(params) {
        const frame = lineFrame(params);
        const last = params.points.length - 1;
        const points = params.points.map((at, i) => ({
            key: `p${i}`,
            at: { x: at.x, y: at.y },
            // An end along the line, however it's turned; a corner any way
            cursor:
                i === 0 || i === last
                    ? resizeCursor(frame, { x: i === last ? 1 : -1, y: 0 })
                    : "move",
        }));
        const midpoints = params.points.slice(1).map((_b, i) => ({
            key: `m${i}`,
            at: segmentMidpoint(params, i),
            cursor: "pointer",
            adds: true,
        }));
        const tensions = params.points.flatMap((_q, i) => {
            const at = tensionHandle(params, i);
            return at ? [{ key: `t${i}`, at, cursor: "pointer" }] : [];
        });
        return [...points, ...midpoints, ...tensions];
    },
    dragHandle(base, n, key, to, env) {
        // A midpoint dragged: a corner added there, and dragged
        const segment = midpointOf(base, key);
        if (segment >= 0)
            return dragPoint(
                splitSegment(base, segment),
                n,
                segment + 1,
                to,
                env,
            );
        const tension = pointOf(base, key, TENSION_KEY);
        if (tension >= 0)
            return keptInterval(dragTension(base, tension, to, env), n);
        const index = pointOf(base, key);
        if (index < 0) return base;
        return dragPoint(base, n, index, to, env);
    },
    // A midpoint clicked splits its segment; a point clicked turns smooth, or a corner again
    clickHandle(params, n, key) {
        const segment = midpointOf(params, key);
        if (segment >= 0) return splitSegment(params, segment);
        const index = pointOf(params, key);
        if (index < 0) return null;
        const smooth = params.points[index]!.tension > 0;
        return keptInterval(setTension(params, index, smooth ? 0 : SMOOTH), n);
    },
    outline: (params) => lineOutline(params),
    outlineOpen: (params) => params.closed !== true,
    snapPoints: (params) => {
        const { center } = lineFrame(params);
        return [...params.points.map(({ x, y }) => ({ x, y })), center];
    },
    contains: onLine,
    move: (base, _n, delta, env) => moveLine(base, delta, env),
    frameOf: (params) => lineFrame(params),
    withFrame: (params, _n, frame) => withLineFrame(params, frame),
    fromFrame: lineInFrame,
};

/**
 * The Curve (#525, spec #522): a preset of the Line, the same kind and recipe, whose points start
 * smooth. A drag draws two smooth points (straight until a midpoint is pulled out), clicks draw a
 * curve through the points, and a shape turned into a Curve arches across its frame. Placed, it
 * reads back as a Line.
 */
export const curveTool: ToolKind<LineParams> = {
    ...lineTool,
    preset: "curve",
    shape: curveShape,
    draw: (from, to, _n, env) => drawLine(from, to, env, SMOOTH),
    clickPoints: {
        land: landClicked,
        draw: (points, _n, env) => drawPoints(points, env, SMOOTH),
    },
    fromFrame: curveInFrame,
};
