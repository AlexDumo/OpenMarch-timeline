import tolgee from "@/global/singletons/Tolgee";
import { fieldToFrame, resizeCursor } from "../frame/frame";
import { formatSteps, parseSteps } from "../editor/format";
import { scrubDistance, scrubValue, spacingRate } from "../editor/scrub";
import { snapInterval } from "../box/boxGeometry";
import type {
    ToolChoice,
    ToolEnv,
    ToolKind,
    ToolParam,
} from "../tool/toolKind";
import { lineShape } from "./lineShape";
import {
    fillInterval,
    isFilled,
    lineClosed,
    lineRegion,
    withFillInterval,
} from "./lineFill";
import {
    closeLine,
    cornerOffInterval,
    dragPoint,
    drawLine,
    drawPoints,
    intervalRange,
    isClosed,
    landClicked,
    isLineParams,
    lineFrame,
    lineInFrame,
    lineInterval,
    lineSegments,
    moveLine,
    onLine,
    openLine,
    splitSegment,
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

/** The segment whose midpoint handle `key` is, or -1 */
const midpointOf = (p: LineParams, key: string): number => {
    const match = MIDPOINT_KEY.exec(key);
    const index = match ? Number(match[1]) : -1;
    // A closed line's last segment runs back to its first point (#529)
    const segments = p.points.length - (isClosed(p) ? 0 : 1);
    return index >= 0 && index < segments ? index : -1;
};

/** Whether `steps` is on the half-step ladder */
const onHalves = (steps: number) =>
    Math.abs(steps * 2 - Math.round(steps * 2)) < 1e-6;

/**
 * The line with its spacing set to `interval`: a filled line's outline grown to it (#529), else
 * the line kept at it
 */
const spacedAt = (
    p: LineParams,
    n: number,
    interval: number,
    env: ToolEnv,
): LineParams =>
    isFilled(p)
        ? (withFillInterval(p, n, interval, env) ?? p)
        : withInterval(p, n, interval, env);

/** The spacing as shown: a filled line's (#529), else the line's interval */
const spacingOf = (p: LineParams, n: number): number =>
    isFilled(p) ? fillInterval(p, n) : lineInterval(p, n);

/** An interval set as typed: kept as it is (1⅔, 1.37), not on half steps (#411, #423) */
const typed = (p: LineParams, n: number, steps: number, env: ToolEnv) =>
    spacedAt(p, n, snapInterval(steps * env.stepPx, env, true), env);

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
    // Off the half steps in Fit, or uneven around corners, it shows as about so much; a filled
    // line's follows its outline (#529)
    derived: (p, n, stepPx) =>
        isFilled(p)
            ? !onHalves(fillInterval(p, n) / stepPx)
            : p.spacing.mode === "fit" &&
              (!onHalves(lineInterval(p, n) / stepPx) || isRange(p, n)),
    snap: (p, n, env) =>
        spacedAt(
            p,
            n,
            snapInterval(spacingOf(p, n), { ...env, snap: true }),
            env,
        ),
    // A cornered Fit line shows its narrowest and widest segment: "2–2½" (#524)
    display(p, n, stepPx) {
        if (isFilled(p)) return formatSteps(fillInterval(p, n) / stepPx);
        const range = intervalRange(p, n);
        if (range && isRange(p, n))
            return `${formatSteps(range.min / stepPx)}–${formatSteps(range.max / stepPx)}`;
        return formatSteps(lineInterval(p, n) / stepPx);
    },
    note: (p, n) =>
        !isFilled(p) && cornerOffInterval(p, n)
            ? tolgee.t(
                  "shapes.kinds.line.params.cornerOff",
                  "corner off its interval",
              )
            : null,
    value: (p, n, stepPx) => spacingOf(p, n) / stepPx,
    type(p, n, text, env) {
        const steps = parseSteps(text);
        return steps === null ? null : typed(p, n, steps, env);
    },
    set: (p, n, steps, env) => typed(p, n, steps, env),
    scrub(base, n, m, env) {
        const was = spacingOf(base, n) / env.stepPx;
        const steps = scrubValue(
            was,
            scrubDistance("x", m.dx, m.dy),
            0,
            spacingRate(env.snap, "x"),
        );
        // A drag that ends where it started changes nothing; it doesn't round the value
        if (steps === was) return base;
        return spacedAt(base, n, snapInterval(steps * env.stepPx, env), env);
    },
    widen(p, n, by, env) {
        const steps = spacingOf(p, n) / env.stepPx + by;
        if (steps < 0.5 - 1e-9) return null;
        return spacedAt(p, n, snapInterval(steps * env.stepPx, env), env);
    },
};

/** Whether a cornered Fit line's segments have different intervals */
function isRange(p: LineParams, n: number): boolean {
    const range = intervalRange(p, n);
    return range !== null && range.max - range.min > 1e-6 * range.max;
}

const ANCHORS: readonly LineAnchor[] = ["start", "center", "end"];

/**
 * Open or closed (#529): Close joins the last point to the first, so the line can be filled like
 * a box; Open turns it back into a line through the spots its outline has. Shown once there are
 * three points to close.
 */
