import tolgee from "@/global/singletons/Tolgee";
import { resizeCursor } from "../frame/frame";
import { parseDegrees, scrubDistance, scrubValue } from "../editor/scrub";
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
    lineSegments,
    type LineParams,
    type LinePoint,
} from "../line/lineGeometry";
import { arcShape } from "./arcShape";
import {
    arcEnds,
    arcInFrame,
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

const ENDS_LABELS: Record<ArcEnds, () => string> = {
    open: () => tolgee.t("shapes.kinds.arc.ends.open", "Open"),
    chord: () =>
        tolgee.t("shapes.kinds.arc.ends.chord", "Close with a straight line"),
    circle: () => tolgee.t("shapes.kinds.arc.ends.circle", "Close to circle"),
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
    options: () =>
        ENDS_ORDER.map((value) => ({
            value,
            label: ENDS_LABELS[value](),
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
                label: ENDS_LABELS[value](),
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
    params: [INTERVAL, BEND],
    choices: [ENDS, lineChoice("spacing")],
    readable: isArcParams,
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
        return [
            ...ends,
            { key: BEND_KEY, at: bendHandlePoint(params), cursor: "pointer" },
        ];
    },
    dragHandle(base, n, key, to, env) {
        if (key === BEND_KEY)
            return keptInterval(dragBend(base, to, env), n, env);
        return endOf(key) >= 0
            ? lineTool.dragHandle(base, n, key, to, env)
            : base;
    },
    clickHandle: undefined,
    doubleClickHandle: undefined,
    menu: MENU,
    // The whole circle the arc is part of, unless it already is one (owner on #634)
    construction(params) {
        if (arcEnds(params) === "circle") return [];
        const segment = lineSegments(params)[0];
        return segment?.type === "arc"
            ? [{ center: segment.center, r: segment.r }]
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
