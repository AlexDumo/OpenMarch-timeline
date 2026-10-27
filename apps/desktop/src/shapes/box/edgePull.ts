import type { FieldLines, ToolEnv } from "../tool/toolKind";
import type { XY } from "../types";

/**
 * The edge pull (#425, #446): while a box is drawn or a handle stretches it, a corner it moves
 * that comes within a few pixels of one of the field's lines lands on it, the spacing becoming
 * whatever that takes, at any turn. Worked out in the box's own axes, where the fixed corner or
 * side is `anchor` and the moving edges are unknowns: a field line is one straight equation in
 * them, as the box is turned. Square to the field (or turned a quarter) a corner on a line is the
 * side through it on the line, which is #425's rule.
 */

/** The field's lines and where a point in the box's own axes is on the field */
export interface BoxField {
    readonly lines: FieldLines;
    readonly toField: (p: XY) => XY;
}

/** One axis of the box's own: where its fixed edge is, and its edges or moving edge's count */
export type PullAxis =
    | {
          /** The edge the drag moves: from the fixed edge at `anchor` toward `to`, `count` files or ranks */
          readonly moves: true;
          readonly anchor: number;
          readonly to: number;
          readonly count: number;
          /** The interval the half-step ladder gives this axis, for a corner whose other axis is pulled */
          readonly ladder: number | undefined;
      }
    | {
          readonly moves: false;
          /** Both edges, which stay where they are */
          readonly edges: readonly [number, number];
      };

/** The intervals pulled onto lines, each axis on its own: undefined on an axis not pulled */
export interface Pulled {
    readonly x?: number;
    readonly y?: number;
}

/** Near enough to nothing, for a coefficient (a line the moving edge runs along) */
const EPS = 1e-9;

/** A field line a moving corner could land on: `a·ex + b·ey = c` in the moving edges */
interface Pull {
    readonly corner: number;
    readonly axis: "x" | "y";
    readonly a: number;
    readonly b: number;
    readonly c: number;
    /** How far the corner is from the line, as dragged, in field units */
    readonly d: number;
}

/**
 * The intervals that land the box's moving corners on the field's lines near where the drag
 * has them, for the axes that do. Near is within the pull radius on screen, never more than a
 * quarter of the moving edge's own half-step detent, so half steps win away from lines; only a
 * line beyond the fixed edge, at least a half step apart, counts. Each field axis takes the
 * nearest such line, a corner near a line each way landing on their crossing. Alt (no snap) and
 * Shift (equal spacings) don't pull.
 */
export function pullEdges(
    x: PullAxis,
    y: PullAxis,
    field: BoxField | undefined,
    env: ToolEnv,
): Pulled {
    if (!field || !env.snap || env.shift) return {};
    const half = env.stepPx / 2;
    const own = [x, y] as const;
    const gaps = own.map((a) => (a.moves ? a.count - 1 : 0));
    const sign = own.map((a) => (a.moves && a.to < a.anchor ? -1 : 1));
    if (own.every((a, i) => !a.moves || gaps[i]! < 1)) return {};
    // Where a point is on the field: o + px·u + py·v
    const o = field.toField({ x: 0, y: 0 });
    const ux = field.toField({ x: 1, y: 0 });
    const vy = field.toField({ x: 0, y: 1 });
    const u = { x: ux.x - o.x, y: ux.y - o.y };
    const v = { x: vy.x - o.x, y: vy.y - o.y };
    const radiusOf = (i: number) =>
        Math.min(env.pullRadius ?? 0, (gaps[i]! * half) / 4);
    /** Whether `e` puts axis `i`'s moving edge beyond its fixed edge, a half step or more apart */
    const fits = (i: number, e: number) => {
        const a = own[i]!;
        if (!a.moves || gaps[i]! < 1) return false;
        return (
            (e - a.anchor) * sign[i]! > 0 &&
            Math.abs(e - a.anchor) / gaps[i]! >= half - EPS
        );
    };
    // The box's corners: on each axis the fixed edge and the moving one (null), or both edges
    const sides = own.map((a) =>
        a.moves ? [a.anchor, null] : [a.edges[0], a.edges[1]],
    );
    const raw = own.map((a) => (a.moves ? a.to : 0));
    const pulls: Pull[] = [];
    let corner = 0;
    for (const cx of sides[0]!)
        for (const cy of sides[1]!) {
            corner++;
            if (cx !== null && cy !== null) continue;
            for (const axis of ["x", "y"] as const) {
                const a = cx === null ? u[axis] : 0;
                const b = cy === null ? v[axis] : 0;
                if (Math.abs(a) < EPS && Math.abs(b) < EPS) continue;
                const fixed =
                    o[axis] + (cx ?? 0) * u[axis] + (cy ?? 0) * v[axis];
                const at = a * raw[0]! + b * raw[1]! + fixed;
                const radius = Math.min(
                    Math.abs(a) >= EPS ? radiusOf(0) : Infinity,
                    Math.abs(b) >= EPS ? radiusOf(1) : Infinity,
                );
                for (const line of field.lines[axis]) {
                    const d = at - line;
                    if (Math.abs(d) > radius) continue;
                    const pull = { corner, axis, a, b, c: line - fixed, d };
                    // As dragged otherwise, the edge this line moves must still fit
                    const i = Math.abs(a) >= Math.abs(b) ? 0 : 1;
                    if (fits(i, solveOne(pull, i, raw[1 - i]!)))
                        pulls.push(pull);
                }
            }
        }
    if (pulls.length === 0) return {};
    const chosen = choose(pulls);
    const solved = solve(chosen, own, sign, gaps);
    if (!solved) return {};
    const out: { x?: number; y?: number } = {};
    for (const i of [0, 1] as const) {
        const e = solved[i];
        if (e === undefined) continue;
        if (!fits(i, e)) return {};
        const a = own[i]!;
        if (a.moves)
            out[i === 0 ? "x" : "y"] = Math.abs(e - a.anchor) / gaps[i]!;
    }
    return out;
}

