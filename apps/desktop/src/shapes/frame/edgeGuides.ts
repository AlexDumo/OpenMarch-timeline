import type { FieldLines } from "../tool/toolKind";
import type { XY } from "../types";

/** A guide along one of the field's lines: x for a line side to side, at that x */
export interface EdgeGuide {
    readonly axis: "x" | "y";
    readonly at: number;
    readonly from: XY;
    readonly to: XY;
}

/** How near a field line an edge must be to be on it, in field units */
const ON_LINE = 1e-3;

/**
 * The guides while a stretch, a draw or a move has a shape's snap points on the field's lines
 * (#425, #444, #446): a line across the field along each line one of `points` (the shape's
 * corners, and its center while it's moved) lies on; the outline's sides lying whole on such a
 * line (drawn thicker, so a snapped edge is plain to see: owner on #427); the points on a line
 * that aren't on a thick side (a turned box's corner, a center: ringed instead, #446); and the
 * spots standing on those lines.
 */
export function edgeGuides(
    outline: readonly XY[] | null,
    points: readonly XY[],
    spots: readonly XY[],
    lines: FieldLines | undefined,
    field: { readonly width: number; readonly height: number },
): {
    guides: EdgeGuide[];
    edges: { from: XY; to: XY }[];
    marks: XY[];
    on: XY[];
} {
    const none = { guides: [], edges: [], marks: [], on: [] };
    if (!lines || points.length === 0) return none;
    const near = (v: number, line: number) => Math.abs(v - line) < ON_LINE;
    const onX = (p: XY) => lines.x.find((line) => near(p.x, line));
    const onY = (p: XY) => lines.y.find((line) => near(p.y, line));
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (const p of points) {
        const x = onX(p);
        const y = onY(p);
        if (x !== undefined) xs.add(x);
        if (y !== undefined) ys.add(y);
    }
    if (xs.size === 0 && ys.size === 0) return none;
    const edges: { from: XY; to: XY }[] = [];
    const ring = outline ?? [];
    const same = (a: number | undefined, b: number | undefined) =>
        a !== undefined && a === b;
    if (ring.length >= 2)
        ring.forEach((a, i) => {
            const b = ring[(i + 1) % ring.length]!;
            if (same(onX(a), onX(b)) || same(onY(a), onY(b)))
                edges.push({ from: a, to: b });
        });
    const onEdge = (p: XY) =>
        edges.some(
            (e) =>
                Math.hypot(e.from.x - p.x, e.from.y - p.y) < ON_LINE ||
                Math.hypot(e.to.x - p.x, e.to.y - p.y) < ON_LINE,
        );
    const marks = points.filter(
        (p) => (onX(p) !== undefined || onY(p) !== undefined) && !onEdge(p),
    );
    const byValue = (a: number, b: number) => a - b;
    const guides = [
        ...[...xs].sort(byValue).map((x) => ({
            axis: "x" as const,
            at: x,
            from: { x, y: 0 },
            to: { x, y: field.height },
        })),
        ...[...ys].sort(byValue).map((y) => ({
            axis: "y" as const,
            at: y,
            from: { x: 0, y },
            to: { x: field.width, y },
        })),
    ];
    const on = spots.filter(
        (p) =>
            [...xs].some((x) => near(p.x, x)) ||
            [...ys].some((y) => near(p.y, y)),
    );
    return { guides, edges, marks, on };
}

/**
 * How far a moved shape shifts so its snap point nearest one of the field's lines lands on it
 * (#444, #446), x and y apart: null on an axis where nothing is within `radius`. A point within
 * reach of a line each way lands on their crossing, the nearest such point winning; otherwise
 * each axis takes its nearest point, an earlier point winning a tie (a corner over the center).
 * For a box square to the field a corner on a line is a side on it, so this is #444's side rule.
 */
export function linePull(
    points: readonly XY[],
    lines: FieldLines,
    radius: number,
): { x: number | null; y: number | null } {
    const nearest = (v: number, toward: readonly number[]) => {
        let best: number | null = null;
        for (const line of toward) {
            const d = line - v;
            if (Math.abs(d) > radius) continue;
            if (best === null || Math.abs(d) < Math.abs(best) - ON_LINE)
                best = d;
        }
        return best;
    };
    const each = points.map((p) => ({
        x: nearest(p.x, lines.x),
        y: nearest(p.y, lines.y),
    }));
    let crossing: { x: number; y: number } | null = null;
    for (const d of each)
        if (
            d.x !== null &&
            d.y !== null &&
            (crossing === null ||
                Math.hypot(d.x, d.y) <
                    Math.hypot(crossing.x, crossing.y) - ON_LINE)
        )
            crossing = { x: d.x, y: d.y };
    if (crossing) return crossing;
    const best = (axis: "x" | "y") => {
        let out: number | null = null;
        for (const d of each) {
            const v = d[axis];
            if (
                v !== null &&
                (out === null || Math.abs(v) < Math.abs(out) - ON_LINE)
            )
                out = v;
        }
        return out;
    };
    return { x: best("x"), y: best("y") };
}
