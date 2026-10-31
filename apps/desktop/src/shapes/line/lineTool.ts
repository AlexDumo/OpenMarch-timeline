import tolgee from "@/global/singletons/Tolgee";
import type { XY } from "../types";
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
    ToolHandleMenu,
    ToolKind,
    ToolMenuItem,
    ToolMenuSection,
    ToolParam,
} from "../tool/toolKind";
import { curveShape, lineShape } from "./lineShape";
import {
    cornersPictures,
    endsPictures,
    measuredPictures,
    spacingPictures,
} from "./linePictures";
import {
    fillInterval,
    isFilled,
    lineClosed,
    lineRegion,
    withFillInterval,
} from "./lineFill";
import {
    cornerGaps,
    closeLine,
    cornerOffInterval,
    curveInFrame,
    deletePoint,
    dragPoint,
    dragTension,
    drawCurve,
    drawLine,
    drawPoints,
    hasGroups,
    holdsMarcher,
    intervalRange,
    isClosed,
    landClicked,
    isLineParams,
    lineFrame,
    lineInFrame,
    lineInterval,
    measuredAxis,
    measuredBlock,
    minPoints,
    openAt,
    lineOutline,
    lineSegments,
    moveLine,
    type TangentSide,
    onLine,
    openLine,
    segmentMidpoint,
    segmentStraight,
    setPointMarcher,
    setSegmentCurved,
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
        if (range && isRange(p, n)) {
            const min = formatSteps(range.min / stepPx);
            const max = formatSteps(range.max / stepPx);
            // Segments a hair apart read the same: one number, not "2–2"
            if (min !== max) return `${min}–${max}`;
        }
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
    // A hair apart (a curve's chords, a click off the grid) isn't a range
    return range !== null && range.max - range.min > 1e-3 * range.max;
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
            picture: endsPictures().open,
        },
        {
            value: "closed",
            label: tolgee.t("shapes.kinds.line.ends.closed", "Closed"),
            picture: endsPictures().closed,
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
        picture: spacingPictures()["path-start"],
    },
    {
        value: "path-center",
        label: tolgee.t(
            "shapes.kinds.line.spacing.pathCenter",
            "Interval on the path, centered",
        ),
        picture: spacingPictures()["path-center"],
    },
    {
        value: "path-end",
        label: tolgee.t(
            "shapes.kinds.line.spacing.pathEnd",
            "Interval on the path, from the end",
        ),
        picture: spacingPictures()["path-end"],
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
            picture: spacingPictures().fit,
        },
        {
            value: "keep",
            label: tolgee.t("shapes.kinds.line.spacing.keep", "Keep interval"),
            picture: spacingPictures().keep,
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
            picture: measuredPictures().true,
        },
        {
            value: "x",
            label: tolgee.t("shapes.kinds.line.measured.x", "↔ Side to side"),
            disabled: measuredReason(p, "x"),
            picture: measuredPictures().x,
        },
        {
            value: "y",
            label: tolgee.t("shapes.kinds.line.measured.y", "↕ Front to back"),
            disabled: measuredReason(p, "y"),
            picture: measuredPictures().y,
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
            picture: cornersPictures().on,
        },
        {
            value: "off",
            label: tolgee.t(
                "shapes.kinds.line.corners.off",
                "Intervals run around corners",
            ),
            picture: cornersPictures().off,
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
        const between = isClosed(p) ? p.points : p.points.slice(1, -1);
        const corners = between.filter((q) => q.tension === 0).length;
        if (isClosed(p)) return corners > 0 && n >= corners;
        return corners > 0 && n > corners + 1;
    },
};

