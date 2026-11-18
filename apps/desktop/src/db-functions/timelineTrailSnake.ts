/**
 * Snaking through a box, pathways step 11 (spec Appendix L.12, SN-1 to SN-6): where marchers
 * stand in a box (a grid of rows and columns, square or turned, holes allowed), and the snake
 * order through it from a corner, row by row or column by column. Pure.
 *
 * A box with no remembered order gets this snake as its default (SN-2): the Follow tool's drag out
 * of a corner (step 4b) and Ripple in's deal into a box (step 9) both run along it. Row ends cut
 * straight across to the first spot of the next row (SN-3): the snake is only an order, and the
 * line-up and R-13′'s destination path are the chords through it, as for any line.
 */
import { EPS_GEOM, type XY } from "@openmarch/core";

/** Which way the snake runs (SN-2): along each row first (the default), or along each column */
export type SnakeBy = "rows" | "columns";

/**
 * A box's cells: `cells[r][c]` is who stands in row `r`, column `c` (an index into the points the
 * box was read from, or an id once mapped), null for a hole. Rows run top to bottom and columns
 * left to right as the field is shown; rows are the box's side nearer the field's side to side.
 */
export type BoxCells = readonly (readonly (number | null)[])[];

/** The true median: the middle value, or the mean of the two middle ones */
const median = (xs: readonly number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const k = s.length >> 1;
    if (s.length === 0) return 0;
    return s.length % 2 ? s[k]! : (s[k - 1]! + s[k]!) / 2;
};

/** The groups `values` fall into, each a run of sorted values no more than `tol` apart */
function clusters(values: readonly number[], tol: number): number[][] {
    const order = values
        .map((_, i) => i)
        .sort((a, b) => values[a]! - values[b]!);
    const groups: number[][] = [];
    let last = -Infinity;
    for (const i of order) {
        if (values[i]! - last > tol) groups.push([]);
        groups.at(-1)!.push(i);
        last = values[i]!;
    }
    return groups;
}

/** The gaps between the groups' centers, in order, and whether they are even (within a quarter) */
function evenSteps(centers: readonly number[]): boolean {
    const steps = centers.slice(1).map((c, i) => c - centers[i]!);
    const usual = median(steps);
    return steps.every((d) => Math.abs(d - usual) <= usual / 4);
}

/** The share of a box's cells that may be holes and it still read as a box */
export const BOX_HOLES = 1 / 4;

/**
 * The box `points` stand in (SN-1), or null: two or more rows and two or more columns, square to
 * each other (turned any way), evenly spaced each way (within a quarter), every point within a
 * quarter of the usual spacing of its row and its column, one to a cell, and no more than
 * {@link BOX_HOLES} of the cells empty. A line, an arc, a curve or a scatter isn't one.
 */
export function boxCellsOf(points: readonly XY[]): BoxCells | null {
    const n = points.length;
    if (n < 4) return null;
    const gaps = points.map((p, i) =>
        Math.min(
            ...points.map((q, j) =>
                i === j ? Infinity : Math.hypot(p[0] - q[0], p[1] - q[1]),
            ),
        ),
    );
    const usual = median(gaps);
    if (!(usual > EPS_GEOM)) return null;
    const tol = usual / 4;
    // The box's turn: each point's way to its nearest neighbor, folded to a quarter turn
    let sx = 0;
    let sy = 0;
    points.forEach((p, i) => {
        let best: XY | null = null;
        let d = Infinity;
        points.forEach((q, j) => {
            const e = Math.hypot(p[0] - q[0], p[1] - q[1]);
            if (i !== j && e < d) {
                d = e;
                best = q;
            }
        });
        if (!best) return;
        const a = Math.atan2(best[1] - p[1], best[0] - p[0]);
        sx += Math.cos(4 * a);
        sy += Math.sin(4 * a);
    });
    if (Math.hypot(sx, sy) < 1e-9 * n) return null;
    // Within ±45° of the field's side to side: that way is a row
    const turn = Math.atan2(sy, sx) / 4;
    const ux = Math.cos(turn);
    const uy = Math.sin(turn);
    const along = points.map(([x, y]) => x * ux + y * uy);
    const across = points.map(([x, y]) => -x * uy + y * ux);
    const cols = clusters(along, tol);
    const rows = clusters(across, tol);
    if (rows.length < 2 || cols.length < 2) return null;
    const center = (vals: readonly number[], g: readonly number[]) =>
        g.reduce((s, i) => s + vals[i]!, 0) / g.length;
    const colAt = cols.map((g) => center(along, g));
    const rowAt = rows.map((g) => center(across, g));
    if (!evenSteps(colAt) || !evenSteps(rowAt)) return null;
    const near = (vals: readonly number[], g: readonly number[], c: number) =>
        g.every((i) => Math.abs(vals[i]! - c) <= tol);
    if (!cols.every((g, k) => near(along, g, colAt[k]!))) return null;
    if (!rows.every((g, k) => near(across, g, rowAt[k]!))) return null;
    const holes = rows.length * cols.length - n;
    if (holes > BOX_HOLES * rows.length * cols.length) return null;
    const cells: (number | null)[][] = rows.map(() => cols.map(() => null));
    const colOf = new Map<number, number>();
    cols.forEach((g, k) => g.forEach((i) => colOf.set(i, k)));
    for (const [r, g] of rows.entries())
        for (const i of g) {
            const c = colOf.get(i)!;
            if (cells[r]![c] !== null) return null;
            cells[r]![c] = i;
        }
    return cells;
}

