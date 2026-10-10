import { requiredLength } from "./spacing";
import {
    followsInterval,
    type AnyShapeKind,
    type Measure,
    type ShapeContext,
    type Spacing,
} from "./types";

/**
 * Keeping a locked interval (docs/timeline/research/shapes/05-interval-modes.md §3.2).
 *
 * With the interval locked and the size free, the shape is resized after every edit so its path
 * is exactly as long as the run. A path's length scales with a uniform scale, so one scale about
 * a pivot does it for every path kind:
 * - after dragging an end handle, the other end stays put and the dragged end aims at the cursor;
 * - after anything else, the anchor point (start, middle or end) stays put.
 * Kinds where that is the wrong feel override it with `float` (a circle keeps its center).
 */

type WithSpacing = { readonly spacing?: Spacing };

/** The run length `n` marchers need, or undefined when the shape doesn't follow an interval */
export function followLength(
    kind: AnyShapeKind,
    params: unknown,
    n: number,
    ctx: ShapeContext,
): number | undefined {
    const spacing = (params as WithSpacing).spacing;
    if (!spacing || !followsInterval(spacing) || !kind.path) return undefined;
    return requiredLength(
        spacing.runs,
        n,
        kind.path(params).closed,
        ctx.stepPx,
    );
}

/** `params` resized to keep its locked interval; unchanged in any other state */
export function settle(
    kind: AnyShapeKind,
    params: unknown,
    n: number,
    ctx: ShapeContext,
    dragged?: string,
): unknown {
    const length = followLength(kind, params, n, ctx);
    if (length === undefined || !kind.path) return params;
    if (kind.float) return kind.float(params, length, ctx, dragged);
    if (!kind.scale) return params;
    const path = kind.path(params);
    const current = path.length;
    if (current <= 1e-9 || Math.abs(current - length) < 1e-9) return params;
    const handle = dragged
        ? kind.handles(params, n, ctx).find((h) => h.key === dragged)
        : undefined;
    const anchor = (params as WithSpacing).spacing;
    const pivot = handle?.start
        ? path.at(current)
        : handle?.end
          ? path.at(0)
          : anchor?.mode === "interval" && anchor.anchor === "end"
            ? path.at(current)
            : anchor?.mode === "interval" && anchor.anchor === "center"
              ? path.at(current / 2)
              : path.at(0);
    return kind.scale(params, pivot, length / current);
}

/**
 * A Length measure for path kinds that can scale and declare no size of their own: the path's
 * length, typed by scaling the shape about its start.
 */
function genericLength(kind: AnyShapeKind): Measure<unknown> | undefined {
    const { path, scale } = kind;
    if (!path || !scale) return undefined;
    return {
        key: "length",
        label: "Length",
        unit: "length",
        min: 0.25,
        size: true,
        get: (p) => path(p).length,
        set: (p, value) => {
            const current = path(p);
            if (current.length <= 1e-9) return p;
            return scale(p, current.at(0), value / current.length);
        },
    };
}

/** The measures the panel shows for a kind: its own, plus a generic Length when it has no size */
export function measuresOf(kind: AnyShapeKind): Measure<unknown>[] {
    const own = (kind.measures ?? []) as Measure<unknown>[];
    if (own.some((m) => m.size)) return own;
    const length = genericLength(kind);
    return length ? [length, ...own] : own;
}
