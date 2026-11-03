import tolgee from "@/global/singletons/Tolgee";
import { resizeCursor } from "../frame/frame";
import {
    parseDegrees,
    scrubDistance,
    scrubValue,
    spacingRate,
} from "../editor/scrub";
import { formatSteps, parseSteps } from "../editor/format";
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
    END_KEYS,
    ellipseOf,
    MIDDLE_KEY,
    stretchArc,
    withGuideSize,
    withSweep,
    bendHandlePoint,
    bendOf,
    drawArc,
    formatBend,
    isArcParams,
    MAX_BEND,
    MIN_BEND,
    withBend,
    withEnds,
    type ArcEnds,
} from "./arcGeometry";

/** One degree of sweep per 2 px of drag, a degree a px with `fine` */
const BEND_RATE = { px: 2, step: 1 } as const;
const BEND_FINE_RATE = { px: 1, step: 1 } as const;

/**
 * The sweep set to `degrees` around the circle or ellipse, which stays (owner on #634), with a
 * Keep interval arc sized to it again
 */
const bent = (
    p: LineParams,
    n: number,
    degrees: number,
    env: Pick<ToolEnv, "pivot" | "anchor"> = {},
): LineParams => {
    const next = withSweep(p, degrees);
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

/**
 * One radius of the circle or ellipse the arc is on, as its width (`↔`) or depth (`↕`) across, in
 * steps (owner on #634): typed, or dragged sideways; with the ratio lock on (flipped by
 * constrain while dragged) the other follows in proportion. A circle's read the same, so a shallow arc, whose guide reaches far off, can be made
 * an ellipse by typing.
 */
function guideParam(way: "width" | "depth"): ToolParam<LineParams> {
    const width = way === "width";
    const radiusOf = (p: LineParams) => {
        const g = arcGuide(p);
        return g ? (width ? g.rx : g.ry) : null;
    };
    /** The arc with this radius `r`, the other kept or (`ratio`) scaled with it */
    const sized = (p: LineParams, r: number, ratio: boolean): LineParams => {
        const g = arcGuide(p);
        if (!g || !(r > 0)) return p;
        const scale = r / (width ? g.rx : g.ry);
        const [rx, ry] = ratio
            ? [g.rx * scale, g.ry * scale]
            : width
              ? [r, g.ry]
              : [g.rx, r];
        return withGuideSize(p, rx, ry);
    };
    return {
        key: way,
        get label() {
            return width
                ? tolgee.t(
                      "shapes.kinds.arc.params.width",
                      "Width of the dashed circle or ellipse the arc is on, in steps",
                  )
                : tolgee.t(
                      "shapes.kinds.arc.params.depth",
                      "Depth of the dashed circle or ellipse the arc is on, in steps",
                  );
        },
        unit: "steps",
        primary: true,
        drag: "x",
        interval: false,
        blends: true,
        range: { min: 1 },
        shown: (p) => arcGuide(p) !== null,
        // The lock sits after the depth, at the end of "Circle 60 × 60 steps"
        ratioLockAfter: !width,
        // One phrase for the dashed guide: "Circle 60 × 60 steps", "Ellipse 60 × 72 steps"
        words: (p) =>
            width
                ? {
                      before: ellipseOf(p)
                          ? tolgee.t("shapes.kinds.arc.size.ellipse", "Ellipse")
                          : tolgee.t("shapes.kinds.arc.size.circle", "Circle"),
                  }
                : {
                      before: "×",
                      after: tolgee.t("shapes.kinds.arc.size.steps", "steps"),
                  },
        display: (p, _n, stepPx) => {
            const r = radiusOf(p);
            return r === null ? "" : formatSteps((2 * r) / stepPx);
        },
        value: (p, _n, stepPx) => (2 * (radiusOf(p) ?? 0)) / stepPx,
        type(p, n, text, env) {
            const steps = parseSteps(text);
            if (steps === null || !(steps > 0)) return null;
            return keptInterval(
                sized(p, (steps * env.stepPx) / 2, env.ratioLocked === true),
                n,
                env,
            );
        },
        set: (p, n, steps, env) =>
            keptInterval(
                sized(p, (steps * env.stepPx) / 2, env.ratioLocked === true),
                n,
                env,
            ),
        scrub(base, n, m, env) {
            const r = radiusOf(base);
            if (r === null) return base;
            const was = (2 * r) / env.stepPx;
            const steps = scrubValue(
                was,
                scrubDistance("x", m.dx, m.dy),
                0,
                spacingRate(env.snap, "x"),
            );
            if (steps === was || steps < 1) return base;
            return keptInterval(
                // The editor's env holds the lock flipped by constrain already
                sized(
                    base,
                    (steps * env.stepPx) / 2,
                    env.ratioLocked ?? m.roles.constrain,
                ),
                n,
                env,
            );
        },
    };
}

const WIDTH = guideParam("width");
const DEPTH = guideParam("depth");

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

/**
 * The Arc (#634, owner 2026-11-02): dragged from one end to the other, bowing a quarter turn to
 * the left of the drag. Its handles stretch it as a box's do: its ends side to side, its middle
 * front to back, so stretched one way it runs on an ellipse; the degrees it turns are set in the
 * editor, growing it round its circle or ellipse. It is a Line of two points with a
 * circular bend, so its spacing, interval groups, lock and who goes where are the Line's, and
 * both ends always hold a marcher. It never turns more than 359°; closed, by its chord or round to
 * a whole circle, it fills as a closed Line does.
 */
export const arcTool: ToolKind<LineParams> = {
    ...lineTool,
    shape: arcShape,
    keywords: ["arc", "bow", "semicircle"],
    params: [INTERVAL, BEND, WIDTH, DEPTH],
    choices: [ENDS, lineChoice("spacing")],
    readable: isArcParams,
    // Its width and depth can be kept in proportion with the editor's lock (owner on #634)
    ratioLock: true,
    // Every handle stretches the arc: constrain flips the ratio lock for the drag, as on a box's
    // side, and fromCenter stretches it about its circle's center (owner on #634)
    honors: {
        handle: (_key, ratioLocked) => ({
            constrain: ratioLocked ? "freeRatio" : "keepRatio",
            fromCenter: "fromCenter",
        }),
    },
    draw: (from, to, _n, env) => pivoted(drawArc(from, to, env)),
    clickPoints: undefined,
    handles(params) {
        const frame = lineFrame(params);
        const ends = params.points.map((at: LinePoint, i) => ({
            key: END_KEYS[i]!,
            at: { x: at.x, y: at.y },
            cursor: resizeCursor(frame, { x: i === 1 ? 1 : -1, y: 0 }),
        }));
        // The middle stretches it front to back, as the ends do side to side (owner on #634)
        return [
            ...ends,
            {
                key: MIDDLE_KEY,
                at: bendHandlePoint(params),
                cursor: resizeCursor(frame, { x: 0, y: 1 }),
            },
        ];
    },
    dragHandle: (base, n, key, to, env) =>
        keptInterval(stretchArc(base, key, to, env), n, env),
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
            180,
        ),
};
