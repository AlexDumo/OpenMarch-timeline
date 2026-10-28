import tolgee from "@/global/singletons/Tolgee";
import { formatSteps } from "../editor/format";
import type { AnyToolKind, ToolEnv } from "../tool/toolKind";
import { pivotPoint, samePivot, type Pivot } from "./frame";
import { settled } from "./gestures";
import { carryPivot, pivotOf } from "./pivot";

/**
 * Scaling a shape (spec #344, #349): by interval, in half steps, never by a percentage, because
 * drill is written in intervals. A kind says which it does (`ToolKind.scaling`):
 *
 * - `interval`: every spacing it shows changes by half a step (each gap of a gap list too);
 * - `footprint` (no regular spacing, such as a natural fill): its size changes by half a step
 *   each way.
 *
 * Either way the pivot stays put. Everything here is pure, and nothing knows the kind.
 */

/** How much one − or + changes a spacing or a footprint, in steps */
export const SCALE_STEP = 0.5;

/**
 * The shape one − (`by` -1) or + (1) scales to, around `pivot`; null where it can't go that way
 * (a spacing already half a step, a kind with nothing to scale)
 */
export function scaleShape(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    by: -1 | 1,
    pivot: Pivot,
    env: ToolEnv,
): unknown {
    // Every spacing changes by the same half step: the lock that keeps their ratio would not
    const plain: ToolEnv = { ...env, snap: true, ratioLocked: false, pivot };
    const scaled =
        kind.scaling === "interval"
            ? widened(kind, params, n, by * SCALE_STEP, plain)
            : grown(kind, params, n, by * SCALE_STEP, plain);
    if (scaled === null) return null;
    const anchored = keepPivot(
        kind,
        params,
        carryPivot(params, scaled),
        n,
        pivot,
    );
    const around = samePivot(pivotOf(params), pivot)
        ? pivotPoint(kind.frameOf(params, n), pivot)
        : null;
    return settled(kind, anchored, n, plain, around);
}

/** Each interval the shape shows, `by` steps wider; null when one can't go there */
function widened(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    by: number,
    env: ToolEnv,
): unknown {
    const intervals = kind.params.filter(
        (p) => p.interval && p.widen && (p.shown?.(params, n) ?? true),
    );
    if (intervals.length === 0) return null;
    let next = params;
    for (const param of intervals) {
        const wider = param.widen!(next, n, by, env);
        if (wider === null) return null;
        next = wider;
    }
    return next === params ? null : next;
}

/** The footprint `by` steps wider and deeper (a line stays a line); null under half a step */
function grown(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    by: number,
    env: ToolEnv,
): unknown {
    if (!kind.withSize) return null;
    const frame = kind.frameOf(params, n);
    const half = (by * env.stepPx) / 2;
    const min = (SCALE_STEP * env.stepPx) / 2;
    const halfWidth = frame.halfWidth > 0 ? frame.halfWidth + half : 0;
    const halfDepth = frame.halfDepth > 0 ? frame.halfDepth + half : 0;
    if (halfWidth === 0 && halfDepth === 0) return null;
    if (
        (frame.halfWidth > 0 && halfWidth < min - 1e-9) ||
        (frame.halfDepth > 0 && halfDepth < min - 1e-9)
    )
        return null;
    return kind.withSize(params, n, { halfWidth, halfDepth }, env);
}

/** `after` moved so `pivot` is where it was on `before` */
function keepPivot(
    kind: AnyToolKind,
    before: unknown,
    after: unknown,
    n: number,
    pivot: Pivot,
): unknown {
    const was = pivotPoint(kind.frameOf(before, n), pivot);
    const frame = kind.frameOf(after, n);
    const now = pivotPoint(frame, pivot);
    if (Math.abs(was.x - now.x) < 1e-9 && Math.abs(was.y - now.y) < 1e-9)
        return after;
    return carryPivot(
        after,
        kind.withFrame(after, n, {
            ...frame,
            center: {
                x: frame.center.x + was.x - now.x,
                y: frame.center.y + was.y - now.y,
            },
        }),
    );
}

/**
 * What the Transform section's scale shows between − and +: the spacings for an interval kind
 * ("↔ 2 ↕ 2 apart", as the chip marks them), the size for a footprint kind ("10 × 4 steps")
 */
export function scaleReadout(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    env: ToolEnv,
): string {
    if (kind.scaling === "footprint") return sizeText(kind, params, n, env);
    const shown = kind.params
        .filter((p) => p.interval && (p.shown?.(params, n) ?? true))
        .map((p) =>
            [p.glyph, p.display(params, n, env.stepPx)]
                .filter(Boolean)
                .join(" "),
        );
    return shown.length > 0
        ? tolgee.t("shapes.frame.scale.apart", "{spacings} apart", {
              spacings: shown.join(" "),
          })
        : "";
}

/** The shape's length and depth through its frame: "14 × 6 steps", or "14 steps" for a line */
function sizeText(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    env: Pick<ToolEnv, "stepPx">,
): string {
    const frame = kind.frameOf(params, n);
    const sizes = [frame.halfWidth, frame.halfDepth]
        .filter((h) => h > 1e-9)
        .map((h) => formatSteps((2 * h) / env.stepPx));
    return sizes.length > 0
        ? tolgee.t("shapes.frame.scale.size", "{sizes} steps", {
              sizes: sizes.join(" × "),
          })
        : "";
}

/**
 * The readout by the pointer while a handle is dragged (#349): how long the shape is and, for an
 * interval kind, its spacings, so a long shape shows where the next half step lands
 */
export function lengthReadout(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    env: ToolEnv,
): string {
    const size = sizeText(kind, params, n, env);
    const spacing =
        kind.scaling === "interval" ? scaleReadout(kind, params, n, env) : "";
    return [size, spacing].filter(Boolean).join(" · ");
}
