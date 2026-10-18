import {
    filesOf,
    keepRatio,
    ranksOf,
    snapInterval,
    grownFromPivot,
    resizeFiles,
    acrossIsDeep,
    onField,
    type BoxParams,
} from "../box/boxGeometry";
import { turnShape, flipShape } from "../frame/gestures";
import { boxTool } from "../box/boxTool";
import { DEGREE, rotationDegrees, type PivotKey } from "../frame/frame";

import type { ToolEnv } from "../tool/toolKind";
import {
    COUNT_RATE,
    SPACING_FINE_STEP,
    SPACING_RATE,
    scrubValue,
} from "./scrub";

/**
 * What the floating editor's numbers and buttons do to a box (08-shape-system-ux.md, "The floating
 * editor"). A size change keeps the spacing, a spacing change keeps the count, and both grow from
 * the pivot (back-left by default). Everything here is pure; `spots` is how many spots the box has (holes included).
 */

/** The box with `files` across (clamped to 1 to `spots`), its spacing and center kept */
export function withFiles(
    p: BoxParams,
    spots: number,
    files: number,
    env: ToolEnv,
): BoxParams {
    return resizeFiles(p, spots, files, env);
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
    const now = ranksOf(p, spots);
    const want = Math.min(n, Math.max(1, Math.round(ranks)));
    if (want === now) return p;
    // Not every count deep fits: 64 in 9 ranks is still 8 across. Go on until the count changes.
    const step = want > now ? 1 : -1;
    for (let r = want; r >= 1 && r <= n; r += step) {
        const files = Math.ceil(n / r);
        if (files !== filesOf(p)) return withFiles(p, spots, files, env);
    }
    return p;
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
    return grownFromPivot(p, { ...p, across, deep }, spots, env);
}

/** The box with `count` across (or deep) on the field */
export function withFieldCount(
    p: BoxParams,
    spots: number,
    axis: "across" | "deep",
    count: number,
    env: ToolEnv,
): BoxParams {
    const ownFiles = (axis === "across") !== acrossIsDeep(p.rotation);
    return ownFiles
        ? withFiles(p, spots, count, env)
        : withRanks(p, spots, count, env);
}

/**
 * A spacing (the box's own `which`) dragged `distance` px for more: ½ step per 8 px, tenths with
 * Alt, from where it started
 */
export function scrubSpacing(
    base: BoxParams,
    which: "across" | "deep",
    distance: number,
    spots: number,
    env: ToolEnv,
): BoxParams {
    const was = (which === "across" ? base.across : base.deep) / env.stepPx;
    const steps = scrubValue(was, distance, 0, {
        axis: "x",
        px: SPACING_RATE.px,
        step: env.snap ? SPACING_RATE.step : SPACING_FINE_STEP,
    });
    // A drag that ends where it started changes nothing; it doesn't round the value
    if (steps === was) return base;
    return withSpacing(base, which, steps, spots, env);
}

/** The count across (or deep) on the field dragged `distance` px for more: one per 16 px */
export function scrubSize(
    base: BoxParams,
    axis: "across" | "deep",
    distance: number,
    spots: number,
    env: ToolEnv,
): BoxParams {
    const field = onField(base, spots);
    const was = axis === "across" ? field.across : field.deep;
    const count = scrubValue(was, distance, 0, { axis: "x", ...COUNT_RATE });
    return count === was ? base : withFieldCount(base, spots, axis, count, env);
}

/** The rotation dragged `distance` px clockwise: 1° per 2 px, 15° with Shift, free with Alt */
export function scrubRotation(
    base: BoxParams,
    distance: number,
    spots: number,
    pivot: PivotKey,
    env: ToolEnv,
): BoxParams {
    const turn = distance / ROTATION_PX_PER_DEGREE;
    if (Math.trunc(turn) === 0 && env.snap) return base;
    const degrees = rotationDegrees(base.rotation) + turn;
    const snapped = !env.snap
        ? degrees
        : env.shift
          ? Math.round(degrees / 15) * 15
          : Math.round(degrees);
    return turnTo(base, spots, snapped, pivot, env);
}

/** Pixels of drag per degree on the rotation number */
export const ROTATION_PX_PER_DEGREE = 2;

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

export { acrossIsDeep, onField };
