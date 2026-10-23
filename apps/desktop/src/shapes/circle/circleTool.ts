import { resizeCursor } from "../frame/frame";
import { formatSteps } from "../editor/format";
import {
    parseSteps,
    scrubDistance,
    scrubValue,
    SPACING_FINE_STEP,
    SPACING_RATE,
} from "../editor/scrub";
import { distributionFor } from "../distribute/distribution";
import type { ToolKind, ToolParam } from "../tool/toolKind";
import { circleShape } from "./circleShape";
import {
    CIRCLE_MODES,
    circleDistribution,
    circleFrame,
    circleInFrame,
    circleOutline,
    circleRegionOf,
    dragRadius,
    drawCircle,
    grownFromPivot,
    insideCircle,
    moveCircle,
    RADIUS_HANDLE,
    radiusHandlePoint,
    withCircleFrame,
    withInterval,
    type CircleParams,
} from "./circleGeometry";

/** The circle's one number: the interval between neighbors, which also sets its size */
const INTERVAL: ToolParam<CircleParams> = {
    key: "interval",
    label: "Spacing between neighbors, in steps",
    unit: "steps",
    primary: true,
    drag: "x",
    interval: true,
    blends: true,
    default: 2,
    range: { min: 0.5 },
    glyph: "↔",
    shown: (_p, n) => n > 1,
    display: (p, _n, stepPx) => formatSteps(p.interval / stepPx),
    value: (p, _n, stepPx) => p.interval / stepPx,
    type(p, n, text, env) {
        const steps = parseSteps(text);
        if (steps === null) return null;
        return withInterval(p, n, steps * env.stepPx, env);
    },
    scrub(base, n, m, env) {
        const was = base.interval / env.stepPx;
        const steps = scrubValue(was, scrubDistance("x", m.dx, m.dy), 0, {
            axis: "x",
            px: SPACING_RATE.px,
            step: env.snap ? SPACING_RATE.step : SPACING_FINE_STEP,
        });
        // A drag that ends where it started changes nothing; it doesn't round the value
        if (steps === was) return base;
        return withInterval(base, n, steps * env.stepPx, env);
    },
    widen(p, n, by, env) {
        const steps = p.interval / env.stepPx + by;
        if (steps < 0.5 - 1e-9) return null;
        const next = withInterval(p, n, steps * env.stepPx, env);
        return next === p ? null : next;
    },
};

/**
 * The circle tool (#389, spec #385): drawn from its center out, its size set by one radius handle
 * that changes the interval, moved from inside, and turned and flipped through its frame like
X
 * distributor, in Outline or Even spread.
 */
export const circleTool: ToolKind<CircleParams> = {
    shape: circleShape,
    params: [INTERVAL],
    scaling: "interval",
    draw: (from, to, n, env) => drawCircle(from, to, n, env),
    handles(params, n) {
        if (n <= 1) return [];
        return [
            {
                key: RADIUS_HANDLE,
                at: radiusHandlePoint(params, n),
                // Out from the center, however the circle is turned
                cursor: resizeCursor(circleFrame(params, n), { x: 1, y: 0 }),
            },
        ];
    },
    dragHandle: (base, n, _key, to, env) => dragRadius(base, n, to, env),
    outline: circleOutline,
    contains: insideCircle,
    move: (base, _n, delta, env) => moveCircle(base, delta, env),
    frameOf: circleFrame,
    withFrame: (params, _n, frame) => withCircleFrame(params, frame),
    fromFrame: circleInFrame,
    closed: {
        modes: CIRCLE_MODES,
        region: circleRegionOf,
        distribution: (params) => circleDistribution(params),
        startMode: (_params, n, mode) => distributionFor(mode, 1, n),
        // A new mode resizes the circle: it grows from the pivot
        withDistribution: (params, n, distribution, env) =>
            grownFromPivot(params, { ...params, distribution }, n, env),
    },
};
