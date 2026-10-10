import type { Path } from "./geometry/path";
import { chordOffsets, gapsInSteps } from "./spacing";
import {
    followsInterval,
    type AnyShapeKind,
    type Measure,
    type ShapeContext,
    type Spacing,
    type XY,
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

/**
 * The point a "center" anchor keeps: halfway between an open path's ends (an arc's chord middle,
 * so it doesn't drift toward its bend), or the middle of a closed one
 */
function centerOf(path: Path, length: number): XY {
    if (path.closed) return path.at(length / 2);
    const a = path.at(0);
    const b = path.at(length);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * The gaps, in field units, a shape keeping its locked interval has to hold: n − 1 along an
 * open path, n around a closed one (the last gap closes the loop). Undefined when the shape
 * doesn't follow an interval.
 */
export function followGaps(
    kind: AnyShapeKind,
    params: unknown,
    n: number,
    ctx: ShapeContext,
): number[] | undefined {
    const spacing = (params as WithSpacing).spacing;
    if (!spacing || !followsInterval(spacing) || !kind.path) return undefined;
    const closed = kind.path(params).closed;
    return gapsInSteps(spacing.runs, closed ? n : n - 1).map(
        (g) => g * ctx.stepPx,
    );
}

/**
 * How much to scale `path` so `gaps`, measured straight between neighbors, take exactly its
 * length. Scaling the path by k is the same as laying the gaps scaled by 1/k on it, and the
 * distance the gaps reach along the path grows with them, so a bisection finds it.
 */
export function scaleToFit(path: Path, gaps: readonly number[]): number {
    const length = path.length;
    const total = gaps.reduce((sum, g) => sum + g, 0);
    if (length <= 1e-9 || total <= 1e-9) return 1;
    const reach = (t: number) =>
        chordOffsets(
            path,
            0,
            gaps.map((g) => g * t),
        ).at(-1)!;
    // How far the gaps reach grows almost in proportion to their size, so rescaling by the
    // shortfall converges in a few rounds (at once on a straight path)
    let t = length / total;
    for (let i = 0; i < 12; i++) {
        const r = reach(t);
        if (Math.abs(r - length) <= length * 1e-10) break;
        t *= length / r;
    }
    return 1 / t;
}

/** `params` resized to keep its locked interval; unchanged in any other state */
export function settle(
    kind: AnyShapeKind,
    params: unknown,
    n: number,
    ctx: ShapeContext,
    dragged?: string,
): unknown {
    const spacing = (params as WithSpacing).spacing;
    if (kind.keepsPath && spacing && followsInterval(spacing)) {
        // This kind keeps its drawn path: the locked interval is laid along it
        return { ...(params as object), spacing: { ...spacing, size: "keep" } };
    }
    const gaps = followGaps(kind, params, n, ctx);
    if (!gaps || !kind.path) return params;
    const handle = dragged
        ? kind.handles(params, n, ctx).find((h) => h.key === dragged)
        : undefined;
    const floated = kind.float?.(params, gaps, ctx, handle);
    if (floated !== undefined) return floated;
    if (!kind.scale) return params;
    const path = kind.path(params);
    const current = path.length;
    const k = scaleToFit(path, gaps);
    if (current <= 1e-9 || Math.abs(k - 1) < 1e-12) return params;
    const anchor = (params as WithSpacing).spacing;
    const pivot = handle?.start
        ? path.at(current)
        : handle?.end
          ? path.at(0)
          : anchor?.mode === "interval" && anchor.anchor === "end"
            ? path.at(current)
            : anchor?.mode === "interval" && anchor.anchor === "center"
              ? centerOf(path, current)
              : path.at(0);
    return kind.scale(params, pivot, k);
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
