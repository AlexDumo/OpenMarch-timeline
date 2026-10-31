import tolgee from "@/global/singletons/Tolgee";
import { fieldToFrame, resizeCursor } from "../frame/frame";
import { formatSteps, parseSteps } from "../editor/format";
import {
    COUNT_RATE,
    scrubDistance,
    scrubValue,
    spacingRate,
} from "../editor/scrub";
import { layGroups, MAX_GROUP_COUNT, parseIntervals } from "../spacing";
import { snapInterval } from "../box/boxGeometry";
import type {
    GroupPart,
    ToolChoice,
    ToolEnv,
    ToolGroups,
    ToolKind,
    ToolParam,
} from "../tool/toolKind";
import { curveShape, lineShape } from "./lineShape";
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
    curveInFrame,
    dragPoint,
    dragTension,
    drawCurve,
    drawLine,
    drawPoints,
    hasGroups,
    intervalRange,
    isClosed,
    landClicked,
    isLineParams,
    lineFrame,
    lineInFrame,
    lineInterval,
    measuredAxis,
    measuredBlock,
    lineOutline,
    lineSegments,
    lineStretches,
    moveLine,
    type TangentSide,
    onLine,
    openLine,
    segmentMidpoint,
    setTension,
    SMOOTH,
    splitSegment,
    tensionHandle,
    withGroups,
    withInterval,
    withLineFrame,
    withMeasured,
    settleLine,
    withSpacing,
    type LineAnchor,
    type LineMeasured,
    type LineGroup,
    type LineParams,
} from "./lineGeometry";

/** A handle's key for point `i`: `p0` is the first marcher's end */
const POINT_KEY = /^p(\d+)$/;
/** A handle's key for the midpoint of segment `i`, from point `i` to the next (#524) */
const MIDPOINT_KEY = /^m(\d+)$/;
/**
 * A handle's key for an end of smooth point `i`'s tangent bar (#525, #557): `t<i>` toward the next
 * point, `tb<i>` back toward the one before
 */
const TENSION_KEY = /^t(\d+)$/;
const TENSION_BACK_KEY = /^tb(\d+)$/;

/** The point whose handle `key` is (`p<i>`, or `t<i>` with `pattern`), or -1 */
const pointOf = (p: LineParams, key: string, pattern = POINT_KEY): number => {
    const match = pattern.exec(key);
    const index = match ? Number(match[1]) : -1;
    return index >= 0 && index < p.points.length ? index : -1;
};

/**
 * A change that turns points into corners or corners into smooth points, with a typed interval (or
 * groups, #526) kept: its stretches whole runs of gaps again, as typing it would (#524). Grown from
 * `env`'s pivot, or the line's own where there's none (a click on a handle has no env).
 */
const keptInterval = (
    next: LineParams,
    n: number,
    env: Pick<ToolEnv, "pivot" | "anchor"> = {},
): LineParams =>
    next.spacing.mode === "keep" && n > 1
        ? withGroups(next, n, next.spacing.groups, env)
        : next;

/** The point and side of the tangent bar end whose handle `key` is, or null */
function tangentOf(
    p: LineParams,
    key: string,
): { index: number; side: TangentSide } | null {
    const forward = pointOf(p, key, TENSION_KEY);
    if (forward >= 0) return { index: forward, side: 1 };
    const back = pointOf(p, key, TENSION_BACK_KEY);
    return back >= 0 ? { index: back, side: -1 } : null;
}

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

/** The line's groups, in Fit the one interval it works out to */
const groupsOf = (p: LineParams, n: number): readonly LineGroup[] =>
    p.spacing.mode === "fit"
        ? [{ interval: lineInterval(p, n) }]
        : p.spacing.groups;

/**
 * An interval list typed (#526): one number is everyone at it, as before; groups space the line
 * by them, each interval kept as typed. Null when the list isn't understood.
 */
function typedList(
    p: LineParams,
    n: number,
    text: string,
    env: ToolEnv,
): LineParams | null {
    const parsed = parseIntervals(text);
    if (!parsed.ok) return null;
    const [first, ...others] = parsed.groups;
    if (others.length === 0 && first!.count === undefined)
        return typed(p, n, first!.steps, env);
    const groups = parsed.groups.map(({ steps, count }) => ({
        interval: snapInterval(steps * env.stepPx, env, true),
        ...(count === undefined ? {} : { count }),
    }));
    return withGroups(p, n, groups, env);
}

