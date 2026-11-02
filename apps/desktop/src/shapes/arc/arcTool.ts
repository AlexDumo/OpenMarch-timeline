import tolgee from "@/global/singletons/Tolgee";
import { resizeCursor } from "../frame/frame";
import {
    parseDegrees,
    scrubDistance,
    scrubValue,
    spacingRate,
} from "../editor/scrub";
import { formatSteps } from "../editor/format";
import type {
    ToolChoice,
    ToolChoicePicture,
    ToolEnv,
    ToolHandleMenu,
    ToolKind,
    ToolParam,
} from "../tool/toolKind";
import type { XY } from "../types";
import { INTERVAL, keptInterval, lineTool, pivoted } from "../line/lineTool";
import { lineFillSpots } from "../line/lineFill";
import {
    lineFrame,
    lineOutline,
    type LineParams,
    type LinePoint,
} from "../line/lineGeometry";
import { arcShape } from "./arcShape";
import {
    arcEnds,
    arcGuide,
    arcInFrame,
    DEPTH_KEY,
    dragRadius,
    ellipseOf,
    radiusHandlePoints,
    slideEnd,
    WIDTH_KEY,
    withGuideSize,
    bendHandlePoint,
    bendOf,
    dragBend,
    drawArc,
    formatBend,
    isArcParams,
    landBend,
    MAX_BEND,
    MIN_BEND,
    withBend,
    withEnds,
    type ArcEnds,
} from "./arcGeometry";

/** The bend handle's key: halfway along the arc */
export const BEND_KEY = "bend";
/** The ends' keys, as the Line's points: `p0` is the first marcher's end */
const END_KEYS = ["p0", "p1"] as const;

/** One degree of sweep per 2 px of drag, a degree a px with `fine` */
const BEND_RATE = { px: 2, step: 1 } as const;
const BEND_FINE_RATE = { px: 1, step: 1 } as const;

/** The sweep set to `degrees`, the way it bows now, with a Keep interval arc sized to it again */
const bent = (
    p: LineParams,
    n: number,
    degrees: number,
    env: Pick<ToolEnv, "pivot" | "anchor"> = {},
): LineParams => {
    const sign = Math.sign(bendOf(p)) || 1;
    const next = withBend(p, sign * degrees);
    return next === p ? p : keptInterval(next, n, env);
};

/** How far the arc turns, in degrees: what the bend handle sets */
const BEND: ToolParam<LineParams> = {
    key: "bend",
    get label() {
        return tolgee.t(
            "shapes.kinds.arc.params.bend",
            "How far the arc turns",
        );
    },
    unit: "degrees",
    primary: true,
    drag: "x",
    interval: false,
    blends: true,
    default: 90,
    range: { min: MIN_BEND, max: MAX_BEND },
    display: (p) => formatBend(bendOf(p)),
    value: (p) => Math.abs(bendOf(p)),
    type(p, n, text, env) {
        const degrees = parseDegrees(text);
        if (degrees === null || !(Math.abs(degrees) >= MIN_BEND)) return null;
        return bent(p, n, Math.min(MAX_BEND, Math.abs(degrees)), env);
    },
    set: (p, n, degrees, env) => bent(p, n, degrees, env),
    scrub(base, n, m, env) {
        const was = Math.abs(bendOf(base));
        const degrees = scrubValue(was, scrubDistance("x", m.dx, m.dy), 0, {
            axis: "x",
            ...(env.snap ? BEND_RATE : BEND_FINE_RATE),
        });
        if (degrees === was) return base;
        return bent(
            base,
            n,
            Math.min(MAX_BEND, Math.max(MIN_BEND, degrees)),
            env,
        );
    },
    widen(p, n, by, env) {
        const degrees = Math.abs(bendOf(p)) + by * 15;
        if (degrees < MIN_BEND || degrees > MAX_BEND) return null;
        const next = bent(p, n, degrees, env);
        return next === p ? null : next;
    },
};

/** A size as typed: "8 × 5", "8x5", "8 by 5.5", in steps; null for anything else */
function parseGuideSize(text: string): { w: number; d: number } | null {
    const m =
        /^\s*(\d+(?:\.\d+)?)\s*(?:×|x|X|\*|by)\s*(\d+(?:\.\d+)?)\s*$/.exec(
            text,
        );
    if (!m) return null;
    const w = Number(m[1]);
    const d = Number(m[2]);
    return w > 0 && d > 0 ? { w, d } : null;
}

/**
 * The width × depth across of the circle or ellipse the arc is on, in steps (owner on #634):
 * typed as "8 × 5", dragged sideways for its width and up and down for its depth, both in
 * proportion with constrain. A circle's reads "6 × 6", so a shallow arc,
 * whose guide reaches far off, can be made an ellipse by typing.
 */
