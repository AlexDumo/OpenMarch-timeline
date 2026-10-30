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
import { lineShape } from "./lineShape";
import {
    dragPoint,
    drawLine,
    isLineParams,
    lineFrame,
    lineInFrame,
    lineInterval,
    moveLine,
    onLine,
    withInterval,
    withLineFrame,
    withSpacing,
    type LineAnchor,
    type LineParams,
} from "./lineGeometry";

/** A handle's key for point `i`: `p0` is the first marcher's end */
const POINT_KEY = /^p(\d+)$/;

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
    // Off the half steps in Fit, it shows as about so much
    derived: (p, n, stepPx) =>
        p.spacing.mode === "fit" && !onHalves(lineInterval(p, n) / stepPx),
    snap: (p, n, env) =>
        withInterval(
            p,
            n,
            snapInterval(lineInterval(p, n), { ...env, snap: true }),
            env,
        ),
    display: (p, n, stepPx) => formatSteps(lineInterval(p, n) / stepPx),
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
 * The Line (#523, spec #522): a straight line of marchers drawn with one drag, its two ends
 * dragged by their handles, moved from its body, and turned and flipped through its frame like
 * every shape. Drawn in Fit; typing an interval keeps it, the length following from the pivot.
 */
export const lineTool: ToolKind<LineParams> = {
    shape: lineShape,
    params: [INTERVAL],
    choices: [SPACING],
    ordered: true,
    readable: isLineParams,
    scaling: "interval",
    draw: (from, to, _n, env) => drawLine(from, to, env),
    handles(params) {
        const frame = lineFrame(params);
        const last = params.points.length - 1;
        return params.points.map((at, i) => ({
            key: `p${i}`,
            at: { x: at.x, y: at.y },
            // Along the line, however it's turned
            cursor: resizeCursor(frame, { x: i === last ? 1 : -1, y: 0 }),
        }));
    },
    dragHandle(base, n, key, to, env) {
        const match = POINT_KEY.exec(key);
        const index = match ? Number(match[1]) : -1;
        if (index < 0 || index >= base.points.length) return base;
        return dragPoint(base, n, index, to, env);
    },
    outline: (params) => params.points.map(({ x, y }) => ({ x, y })),
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