/**
 * The line's groups with each interval changed by `change` and rounded by `round`; null when one
 * would go under half a step
 */
function eachInterval(
    p: LineParams,
    n: number,
    change: (interval: number) => number,
    round: (interval: number) => number,
    env: ToolEnv,
): LineParams | null {
    const changed = groupsOf(p, n).map((g) => ({
        ...g,
        interval: change(g.interval),
    }));
    if (changed.some((g) => g.interval < env.stepPx / 2 - 1e-9)) return null;
    const groups = changed.map((g) => ({ ...g, interval: round(g.interval) }));
    return withGroups(p, n, groups, env);
}

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
    // What it measures: none for the true distance, the box's marks for ↔ and ↕
    glyph: (p) => {
        const axis = measuredAxis(p);
        return axis === "x" ? "↔" : axis === "y" ? "↕" : null;
    },
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
    // The full list syntax (#526): `2*3+4*2` switches to groups; a filled line has one spacing
    type(p, n, text, env) {
        if (!isFilled(p)) return typedList(p, n, text, env);
        const steps = parseSteps(text);
        return steps === null ? null : typed(p, n, steps, env);
    },
    // With groups, every interval in proportion: the smallest one set to `steps`
    set: (p, n, steps, env) =>
        hasGroups(p) && !isFilled(p)
            ? eachInterval(
                  p,
                  n,
                  (interval) =>
                      (interval * steps * env.stepPx) / lineInterval(p, n),
                  (interval) => snapInterval(interval, env, true),
                  env,
              )
            : typed(p, n, steps, env),
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
        if (hasGroups(p) && !isFilled(p))
            return eachInterval(
                p,
                n,
                (interval) => interval + by * env.stepPx,
                (interval) => snapInterval(interval, env),
                env,
            );
        const steps = spacingOf(p, n) / env.stepPx + by;
        if (steps < 0.5 - 1e-9) return null;
        return spacedAt(p, n, snapInterval(steps * env.stepPx, env), env);
    },
};

/** The line's groups with group `index` changed by `change` */
function withGroup(
    p: LineParams,
    n: number,
    index: number,
    change: (group: LineGroup) => LineGroup,
    env: ToolEnv,
): LineParams {
    const groups = groupsOf(p, n);
    if (index < 0 || index >= groups.length) return p;
    return withGroups(
        p,
        n,
        groups.map((g, i) => (i === index ? change(g) : g)),
        env,
    );
}

/** A group given `count` marchers, typed: a group that was the rest no longer is */
const counted = (g: LineGroup, count: number): LineGroup => ({
    interval: g.interval,
    count,
});

/**
 * The line's mixed intervals (#526): each group a chip in the floating editor, its count and
 * interval typed or dragged, `+` adding a group and × removing one
 */
