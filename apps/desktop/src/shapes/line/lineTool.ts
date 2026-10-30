import tolgee from "@/global/singletons/Tolgee";
import { resizeCursor } from "../frame/frame";
import { formatSteps, parseSteps } from "../editor/format";
import {
    COUNT_RATE,
    scrubDistance,
    scrubValue,
    spacingRate,
} from "../editor/scrub";
import { layGroups, parseIntervals } from "../spacing";
import { snapInterval } from "../box/boxGeometry";
import type {
    GroupPart,
    ToolChoice,
    ToolEnv,
    ToolGroups,
    ToolKind,
    ToolParam,
} from "../tool/toolKind";
import { lineShape } from "./lineShape";
import {
    dragPoint,
    drawLine,
    hasGroups,
    isLineParams,
    lineFrame,
    lineInFrame,
    lineInterval,
    moveLine,
    onLine,
    withGroups,
    withInterval,
    withLineFrame,
    withSpacing,
    type LineAnchor,
    type LineGroup,
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
    // The full list syntax (#526): `2*3+4*2` switches to groups
    type: (p, n, text, env) => typedList(p, n, text, env),
    // With groups, every interval in proportion: the smallest one set to `steps`
    set: (p, n, steps, env) =>
        hasGroups(p)
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
        if (hasGroups(p))
            return eachInterval(
                p,
                n,
                (interval) => interval + by * env.stepPx,
                (interval) => snapInterval(interval, env),
                env,
            );
        const steps = lineInterval(p, n) / env.stepPx + by;
        if (steps < 0.5 - 1e-9) return null;
        return withInterval(p, n, snapInterval(steps * env.stepPx, env), env);
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
        if (!hasGroups(p) || p.spacing.mode === "fit") return null;
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
            if (!/^\d+$/.test(t) || Number(t) < 1) return null;
            return withGroup(p, n, index, (g) => counted(g, Number(t)), env);
        }
        const steps = parseSteps(text);
        if (steps === null) return null;
        const interval = snapInterval(steps * env.stepPx, env, true);
        return withGroup(p, n, index, (g) => ({ ...g, interval }), env);
    },
    scrub(base, n, index, part, m, env) {
        const distance = scrubDistance("x", m.dx, m.dy);
        if (part === "count") {
            const was = layGroups(groupsOf(base, n), n)[index]?.count ?? 0;
            const count = Math.max(
                1,
                scrubValue(was, distance, 0, { axis: "x", ...COUNT_RATE }),
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
        // A marcher from a counted last group goes to the new one, so the new one isn't dropped
        if (last.count !== undefined && last.count > 1)
            groups[groups.length - 1] = counted(last, last.count - 1);
        else if (last.count === undefined && groups.length === 1)
            groups[0] = counted(last, Math.max(1, n - 1));
        return withGroups(p, n, [...groups, counted(last, 1)], env);
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
 * every shape. Drawn in Fit; typing an interval keeps it, the length following from the pivot. A
 * typed list (`2*3+4*2`, #526) spaces it in groups of marchers, each a chip in the editor.
 */
export const lineTool: ToolKind<LineParams> = {
    shape: lineShape,
    params: [INTERVAL],
    choices: [SPACING],
    groups: GROUPS,
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