const SIZE: ToolParam<LineParams> = {
    key: "size",
    get label() {
        return tolgee.t(
            "shapes.kinds.arc.params.size",
            "Width × depth of the ellipse the arc is on, in steps",
        );
    },
    unit: "steps",
    primary: true,
    drag: "both",
    interval: false,
    blends: true,
    shown: (p) => arcGuide(p) !== null,
    display(p, _n, stepPx) {
        const g = arcGuide(p);
        if (!g) return "";
        return `${formatSteps((2 * g.rx) / stepPx)} × ${formatSteps((2 * g.ry) / stepPx)}`;
    },
    type(p, n, text, env) {
        const size = parseGuideSize(text);
        if (!size) return null;
        const next = withGuideSize(
            p,
            (size.w * env.stepPx) / 2,
            (size.d * env.stepPx) / 2,
        );
        return keptInterval(next, n, env);
    },
    // Sideways for its width, up and down for its depth; constrain keeps its proportions
    scrub(base, n, m, env) {
        const g = arcGuide(base);
        if (!g) return base;
        const width = m.axis === "x";
        const was = (2 * (width ? g.rx : g.ry)) / env.stepPx;
        const steps = scrubValue(
            was,
            m.dx,
            m.dy,
            spacingRate(env.snap, m.axis),
        );
        if (steps === was || steps < 1) return base;
        const r = (steps * env.stepPx) / 2;
        const scale = r / (width ? g.rx : g.ry);
        const [rx, ry] = m.roles.constrain
            ? [g.rx * scale, g.ry * scale]
            : width
              ? [r, g.ry]
              : [g.rx, r];
        return keptInterval(withGuideSize(base, rx, ry), n, env);
    },
};

/** A small arc of `bend` degrees closed as `ends`, with `n` marchers laid out on it */
function arcPicture(ends: ArcEnds, n: number): ToolChoicePicture {
    const open: LineParams = withBend(
        {
            points: [
                { x: 0, y: 0, tension: 0 },
                { x: 20, y: 0, tension: 0 },
            ],
            spacing: { mode: "fit" },
        },
        150,
    );
    const p = withEnds(open, ends);
    return {
        lines: [
            {
                points: lineOutline(p),
                ...(ends === "open" ? {} : { closed: true }),
                faint: true,
            },
        ],
        dots: lineFillSpots(p, n).map(({ x, y }): XY => ({ x, y })),
    };
}

/** Each way to close it, in words; an arc on an ellipse closes all the way around it */
const ENDS_LABELS: Record<ArcEnds, (p?: LineParams) => string> = {
    open: () => tolgee.t("shapes.kinds.arc.ends.open", "Open"),
    chord: () =>
        tolgee.t("shapes.kinds.arc.ends.chord", "Close with a straight line"),
    circle: (p) =>
        p && ellipseOf(p)
            ? tolgee.t(
                  "shapes.kinds.arc.ends.round",
                  "Close all the way around",
              )
            : tolgee.t("shapes.kinds.arc.ends.circle", "Close to circle"),
};
const ENDS_ORDER: readonly ArcEnds[] = ["open", "chord", "circle"];

const isEnds = (value: string): value is ArcEnds =>
    (ENDS_ORDER as readonly string[]).includes(value);

/** The arc closed or opened, with a Keep interval arc sized to its new outline */
const closedAs = (
    p: LineParams,
    n: number,
    ends: ArcEnds,
    env: Pick<ToolEnv, "pivot" | "anchor"> = {},
): LineParams => {
    const next = withEnds(p, ends);
    return next === p ? p : keptInterval(next, n, env);
};

/**
 * Open, closed by its chord, or closed round to a whole circle (owner, #634). Closed either way,
 * it is filled as a closed Line is (Grid, Outline, Spread); opened, it is the arc it was.
 */
const ENDS: ToolChoice<LineParams> = {
    key: "ends",
    get label() {
        return tolgee.t("shapes.kinds.arc.ends.label", "Open or closed");
    },
    options: (p) =>
        ENDS_ORDER.map((value) => ({
            value,
            label: ENDS_LABELS[value](p),
            picture: arcPicture(value, value === "circle" ? 8 : 6),
        })),
    current: (p) => arcEnds(p),
    pick: (p, n, value, env) =>
        isEnds(value) ? closedAs(p, n, value, env) : p,
};

/** The Line's spacing menu, but measured along the arc only: its other measures are a Line's */
const lineChoice = (key: string) =>
    lineTool.choices!.find((choice) => choice.key === key)!;