const GROUPS: ToolGroups<LineParams> = {
    shown(p, n, stepPx) {
        if (!hasGroups(p) || p.spacing.mode === "fit" || isFilled(p))
            return null;
        const { groups } = p.spacing;
        return layGroups(groups, n).map(({ count, grown }, i) => ({
            count: String(count),
            interval: formatSteps(groups[i]!.interval / stepPx),
            rest: groups[i]!.count === undefined,
            grown,
            dropped: count === 0,
        }));
    },
    type(p, n, index, part: GroupPart, text, env) {
        // A list typed into any of the numbers replaces the whole list
        if (/[+,;*x×]/i.test(text)) return typedList(p, n, text, env);
        if (part === "count") {
            const t = text.trim();
            const count = Number(t);
            if (!/^\d+$/.test(t) || count < 1 || count > MAX_GROUP_COUNT)
                return null;
            return withGroup(p, n, index, (g) => counted(g, count), env);
        }
        const steps = parseSteps(text);
        if (steps === null) return null;
        const interval = snapInterval(steps * env.stepPx, env, true);
        return withGroup(p, n, index, (g) => ({ ...g, interval }), env);
    },
    scrub(base, n, index, part, m, env) {
        const distance = scrubDistance("x", m.dx, m.dy);
        if (part === "count") {
            // From the count typed, when there is one: a dropped or grown group shows another
            const all = groupsOf(base, n);
            const was =
                all[index]?.count ?? layGroups(all, n)[index]?.count ?? 0;
            const count = Math.min(
                MAX_GROUP_COUNT,
                Math.max(
                    1,
                    scrubValue(was, distance, 0, {
                        axis: "x",
                        ...COUNT_RATE,
                    }),
                ),
            );
            if (count === was) return base;
            return withGroup(base, n, index, (g) => counted(g, count), env);
        }
        const group = groupsOf(base, n)[index];
        if (!group) return base;
        const was = group.interval / env.stepPx;
        const steps = scrubValue(was, distance, 0, spacingRate(env.snap, "x"));
        if (steps === was) return base;
        const interval = snapInterval(steps * env.stepPx, env);
        return withGroup(base, n, index, (g) => ({ ...g, interval }), env);
    },
    add(p, n, env) {
        const groups = [...groupsOf(p, n)];
        const last = groups.at(-1)!;
        // A plain line: everyone but one at its interval, then the new group of 1
        if (last.count === undefined && groups.length === 1)
            groups[0] = counted(last, Math.max(1, n - 1));
        groups.push(counted(last, 1));
        // The new group is never dropped: while the counts before it take every marcher, the
        // biggest counted group (the later one of a tie) gives one up. With every group at 1
        // there's no marcher to give, so nothing is added.
        for (;;) {
            const laid = layGroups(groups, n);
            if (laid.at(-1)!.count > 0) break;
            let from = -1;
            for (let i = 0; i < groups.length - 1; i++)
                if (
                    groups[i]!.count !== undefined &&
                    laid[i]!.count > 1 &&
                    (from < 0 || laid[i]!.count >= laid[from]!.count)
                )
                    from = i;
            if (from < 0) return p;
            groups[from] = counted(groups[from]!, laid[from]!.count - 1);
        }
        return withGroups(p, n, groups, env);
    },
    remove(p, n, index, env) {
        const groups = groupsOf(p, n).filter((_, i) => i !== index);
        if (groups.length === 0) return p;
        // One group left is everyone at its interval
        if (groups.length === 1)
            return withInterval(p, n, groups[0]!.interval, env);
        return withGroups(p, n, groups, env);
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

/** Why a line can't be measured along `axis`, or undefined when it can */
function measuredReason(p: LineParams, axis: LineMeasured): string | undefined {
    const block = measuredBlock(p, axis);
    if (block === null) return undefined;
    if (axis === "x")
        return block === "none"
            ? tolgee.t(
                  "shapes.kinds.line.measured.noX",
                  "The line doesn't go side to side",
              )
            : block === "square"
              ? tolgee.t(
                    "shapes.kinds.line.measured.squareX",
                    "Part of the line runs straight front to back",
                )
              : tolgee.t(
                    "shapes.kinds.line.measured.turnsX",
                    "The line turns back side to side",
                );
    return block === "none"
        ? tolgee.t(
              "shapes.kinds.line.measured.noY",
              "The line doesn't go front to back",
          )
        : block === "square"
          ? tolgee.t(
                "shapes.kinds.line.measured.squareY",
                "Part of the line runs straight side to side",
            )
          : tolgee.t(
                "shapes.kinds.line.measured.turnsY",
                "The line turns back front to back",
            );
}

/**
 * The Measured menu (spec #522): what the interval measures. The true distance between neighbors
 * is the default; ↔ puts neighbors the interval apart side to side, x exactly on the step grid,
 * and ↕ front to back. Each is greyed out, with why, on a line that doesn't go one way that way.
 * It shows what the intervals measure now: a line whose part turned square to its setting is laid
 * out by the true distance until it goes one way again, and shows that.
 */
const MEASURED: ToolChoice<LineParams> = {
    key: "measured",
    get label() {
        return tolgee.t("shapes.kinds.line.measured.label", "Measured");
    },
    options: (p) => [
        {
            value: "true",
            label: tolgee.t("shapes.kinds.line.measured.true", "True distance"),
        },
        {
            value: "x",
            label: tolgee.t("shapes.kinds.line.measured.x", "↔ Side to side"),
            disabled: measuredReason(p, "x"),
        },
        {
            value: "y",
            label: tolgee.t("shapes.kinds.line.measured.y", "↕ Front to back"),
            disabled: measuredReason(p, "y"),
        },
    ],
    current: (p) => measuredAxis(p) ?? "true",
    pick: (p, n, value, env) =>
        withMeasured(p, n, value === "x" || value === "y" ? value : null, env),
    // A closed line always turns back, so it's measured by the true distance (#529)
    shown: (p) => !isClosed(p),
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
        // A typed interval (or groups) keeps the line as long as its marchers need
        return next.spacing.mode === "keep" && n > 1
            ? withGroups(next, n, next.spacing.groups, env)
            : next;
    },
    // Corners hold marchers only in Fit and Keep interval, with a gap for every stretch between
    // corners (n - 1 gaps; n round a closed line, #529); smooth points aren't corners (#525)
    shown: (p, n) => {
        if (p.spacing.mode === "path" || isFilled(p)) return false;
        const stretches = lineStretches(p).length;
        if (isClosed(p))
            return p.points.some((q) => q.tension === 0) && n >= stretches;
        return stretches > 1 && n > stretches;
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
    pick(p, n, value, env) {
        if (value !== "corner" && value !== "smooth") return p;
        const points = p.points.map((q) => ({
            ...q,
            // A smooth point made smooth keeps its own tension
            tension: value === "corner" ? 0 : q.tension || SMOOTH,
        }));
        if (points.every((q, i) => q.tension === p.points[i]!.tension))
            return p;
        return keptInterval({ ...p, points }, n, env);
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
 * A click on a point selects it; a selected smooth point shows its tangent bar, whose ends set how
 * round the line bends through it, and a double-click makes a point smooth, or a corner again
 * (#557). A typed list (`2*3+4*2`, #526) spaces it in groups of
 * marchers, each a chip in the editor.
 */
export const lineTool: ToolKind<LineParams> = {
    shape: lineShape,
    params: [INTERVAL],
    choices: [ENDS, SPACING, MEASURED, CORNERS, POINTS],
    groups: GROUPS,
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
    handles(params, _n, selected) {
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
            selects: true,
        }));
        const midpoints = lineSegments(params).map((_segment, i) => ({
            key: `m${i}`,
            at: segmentMidpoint(params, i),
            cursor: "pointer",
            adds: true,
        }));
        // Only the selected point's tangent bar, so the line stays clean while you edit (#557)
        const index = selected ? pointOf(params, selected) : -1;
        const bar = params.points[index];
        const tensions = bar
            ? ([1, -1] as const).flatMap((side) => {
                  const at = tensionHandle(params, index, side);
                  return at
                      ? [
                            {
                                key: `${side === 1 ? "t" : "tb"}${index}`,
                                at,
                                cursor: "pointer",
                                bar: { x: bar.x, y: bar.y },
                            },
                        ]
                      : [];
              })
            : [];
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
        const tension = tangentOf(base, key);
        if (tension)
            return keptInterval(
                dragTension(base, tension.index, to, env, tension.side),
                n,
                env,
            );
        const index = pointOf(base, key);
        if (index < 0) return base;
        return dragPoint(base, n, index, to, env);
    },
    // A midpoint clicked splits its segment; a point clicked is selected by the host (#557)
    clickHandle(params, _n, key) {
        const segment = midpointOf(params, key);
        return segment >= 0 ? splitSegment(params, segment) : null;
    },
    // A point double-clicked turns smooth, or a corner again (#557)
    doubleClickHandle(params, n, key) {
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
    // A closed line is grabbed inside it too, as a box is (#529)
    contains: (params, n, at, env) =>
        onLine(params, n, at, env) ||
        (isClosed(params) &&
            lineRegion(params).contains(fieldToFrame(lineFrame(params), at))),
    move: (base, _n, delta, env) => moveLine(base, delta, env),
    frameOf: (params) => lineFrame(params),
    withFrame: (params, _n, frame) => withLineFrame(params, frame),
    settle: settleLine,
    fromFrame: lineInFrame,
    closed: lineClosed,
};

/**
 * The Curve (#525, spec #522): a preset of the Line, the same kind and recipe, whose points start
 * smooth. A drag draws a gentle bow (a smooth middle point a quarter of the way out, to the left
 * of the drag), clicks draw a curve through the points, and a shape turned into a Curve arches across its frame. Placed, it
 * reads back as a Line.
 */
export const curveTool: ToolKind<LineParams> = {
    ...lineTool,
    preset: "curve",
    keywords: ["curve", "arc-like", "smooth"],
    shape: curveShape,
    draw: (from, to, _n, env) => drawCurve(from, to, env),
    clickPoints: {
        land: landClicked,
        draw: (points, _n, env) => drawPoints(points, env, SMOOTH),
        close(points, n, env) {
            const p = drawPoints(points, env, SMOOTH);
            return p && closeLine(p, n, env);
        },
    },
    fromFrame: curveInFrame,
};
