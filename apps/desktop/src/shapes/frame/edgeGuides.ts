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
 * The guides while a stretch or a draw has a shape's edges on the field's lines (#425): a line
 * across the field along each line one of the outline's sides lies on, those sides (drawn thicker,
 * so a snapped edge is plain to see: owner on #427), and the spots standing on those lines. A side lies on a line when both its ends do, so a turned shape has none.
 */
export function edgeGuides(
    outline: readonly XY[] | null,
    spots: readonly XY[],
    lines: FieldLines | undefined,
    field: { readonly width: number; readonly height: number },
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
