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
    arcFootprint,
    withFootprint,
    withDegrees,
    landedDegrees,
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
 * The sweep set to `degrees`: up to a half turn its ends staying, past it its circle or ellipse
 * (owner on #634); with a Keep interval arc sized to it again
 */
const bent = (
    p: LineParams,
    n: number,
    degrees: number,
    env: Pick<ToolEnv, "pivot" | "anchor"> = {},
): LineParams => {
    const next = withDegrees(p, degrees);
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
    // The angle lines' button follows it (owner on #634)
    angleLinesAfter: true,
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
        // Its middle handle lands on the grid or a field line as it goes (owner on #634)
        const landed = landedDegrees(
            base,
            Math.min(MAX_BEND, Math.max(MIN_BEND, degrees)),
            env,
        );
        return landed === was ? base : bent(base, n, landed, env);
    },
    widen(p, n, by, env) {
        const degrees = Math.abs(bendOf(p)) + by * 15;
        if (degrees < MIN_BEND || degrees > MAX_BEND) return null;
        const next = bent(p, n, degrees, env);
        return next === p ? null : next;
    },
};

/**
 * The room the arc takes, as its width (side to side; up to a half turn, the distance between its
 * ends) or depth (from its ends' line to its far edge), in steps (owner on #634): typed, or dragged
 * sideways. Degrees change it as the arc grows round its circle. With the ratio lock on (flipped
 * by constrain while dragged) the other follows in proportion, on half steps.
 */
function guideParam(way: "width" | "depth"): ToolParam<LineParams> {
    const width = way === "width";
    const sizeOf = (p: LineParams) => {
        const f = arcFootprint(p);
        return f ? (width ? f.width : f.depth) : null;
    };
    /** The arc `size` across this way, the other kept or (`keep`) following in proportion */
    const sized = (
        p: LineParams,
        size: number,
        keep: boolean,
        env: ToolEnv,
    ): LineParams =>
        withFootprint(p, width, size, keep, env.snap ? env.stepPx : null);
    return {
        key: way,
        get label() {
            return width
                ? tolgee.t(
                      "shapes.kinds.arc.params.width",
                      "How far the arc reaches side to side, in steps",
                  )
                : tolgee.t(
                      "shapes.kinds.arc.params.depth",
                      "How deep the arc is, from its ends to its far edge, in steps",
                  );
        },
        unit: "steps",
        primary: true,
        drag: "x",
        interval: false,
        blends: true,
        range: { min: 0.5 },
        shown: (p) => arcGuide(p) !== null,
        // The lock sits after the depth, at the end of "60 × 30 steps"
        ratioLockAfter: !width,
        // One phrase for the room it takes: "60 × 30 steps"
        words: (): { before?: string; after?: string } =>
            width
                ? {}
                : {
                      before: "×",
                      after: tolgee.t("shapes.kinds.arc.size.steps", "steps"),
                  },
        display: (p, _n, stepPx) => {
            const size = sizeOf(p);
            return size === null ? "" : formatSteps(size / stepPx);
        },
        value: (p, _n, stepPx) => (sizeOf(p) ?? 0) / stepPx,
        type(p, n, text, env) {
            const steps = parseSteps(text);
            if (steps === null || !(steps > 0)) return null;
            return keptInterval(
                sized(p, steps * env.stepPx, env.ratioLocked === true, env),
                n,
                env,
            );
        },
        set: (p, n, steps, env) =>
            keptInterval(
                sized(p, steps * env.stepPx, env.ratioLocked === true, env),
                n,
                env,
            ),
        scrub(base, n, m, env) {
            const size = sizeOf(base);
            if (size === null) return base;
            const was = size / env.stepPx;
            const steps = scrubValue(
                was,
                scrubDistance("x", m.dx, m.dy),
                0,
                spacingRate(env.snap, "x"),
            );
            if (steps === was || steps < 0.5) return base;
            return keptInterval(
                // The editor's env holds the lock flipped by constrain already
                sized(
                    base,
                    steps * env.stepPx,
                    env.ratioLocked ?? m.roles.constrain,
                    env,
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

/** One of the Line's menus, as the Arc shares it */
const lineChoice = (key: string) =>
    lineTool.choices!.find((choice) => choice.key === key)!;

/**
 * The Line's Measured menu for the Arc (owner on #634): along the arc, straight from marcher to
 * marcher, or ↔ side to side, which puts each marcher a step count off a yard line (an arc bowing
 * front or back up to a half turn). No offset: that's a straight line's.
 */
const MEASURED: ToolChoice<LineParams> = (() => {
    const line = lineChoice("measured");
    return {
        ...line,
        options: (...args: Parameters<typeof line.options>) =>
            line.options(...args).filter((o) => o.value !== "offset"),
    };
})();

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
    choices: [ENDS, lineChoice("spacing"), MEASURED],
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
    // The whole circle the arc is part of, unless it already is one, with lines from its center
    // to the arc's ends so its angle reads (owner on #634)
    construction(params) {
        if (arcEnds(params) === "circle") return [];
        const g = arcGuide(params);
        return g
            ? [
                  {
                      center: g.center,
                      rx: g.rx,
                      ry: g.ry,
                      rotation: g.axis,
                      spokes: params.points.map(({ x, y }) => ({ x, y })),
                  },
              ]
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