/** Why a point's own marcher answer does nothing now (#569), or undefined when it counts */
function marcherReason(
    p: LineParams,
    n: number,
    index: number,
): string | undefined {
    if (p.spacing.mode === "path")
        return tolgee.t(
            "shapes.kinds.line.menu.marcherPath",
            "Interval on the path runs past every point",
        );
    if (isFilled(p))
        return tolgee.t(
            "shapes.kinds.line.menu.marcherFilled",
            "A filled line's spots follow its fill",
        );
    // Held points only hold marchers with a gap for every stretch: too few marchers, and the
    // answer would change nothing
    if (cornerGaps(withPointMarcher(p, index, true), n) === null)
        return tolgee.t(
            "shapes.kinds.line.menu.marcherTooFew",
            "Too few marchers for one on every point",
        );
    return undefined;
}

/** `p` with point `index`'s own marcher answer set to `marcher` */
const withPointMarcher = (
    p: LineParams,
    index: number,
    marcher: boolean,
): LineParams => ({
    ...p,
    points: p.points.map((q, i) => (i === index ? { ...q, marcher } : q)),
});

/** The point menu's answers to whether a marcher stands on the point (#569) */
const MARCHER_VALUES = {
    "marcher-always": true,
    "marcher-even": false,
} as const;

/** Whether point `index` would hold a marcher with no answer of its own: the line's setting */
function lineGivesMarcher(p: LineParams, index: number): boolean {
    const points = p.points.map((q, i) => {
        if (i !== index) return q;
        const { marcher: _marcher, ...rest } = q;
        return rest;
    });
    return holdsMarcher({ ...p, points }, index);
}

/** What the line does on a point, said as it is (following) or as it would be (overridden) */
function lineCaption(gives: boolean, follows: boolean): string {
    if (follows)
        return gives
            ? tolgee.t(
                  "shapes.kinds.line.menu.linePuts",
                  "Line puts a marcher here",
              )
            : tolgee.t(
                  "shapes.kinds.line.menu.lineKeeps",
                  "Line keeps spacing even here",
              );
    return gives
        ? tolgee.t(
              "shapes.kinds.line.menu.lineWouldPut",
              "Line would put a marcher here",
          )
        : tolgee.t(
              "shapes.kinds.line.menu.lineWouldKeep",
              "Line would keep spacing even here",
          );
}

/**
 * Whether a marcher stands on the point (#569, look #568): Follow line's marchers, on while the
 * point has no answer of its own, with what the line does under it; Marcher | Even spacing under
 * that, greyed with the line's answer marked while following, the point's own answer when not.
 * Where the answer does nothing the section is greyed out with why, but a stored answer can still
 * be dropped by following again.
 */
function marcherSection(
    p: LineParams,
    n: number,
    index: number,
): ToolMenuSection {
    const own = p.points[index]!.marcher;
    const follows = own === undefined;
    const disabled = marcherReason(p, n, index);
    const gives = lineGivesMarcher(p, index);
    // Where the answer counts for nothing, the line's setting isn't shown as one either
    const now = own ?? (disabled ? undefined : gives);
    const answer = (
        value: keyof typeof MARCHER_VALUES,
        label: string,
    ): ToolMenuItem => ({
        value,
        label,
        checked: now === MARCHER_VALUES[value],
        ...(disabled ? { disabled } : {}),
    });
    return {
        label: tolgee.t(
            "shapes.kinds.line.menu.marcher",
            "Marcher on this point",
        ),
        look: "follow",
        caption: disabled ?? lineCaption(gives, follows),
        items: [
            {
                value: "marcher-follow",
                label: tolgee.t(
                    "shapes.kinds.line.menu.marcherFollow",
                    "Follow line's marchers",
                ),
                toggle: true,
                checked: follows,
                // Following again only drops what the point said
                ...(disabled && follows ? { disabled } : {}),
            },
            answer(
                "marcher-always",
                tolgee.t("shapes.kinds.line.menu.marcherAlways", "Marcher"),
            ),
            answer(
                "marcher-even",
                tolgee.t("shapes.kinds.line.menu.marcherEven", "Even spacing"),
            ),
        ],
    };
}

