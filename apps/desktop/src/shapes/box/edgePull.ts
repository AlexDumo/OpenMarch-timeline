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
    /** The moving edge this line sets: the one it moves most */
    readonly i: number;
    /** How far that edge travels to put the corner on the line, as dragged, in field units */
    readonly travel: number;
}

/**
 * The intervals that land the box's moving corners on the field's lines near where the drag
 * has them, for the axes that do. Near is the moving edge traveling no farther than the pull
 * radius on screen, never more than a quarter of its own half-step detent, so half steps win away
 * from lines at any turn (measured on the edge, not the corner: a line the edge runs nearly along
 * would fling it); only a
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
    /** Where axis `i`'s moving edge is on its half-step ladder, or as dragged with no ladder */
    const ladder = (i: number) => {
        const a = own[i]!;
        if (!a.moves) return 0;
        return a.ladder === undefined
            ? a.to
            : a.anchor + sign[i]! * gaps[i]! * a.ladder;
    };
    /**
     * Whether edges `e` land within reach: each moved edge travels no farther than its own pull
     * radius from where the drag has it (a line the edge runs nearly along would otherwise fling
     * it, review of #448) and still fits
     */
    const reaches = (e: readonly (number | undefined)[]) =>
        e.every(
            (v, i) =>
                v === undefined ||
                (Number.isFinite(v) &&
                    Math.abs(v - raw[i]!) <= radiusOf(i) + EPS &&
                    fits(i, v)),
        );
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
                // The edge this line moves most is the one it sets
                const i = Math.abs(a) >= Math.abs(b) ? 0 : 1;
                for (const line of field.lines[axis]) {
                    const pull = {
                        corner,
                        axis,
                        a,
                        b,
                        c: line - fixed,
                        i,
                        travel: 0,
                    };
                    // How far the edge travels to put the corner on the line, the other as dragged
                    const e = solveOne(pull, i, raw[1 - i]!);
                    const travel = Math.abs(e - raw[i]!);
                    if (travel <= radiusOf(i) + EPS && fits(i, e))
                        pulls.push({ ...pull, travel });
                }
            }
        }
    if (pulls.length === 0) return {};
    const chosen = choose(pulls);
    const options: (number | undefined)[][] = [];
    if (chosen.length === 2) {
        const [p, q] = chosen as [Pull, Pull];
        const det = p.a * q.b - p.b * q.a;
        if (Math.abs(det) > EPS)
            options.push([
                (p.c * q.b - p.b * q.c) / det,
                (p.a * q.c - p.c * q.a) / det,
            ]);
    }
    // One line: the nearest, the other edge back on its ladder, and checked with it there
    const p = chosen.reduce((a, b) => (b.travel < a.travel ? b : a));
    const one = solveOne(p, p.i, ladder(1 - p.i));
    options.push(p.i === 0 ? [one, undefined] : [undefined, one]);
    const solved = options.find(reaches);
    if (!solved) return {};
    const out: { x?: number; y?: number } = {};
    for (const i of [0, 1] as const) {
        const e = solved[i];
        const a = own[i]!;
        if (e !== undefined && a.moves)
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
 * The nearest pull on each field axis, by how far its edge travels; a corner with a pull each way
 * wins both, the nearest such corner first. Ties go to the earlier.
 */
function choose(pulls: readonly Pull[]): Pull[] {
    const nearest = (list: readonly Pull[]) =>
        list.reduce((a, b) => (b.travel < a.travel - EPS ? b : a));
    let crossing: [Pull, Pull] | null = null;
    for (const p of pulls) {
        if (p.axis !== "x") continue;
        const ys = pulls.filter((q) => q.axis === "y" && q.corner === p.corner);
        if (ys.length === 0) continue;
        const q = nearest(ys);
        if (
            crossing === null ||
            Math.hypot(p.travel, q.travel) <
                Math.hypot(crossing[0].travel, crossing[1].travel) - EPS
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