/** `pull` solved for moving edge `i`, the other at `other` */
function solveOne(pull: Pull, i: number, other: number): number {
    return i === 0
        ? (pull.c - pull.b * other) / pull.a
        : (pull.c - pull.a * other) / pull.b;
}

/**
 * The nearest pull on each field axis; a corner with a pull each way wins both, the nearest such
 * corner first. Ties go to the earlier.
 */
function choose(pulls: readonly Pull[]): Pull[] {
    const nearest = (list: readonly Pull[]) =>
        list.reduce((a, b) => (Math.abs(b.d) < Math.abs(a.d) - EPS ? b : a));
    let crossing: [Pull, Pull] | null = null;
    for (const p of pulls) {
        if (p.axis !== "x") continue;
        const ys = pulls.filter((q) => q.axis === "y" && q.corner === p.corner);
        if (ys.length === 0) continue;
        const q = nearest(ys);
        if (
            crossing === null ||
            Math.hypot(p.d, q.d) <
                Math.hypot(crossing[0].d, crossing[1].d) - EPS
        )
            crossing = [p, q];
    }
    if (crossing) return crossing;
    const out: Pull[] = [];
    for (const axis of ["x", "y"] as const) {
        const list = pulls.filter((p) => p.axis === axis);
        if (list.length > 0) out.push(nearest(list));
    }
    return out;
}

/**
 * The moving edges `chosen` puts on their lines: both from two lines that fix them, else one
 * from the nearer line, the other edge on its half-step ladder. Undefined for an edge left as the
 * ladder has it; null when the lines can't be met.
 */
function solve(
    chosen: readonly Pull[],
    own: readonly [PullAxis, PullAxis],
    sign: readonly number[],
    gaps: readonly number[],
): [number | undefined, number | undefined] | null {
    const ladder = (i: number) => {
        const a = own[i]!;
        if (!a.moves) return 0;
        return a.ladder === undefined
            ? a.to
            : a.anchor + sign[i]! * gaps[i]! * a.ladder;
    };
    if (chosen.length === 2) {
        const [p, q] = chosen as [Pull, Pull];
        const det = p.a * q.b - p.b * q.a;
        if (Math.abs(det) > EPS)
            return [
                (p.c * q.b - p.b * q.c) / det,
                (p.a * q.c - p.c * q.a) / det,
            ];
    }
    const p = chosen.reduce((a, b) => (Math.abs(b.d) < Math.abs(a.d) ? b : a));
    // The edge this line moves most is the one it sets
    const i = Math.abs(p.a) >= Math.abs(p.b) ? 0 : 1;
    const e = solveOne(p, i, ladder(1 - i));
    if (!Number.isFinite(e)) return null;
    return i === 0 ? [e, undefined] : [undefined, e];
}