/** Right-click on point `index` (#569) */
function pointMenu(p: LineParams, n: number, index: number): ToolMenuSection[] {
    const q = p.points[index]!;
    const smoothPoint = q.tension > 0;
    const closed = isClosed(p);
    const last = p.points.length - 1;
    const end = !closed && (index === 0 || index === last);
    const sections: ToolMenuSection[] = [
        {
            label: tolgee.t("shapes.kinds.line.menu.cornerType", "Corner type"),
            look: "segmented",
            hint: tolgee.t(
                "shapes.kinds.line.menu.swapHint",
                "Double-click a point to swap",
            ),
            items: [
                {
                    value: "corner",
                    label: tolgee.t("shapes.kinds.line.menu.corner", "Corner"),
                    checked: !smoothPoint,
                },
                {
                    value: "smooth",
                    label: tolgee.t("shapes.kinds.line.menu.smooth", "Smooth"),
                    checked: smoothPoint,
                },
                ...(smoothPoint
                    ? [
                          {
                              value: "roundness",
                              label: tolgee.t(
                                  "shapes.kinds.line.menu.roundness",
                                  "Roundness",
                              ),
                          },
                      ]
                    : []),
            ],
        },
    ];
    // An open line's ends always hold a marcher
    if (!end) sections.push(marcherSection(p, n, index));
    const fewest = p.points.length <= minPoints(p);
    sections.push({
        items: [
            {
                value: "delete",
                label: tolgee.t(
                    "shapes.kinds.line.menu.delete",
                    "Delete point",
                ),
                icon: "trash",
                destructive: true,
                ...(fewest
                    ? {
                          disabled: closed
                              ? tolgee.t(
                                    "shapes.kinds.line.menu.fewestClosed",
                                    "A closed line needs at least three points",
                                )
                              : tolgee.t(
                                    "shapes.kinds.line.menu.fewestOpen",
                                    "A line needs at least two points",
                                ),
                      }
                    : {}),
            },
        ],
    });
    if (closed)
        sections.push({
            items: [
                {
                    value: "open",
                    label: tolgee.t("shapes.kinds.line.menu.open", "Open here"),
                },
            ],
        });
    else if (end)
        sections.push({
            items: [
                {
                    value: "close",
                    label: tolgee.t(
                        "shapes.kinds.line.menu.close",
                        "Close line",
                    ),
                    ...(p.points.length < 3
                        ? {
                              disabled: tolgee.t(
                                  "shapes.kinds.line.menu.closeFew",
                                  "A line needs three points to close",
                              ),
                          }
                        : {}),
                },
            ],
        });
    return sections;
}

/** Right-click on segment `index`'s middle (#569) */
function segmentMenu(p: LineParams, index: number): ToolMenuSection[] {
    const straight = segmentStraight(p, index);
    // Smooth points in a straight run still make a straight segment
    const curves = !segmentStraight(setSegmentCurved(p, index, true), index);
    return [
        {
            items: [
                {
                    value: "add",
                    label: tolgee.t(
                        "shapes.kinds.line.menu.add",
                        "Add point here",
                    ),
                },
            ],
        },
        {
            items: [
                {
                    value: "straight",
                    label: tolgee.t(
                        "shapes.kinds.line.menu.straight",
                        "Straight",
                    ),
                    checked: straight,
                },
                {
                    value: "curved",
                    label: tolgee.t("shapes.kinds.line.menu.curved", "Curved"),
                    checked: !straight,
                    ...(curves
                        ? {}
                        : {
                              disabled: tolgee.t(
                                  "shapes.kinds.line.menu.noCurve",
                                  "The line runs straight through here",
                              ),
                          }),
                },
            ],
        },
    ];
}

/**
 * Right-click menus on a Line's points and segments (#569): a point's corner or smooth, its
 * roundness, whether a marcher stands on it, deleting it and closing or opening the line there; a
 * segment's new point and whether it's straight or curved.
 */