const ENDS: ToolChoice<LineParams> = {
    key: "ends",
    get label() {
        return tolgee.t("shapes.kinds.line.ends.label", "Open or closed");
    },
    options: () => [
        {
            value: "open",
            label: tolgee.t("shapes.kinds.line.ends.open", "Open"),
        },
        {
            value: "closed",
            label: tolgee.t("shapes.kinds.line.ends.closed", "Closed"),
        },
    ],
    current: (p) => (isClosed(p) ? "closed" : "open"),
    pick(p, n, value, env) {
        if (value === "closed") return closeLine(p, n, env);
        return value === "open" ? openLine(p, n) : p;
    },
    shown: (p) => isClosed(p) || p.points.length > 2,
};

/** Interval on the path, from each anchor */
const PATH_OPTIONS = () => [
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
];

/** The spacing menu (05-interval-modes.md): Fit, Keep interval, or Interval on the path */
const SPACING: ToolChoice<LineParams> = {
    key: "spacing",
    get label() {
        return tolgee.t("shapes.kinds.line.spacing.label", "Spacing");
    },
    options: (p) => [
        {
            value: "fit",
            label: tolgee.t("shapes.kinds.line.spacing.fit", "Fit"),
        },
        {
            value: "keep",
            label: tolgee.t("shapes.kinds.line.spacing.keep", "Keep interval"),
        },
        // A closed line has no ends to lay a run from (#529)
        ...(isClosed(p) ? [] : PATH_OPTIONS()),
    ],
    current: (p) =>
        p.spacing.mode === "path" ? `path-${p.spacing.anchor}` : p.spacing.mode,
    pick(p, n, value, env) {
        if (value === "fit" || value === "keep")
            return withSpacing(p, n, value, env);
        const anchor = ANCHORS.find((a) => value === `path-${a}`);
        return anchor && !isClosed(p) ? withSpacing(p, n, anchor, env) : p;
    },
    // A filled line's spacing follows its outline (#529)
    shown: (p) => !isFilled(p),
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
    // Corners hold marchers only in Fit and Keep interval, with a gap for every segment
    // (n - 1 gaps, one fewer segment than points)
    shown: (p, n) =>
        p.points.length > 2 &&
        p.spacing.mode !== "path" &&
        !isFilled(p) &&
        n >= p.points.length,
};

/**
 * The Line (#523, #524, spec #522): a line of marchers drawn with one drag (two points) or by
 * clicking point after point, every point and every segment's midpoint a handle, moved from its
 * body, and turned and flipped through its frame like every shape. Drawn in Fit; typing an interval
 * keeps it, the length following from the pivot. Every corner holds a marcher unless switched off.
 */
export const lineTool: ToolKind<LineParams> = {
    shape: lineShape,
    params: [INTERVAL],
    choices: [ENDS, SPACING, CORNERS],
    ordered: true,
    readable: isLineParams,
    scaling: "interval",
    draw: (from, to, _n, env) => drawLine(from, to, env),
    clickPoints: {
        land: landClicked,
        draw: (points, _n, env) => drawPoints(points, env),
        // A click on the first point closes the line (#529)
        close(points, n, env) {
            const p = drawPoints(points, env);
            return p && closeLine(p, n, env);
        },
    },
    handles(params) {
        const frame = lineFrame(params);
        const last = params.points.length - 1;
        const closed = isClosed(params);
        const points = params.points.map((at, i) => ({
            key: `p${i}`,
            at: { x: at.x, y: at.y },
            // An end along the line, however it's turned; a corner (every point of a closed
            // line) any way
            cursor:
                !closed && (i === 0 || i === last)
                    ? resizeCursor(frame, { x: i === last ? 1 : -1, y: 0 })
                    : "move",
        }));
        const midpoints = lineSegments(params).map(([a, b], i) => {
            return {
                key: `m${i}`,
                at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                cursor: "pointer",
                adds: true,
            };
        });
        return [...points, ...midpoints];
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
        const match = POINT_KEY.exec(key);
        const index = match ? Number(match[1]) : -1;
        if (index < 0 || index >= base.points.length) return base;
        return dragPoint(base, n, index, to, env);
    },
    // A midpoint clicked splits its segment
    clickHandle(params, _n, key) {
        const segment = midpointOf(params, key);
        return segment >= 0 ? splitSegment(params, segment) : null;
    },
    outline: (params) => params.points.map(({ x, y }) => ({ x, y })),
    outlineOpen: (params) => params.closed !== true,
    snapPoints: (params) => {
        const { center } = lineFrame(params);
        return [...params.points.map(({ x, y }) => ({ x, y })), center];
    },
    // A closed line is grabbed inside it too, as a box is (#529)
    contains: (params, n, at, env) =>
        onLine(params, n, at, env) ||
        (isClosed(params) &&
            lineRegion(params).contains(fieldToFrame(lineFrame(params), at))),
    move: (base, _n, delta, env) => moveLine(base, delta, env),
    frameOf: (params) => lineFrame(params),
    withFrame: (params, _n, frame) => withLineFrame(params, frame),
    fromFrame: lineInFrame,
    closed: lineClosed,
};
