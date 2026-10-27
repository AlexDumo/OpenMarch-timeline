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
 * The guides while a stretch, a draw or a move has a shape's edges on the field's lines (#425,
 * #444): a line across the field along each line one of the outline's sides lies on (or, for a
 * move, its center), those sides (drawn thicker, so a snapped edge is plain to see: owner on
 * #427), and the spots standing on those lines. A side lies on a line when both its ends do, so a
 * turned shape has none.
 */
export function edgeGuides(
    outline: readonly XY[] | null,
    spots: readonly XY[],
    lines: FieldLines | undefined,
    field: { readonly width: number; readonly height: number },
    /** A moved shape's center (#444): a guide along a line it's on, for a shape square to the field */
    center?: XY,
): { guides: EdgeGuide[]; edges: { from: XY; to: XY }[]; on: XY[] } {
    if (!outline || !lines || outline.length < 2)
        return { guides: [], edges: [], on: [] };
    const near = (v: number, line: number) => Math.abs(v - line) < ON_LINE;
    const xs = new Set<number>();
    const ys = new Set<number>();
    const edges: { from: XY; to: XY }[] = [];
    outline.forEach((a, i) => {
        const b = outline[(i + 1) % outline.length]!;
        let on = false;
        for (const line of lines.x)
            if (near(a.x, line) && near(b.x, line)) {
                xs.add(line);
                on = true;
            }
        for (const line of lines.y)
            if (near(a.y, line) && near(b.y, line)) {
                ys.add(line);
                on = true;
            }
        if (on) edges.push({ from: a, to: b });
    });
    if (center && squareSides(outline)) {
        for (const line of lines.x) if (near(center.x, line)) xs.add(line);
        for (const line of lines.y) if (near(center.y, line)) ys.add(line);
    }
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
    return { guides, edges, on };
}

/**
 * How far a moved shape shifts so its side or center line nearest one of the field's lines lands
 * on it (#444), x and y apart: null on an axis where nothing is within `radius`. Only a shape
 * whose sides all run along the field's axes (a box square to the field, or turned a quarter) is
 * pulled, by those sides and its center; a side wins over the center at the same distance.
 */
export function linePull(
    outline: readonly XY[],
    center: XY,
    lines: FieldLines,
    radius: number,
): { x: number | null; y: number | null } {
    const sides = squareSides(outline);
    if (!sides) return { x: null, y: null };
    const { xs, ys } = sides;
    const nearest = (values: number[], toward: readonly number[]) => {
        let best: number | null = null;
        for (const v of values)
            for (const line of toward) {
                const d = line - v;
                if (Math.abs(d) > radius) continue;
                if (best === null || Math.abs(d) < Math.abs(best) - ON_LINE)
                    best = d;
            }
        return best;
    };
    return {
        x: nearest([...xs, center.x], lines.x),
        y: nearest([...ys, center.y], lines.y),
    };
}

/**
 * Where the outline's sides run, when all of them run along the field's axes: x for a side front
 * to back, at its x. Null for a turned shape, or a curve.
 */
function squareSides(
    outline: readonly XY[],
): { xs: number[]; ys: number[] } | null {
    if (outline.length < 2) return null;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [i, a] of outline.entries()) {
        const b = outline[(i + 1) % outline.length]!;
        if (Math.abs(a.x - b.x) < ON_LINE) xs.push(a.x);
        else if (Math.abs(a.y - b.y) < ON_LINE) ys.push(a.y);
        else return null;
    }
    return { xs, ys };
}