const MENU: ToolHandleMenu<LineParams> = {
    sections(p, n, key) {
        const index = pointOf(p, key);
        if (index >= 0) return pointMenu(p, n, index);
        const segment = midpointOf(p, key);
        return segment >= 0 ? segmentMenu(p, segment) : null;
    },
    pick(p, n, key, value, env) {
        const segment = midpointOf(p, key);
        if (segment >= 0) {
            if (value === "add")
                return {
                    params: splitSegment(p, segment),
                    selected: `p${segment + 1}`,
                };
            if (value === "straight" || value === "curved") {
                const next = setSegmentCurved(p, segment, value === "curved");
                // The ticked answer again changes nothing, not even a Keep interval line's size
                return next === p
                    ? null
                    : { params: keptInterval(next, n, env) };
            }
            return null;
        }
        const index = pointOf(p, key);
        if (index < 0) return null;
        switch (value) {
            case "corner": {
                const next = setTension(p, index, 0);
                return next === p
                    ? null
                    : { params: keptInterval(next, n, env) };
            }
            // Smooth shows the point's bar straight away, as Roundness does
            case "smooth":
                return {
                    params:
                        p.points[index]!.tension > 0
                            ? p
                            : keptInterval(
                                  setTension(p, index, SMOOTH),
                                  n,
                                  env,
                              ),
                    selected: key,
                };
            case "roundness":
                return p.points[index]!.tension > 0
                    ? { params: p, selected: key }
                    : null;
            // Following again drops the point's answer, even where it does nothing; switching it
            // off sets the other answer than the line's, so the override is one click
            case "marcher-follow": {
                const follows = p.points[index]!.marcher === undefined;
                if (follows && marcherReason(p, n, index)) return null;
                return {
                    params: setPointMarcher(
                        p,
                        n,
                        index,
                        follows ? !lineGivesMarcher(p, index) : undefined,
                        env,
                    ),
                };
            }
            // Picked while following, the line's own answer is set over it all the same
            case "marcher-always":
            case "marcher-even": {
                if (marcherReason(p, n, index)) return null;
                const next = setPointMarcher(
                    p,
                    n,
                    index,
                    MARCHER_VALUES[value],
                    env,
                );
                return next === p ? null : { params: next };
            }
            // The points after it move up one: nothing stays selected
            case "delete":
                return {
                    params: deletePoint(p, n, index, env),
                    selected: null,
                };
            case "close":
                return { params: closeLine(p, n, env) };
            case "open":
                return { params: openAt(p, n, index, env), selected: null };
            default:
                return null;
        }
    },
};

/**
 * The Line (#523, #524, #525, spec #522): a line of marchers drawn with one drag (two points) or by
 * clicking point after point, every point and every segment's midpoint a handle, moved from its
 * body, and turned and flipped through its frame like every shape. Drawn in Fit; typing an interval
 * keeps it, the length following from the pivot. Every corner holds a marcher unless switched off.
 * A click on a point selects it; a selected smooth point shows its tangent bar, whose ends set how
 * round the line bends through it, and a double-click makes a point smooth, or a corner again
 * (#557). A right-click on a point or a segment's middle opens its menu (#569). A typed list
 * (`2*3+4*2`, #526) spaces it in groups of marchers, each a chip in the editor.
 */
export const lineTool: ToolKind<LineParams> = {
    shape: lineShape,
    params: [INTERVAL],
    choices: [ENDS, SPACING, MEASURED, CORNERS],
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
    menu: MENU,
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
    pictureParams: (_n, env) => zigzag(env, 0),
};

/** The picture's zigzag (owner, 2026-10-31): six points across the square, corners or smooth */
const ZIGZAG: readonly XY[] = [
    { x: -4.5, y: 1.5 },
    { x: -2.7, y: -1.5 },
    { x: -0.9, y: 1.5 },
    { x: 0.9, y: -1.5 },
    { x: 2.7, y: 1.5 },
    { x: 4.5, y: -1.5 },
];
const zigzag = (env: ToolEnv, tension: number): LineParams =>
    drawPoints(ZIGZAG, env, tension)!;

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
    pictureParams: (_n, env) => zigzag(env, SMOOTH),
};