/** A right-click on any of its handles: how it's closed, as the editor's menu has it */
const MENU: ToolHandleMenu<LineParams> = {
    sections: (p) => [
        {
            items: ENDS_ORDER.map((value) => ({
                value,
                label: ENDS_LABELS[value](p),
                checked: arcEnds(p) === value,
            })),
        },
    ],
    pick(p, n, _key, value, env) {
        if (!isEnds(value)) return null;
        const next = closedAs(p, n, value, env);
        return next === p ? null : { params: next };
    },
};

/** The handle `key` is: an end's index, the bend, or neither */
const endOf = (key: string): number =>
    (END_KEYS as readonly string[]).indexOf(key);

/**
 * The Arc (#634, owner 2026-11-02): dragged from one end to the other, bowing a quarter turn to
 * the left of the drag, then bent by the handle halfway along it, which reads the sweep in degrees
 * and sticks to the common sweeps unless `fine` is held. It is a Line of two points with a
 * circular bend, so its spacing, interval groups, lock and who goes where are the Line's, and
 * both ends always hold a marcher. It never turns more than 359°; closed, by its chord or round to
 * a whole circle, it fills as a closed Line does.
 */
export const arcTool: ToolKind<LineParams> = {
    ...lineTool,
    shape: arcShape,
    keywords: ["arc", "bow", "semicircle"],
    params: [INTERVAL, BEND, SIZE],
    choices: [ENDS, lineChoice("spacing")],
    readable: isArcParams,
    // A radius handle keeps the proportions with constrain and stretches from the center with
    // fromCenter; an end on an ellipse slides
    // round it, taking neither; otherwise as a Line's (owner on #634)
    honors: {
        handle(key, ratioLocked, params, n) {
            if (key === WIDTH_KEY || key === DEPTH_KEY)
                return { constrain: "keepRatio", fromCenter: "fromCenter" };
            if (key === BEND_KEY || ellipseOf(params)) return {};
            return lineTool.honors!.handle!(key, ratioLocked, params, n);
        },
    },
    draw: (from, to, _n, env) => pivoted(drawArc(from, to, env)),
    clickPoints: undefined,
    handles(params) {
        const frame = lineFrame(params);
        const ends = params.points.map((at: LinePoint, i) => ({
            key: END_KEYS[i]!,
            at: { x: at.x, y: at.y },
            cursor:
                arcEnds(params) === "open"
                    ? resizeCursor(frame, { x: i === 1 ? 1 : -1, y: 0 })
                    : "move",
        }));
        // The guide's width and depth (owner on #634): round handles on it
        const radii = radiusHandlePoints(params);
        return [
            ...ends,
            { key: BEND_KEY, at: bendHandlePoint(params), cursor: "pointer" },
            ...(radii
                ? [
                      {
                          key: WIDTH_KEY,
                          at: radii.width,
                          cursor: "pointer",
                          adds: true,
                      },
                      {
                          key: DEPTH_KEY,
                          at: radii.depth,
                          cursor: "pointer",
                          adds: true,
                      },
                  ]
                : []),
        ];
    },
    dragHandle(base, n, key, to, env) {
        if (key === BEND_KEY)
            return keptInterval(dragBend(base, to, env), n, env);
        if (key === WIDTH_KEY || key === DEPTH_KEY)
            return keptInterval(dragRadius(base, key, to, env), n, env);
        const end = endOf(key);
        if (end < 0) return base;
        // On an ellipse an end slides round it; on a circle it drags as a Line's
        return ellipseOf(base)
            ? keptInterval(slideEnd(base, end, to, env), n, env)
            : lineTool.dragHandle(base, n, key, to, env);
    },
    clickHandle: undefined,
    doubleClickHandle: undefined,
    menu: MENU,
    // The whole circle the arc is part of, unless it already is one (owner on #634)
    construction(params) {
        if (arcEnds(params) === "circle") return [];
        const g = arcGuide(params);
        return g
            ? [{ center: g.center, rx: g.rx, ry: g.ry, rotation: g.axis }]
            : [];
    },
    handleTip: (params, _n, key) =>
        key === BEND_KEY ? formatBend(bendOf(params)) : null,
    snapPoints: (params) => [
        ...params.points.map(({ x, y }) => ({ x, y })),
        bendHandlePoint(params),
    ],
    fromFrame: (frame, n, env) => pivoted(arcInFrame(frame, n, env)),
    pictureParams: (_n, env) =>
        withBend(
            {
                points: [
                    { x: -4 * env.stepPx, y: 2 * env.stepPx, tension: 0 },
                    { x: 4 * env.stepPx, y: 2 * env.stepPx, tension: 0 },
                ],
                spacing: { mode: "fit" },
            },
            landBend(180, env),
        ),
};