/** `cells` with each member renamed by `name` (indexes to ids, say) */
export const mapCells = (
    cells: BoxCells,
    name: (i: number) => number,
): BoxCells =>
    cells.map((row) => row.map((i) => (i === null ? null : name(i))));

/** A corner of the box: `top` and `left` as the field is shown */
interface Corner {
    readonly top: boolean;
    readonly left: boolean;
}

const CORNERS: readonly Corner[] = [
    { top: true, left: true },
    { top: true, left: false },
    { top: false, left: true },
    { top: false, left: false },
];

/** The snake from `corner` (SN-2): its row (or column) first, then each next one back the other way */
function snakeFromCorner(
    cells: BoxCells,
    by: SnakeBy,
    corner: Corner,
): number[] {
    const R = cells.length;
    const C = cells[0]?.length ?? 0;
    const outer = by === "rows" ? R : C;
    const inner = by === "rows" ? C : R;
    const order: number[] = [];
    for (let k = 0; k < outer; k++) {
        const o = (by === "rows" ? corner.top : corner.left)
            ? k
            : outer - 1 - k;
        const forward =
            (by === "rows" ? corner.left : corner.top) === (k % 2 === 0);
        for (let j = 0; j < inner; j++) {
            const i = forward ? j : inner - 1 - j;
            const who = by === "rows" ? cells[o]![i] : cells[i]![o];
            if (who !== null && who !== undefined) order.push(who);
        }
    }
    return order;
}

/**
 * The snakes through the box (SN-2), one from each corner, the corner's member first: the top
 * left, the top right, the bottom left, the bottom right. A corner that is a hole starts at the
 * first member its snake meets. Two corners that start with the same member keep the first.
 */
export function snakeOrders(cells: BoxCells, by: SnakeBy): number[][] {
    const orders: number[][] = [];
    for (const corner of CORNERS) {
        const order = snakeFromCorner(cells, by, corner);
        if (order.length && !orders.some((o) => o[0] === order[0]))
            orders.push(order);
    }
    return orders;
}

/** Who a drag out of the box can start from (SN-2): the member each corner's snake starts with */
export const snakeEnds = (cells: BoxCells, by: SnakeBy): number[] =>
    snakeOrders(cells, by).map((o) => o[0]!);

/**
 * The snake through the box that starts with `first` (a corner's member, SN-2), `first` leading;
 * null when `first` starts none
 */
export const snakeFrom = (
    cells: BoxCells,
    by: SnakeBy,
    first: number,
): number[] | null =>
    snakeOrders(cells, by).find((o) => o[0] === first) ?? null;

/**
 * The corner's member nearest `at` (SN-4: where a connector arrives at a box), the first corner
 * on a tie, with where it stands
 */
export function nearestSnakeEnd(
    cells: BoxCells,
    by: SnakeBy,
    spotOf: (who: number) => XY,
    at: XY,
): number {
    let best: { who: number; d: number } | null = null;
    for (const who of snakeEnds(cells, by)) {
        const p = spotOf(who);
        const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
        if (!best || d < best.d - 1e-9) best = { who, d };
    }
    return best!.who;
}
