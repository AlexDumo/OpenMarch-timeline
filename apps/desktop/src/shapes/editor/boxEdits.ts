import {
    filesOf,
    keepRatio,
    ranksOf,
    snapInterval,
    snapToGrid,
    type BoxParams,
} from "../box/boxGeometry";
import { turnShape, flipShape } from "../frame/gestures";
import { boxTool } from "../box/boxTool";
import { DEGREE, type PivotKey } from "../frame/frame";
import type { ToolEnv } from "../tool/toolKind";
import {
    COUNT_RATE,
    SPACING_FINE_STEP,
    SPACING_RATE,
    scrubValue,
} from "./scrub";

/**
 * What the floating editor's numbers and buttons do to a box (08-shape-system-ux.md, "The floating
 * editor"). A size change keeps the spacing and the center; a spacing change keeps the count and
 * the center. Everything here is pure; `spots` is how many spots the box has (holes included).
 */

/** The box with `files` across (clamped to 1 to `spots`), its spacing and center kept */
export function withFiles(
    p: BoxParams,
    spots: number,
    files: number,
    env: ToolEnv,
): BoxParams {
    const clamped = Math.min(
        Math.max(1, spots),
        Math.max(1, Math.round(files)),
    );
    if (clamped === filesOf(p)) return p;
    return snapToGrid({ ...p, files: clamped }, spots, env);
}

/**
 * The box with `ranks` deep, as near as `spots` allows: the fewest across that fit in that many
 * ranks (13 in 2 deep is 7 across)
 */
export function withRanks(
    p: BoxParams,
    spots: number,
    ranks: number,
    env: ToolEnv,
): BoxParams {
    const n = Math.max(1, spots);
    const r = Math.min(n, Math.max(1, Math.round(ranks)));
    return withFiles(p, spots, Math.ceil(n / r), env);
}

/** The box with a spacing set, in steps. The ratio lock moves the other spacing with it. */
export function withSpacing(
    p: BoxParams,
    which: "across" | "deep",
    steps: number,
    spots: number,
    env: ToolEnv,
): BoxParams {
    const value = snapInterval(steps * env.stepPx, env);
    let across = which === "across" ? value : p.across;
    let deep = which === "deep" ? value : p.deep;
    if (env.ratioLocked)
        ({ across, deep } = keepRatio(
            p,
            across,
            deep,
            which === "across",
            which === "deep",
            env,
        ));
    if (across === p.across && deep === p.deep) return p;
    return snapToGrid({ ...p, across, deep }, spots, env);
}

/** A spacing dragged `dx`, `dy` px from the box at the press: ½ step per 8 px, Alt for tenths */
export function scrubSpacing(
    base: BoxParams,
    which: "across" | "deep",
    dx: number,
    dy: number,
    spots: number,
    env: ToolEnv,
): BoxParams {
    const steps = scrubValue(
        (which === "across" ? base.across : base.deep) / env.stepPx,
        dx,
        dy,
        {
            // Side to side drags sideways; front to back up and down
            axis: which === "across" ? "x" : "y",
            px: SPACING_RATE.px,
            step: env.snap ? SPACING_RATE.step : SPACING_FINE_STEP,
        },
    );
    const was = (which === "across" ? base.across : base.deep) / env.stepPx;
    // A drag that ends where it started changes nothing; it doesn't round the value
    if (steps === was) return base;
    return withSpacing(base, which, steps, spots, env);
}

/** The size dragged: sideways for more or fewer across, up or down for more or fewer deep */
export function scrubSize(
    base: BoxParams,
    axis: "x" | "y",
    dx: number,
    dy: number,
    spots: number,
    env: ToolEnv,
): BoxParams {
    if (axis === "x")
        return withFiles(
            base,
            spots,
            scrubValue(filesOf(base), dx, dy, { axis, ...COUNT_RATE }),
            env,
        );
    const ranks = ranksOf(base, spots);
    const target = scrubValue(ranks, dx, dy, { axis, ...COUNT_RATE });
    return target === ranks ? base : withRanks(base, spots, target, env);
}

/** The box turned by `degrees` (clockwise on the field) about the pivot */
export function turnBy(
    p: BoxParams,
    spots: number,
    degrees: number,
    pivot: PivotKey,
    env: ToolEnv,
): BoxParams {
    return turnShape(
        boxTool,
        p,
        spots,
        p.rotation + degrees * DEGREE,
        pivot,
        env,
    ) as BoxParams;
}

/** The box turned to `degrees` about the pivot */
export function turnTo(
    p: BoxParams,
    spots: number,
    degrees: number,
    pivot: PivotKey,
    env: ToolEnv,
): BoxParams {
    return turnShape(
        boxTool,
        p,
        spots,
        degrees * DEGREE,
        pivot,
        env,
    ) as BoxParams;
}

/** The box flipped side to side or front to back about the pivot */
export const flipBox = (
    p: BoxParams,
    spots: number,
    axis: "across" | "deep",
    pivot: PivotKey,
    env: ToolEnv,
): BoxParams => flipShape(boxTool, p, spots, axis, pivot, env) as BoxParams;
