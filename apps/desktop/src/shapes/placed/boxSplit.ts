import type { ShapeRecipeMember } from "@/db-functions/shapeRecipes";
import {
    boxDistribution,
    withFileCount,
    type BoxParams,
} from "../box/boxGeometry";
import type { ShapeContext, XY } from "../types";
import type { PlacedBox } from "./placedBox";

/**
 * **Split here** on a placed Box (#1337, epic #1335): a straight cut between two files or two
 * ranks makes two boxes, each keeping the box's fill and settings, nobody moving (owner,
 * 2026-11-26). A cut is offered only where each piece, laid out as a box of its own, puts its
 * spots exactly where the marchers stand: a short rank that would land elsewhere in a piece, or a
 * stagger, refuses it. Everything here is pure.
 */

/**
 * A straight cut through a box, in its own axes as turned (flips included): across it between two
 * files (`x`), or side to side between two ranks (`y`), at `at` from its center
 */
export interface BoxCut {
    readonly kind: "box";
    readonly way: "x" | "y";
    readonly at: number;
}

/** One side of a cut: the box it makes (none for a single spot) and its members on it */
export interface BoxPiece {
    readonly params: BoxParams | null;
    readonly spots: number;
    readonly members: readonly ShapeRecipeMember[];
}

/** How far apart two spots may be and count as the same, in field units (`ON_SPOT`) */
const SAME = 0.01;

/** A box's spots never read the context: the distributor lays them out from the params alone */
const NO_CONTEXT: ShapeContext = { stepPx: 1, snapPoint: (p) => p };

/** Field point `f` in `p`'s own axes as turned, from its center (its flips left in) */
export function toBoxAxes(p: BoxParams, f: XY): XY {
    const c = Math.cos(p.rotation);
    const s = Math.sin(p.rotation);
    const d = { x: f.x - p.center.x, y: f.y - p.center.y };
    return { x: c * d.x + s * d.y, y: -s * d.x + c * d.y };
}

/** `d`, in `p`'s own axes as turned, on the field */
export function fromBoxAxes(p: BoxParams, d: XY): XY {
    const c = Math.cos(p.rotation);
    const s = Math.sin(p.rotation);
    return {
        x: p.center.x + c * d.x - s * d.y,
        y: p.center.y + s * d.x + c * d.y,
    };
}

/** The distinct values of `values`, low to high, those within {@link SAME} counted once */
export function distinct(values: readonly number[]): number[] {
    const sorted = [...values].sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of sorted)
        if (out.length === 0 || v - out[out.length - 1]! > SAME) out.push(v);
    return out;
}

/** Whether the box is filled as a grid (Files), the one fill a straight cut keeps */
export const isGridBox = (box: PlacedBox<BoxParams>): boolean =>
    boxDistribution(box.params).mode === "files";

/** The box's spots, holes included, on the field and in its own axes */
export function boxSpotsOf(box: PlacedBox<BoxParams>): {
    readonly field: readonly XY[];
    readonly local: readonly XY[];
} {
    const field = box.kind.shape.generate(box.params, box.spots, NO_CONTEXT);
    return { field, local: field.map((f) => toBoxAxes(box.params, f)) };
}

/**
 * The two pieces cut `cut` makes of grid box `box`, the one before the cut first: each a box of
 * the same fill, spacing, turn and flips, with as many files as its spots stand in, centered on
 * them, and its members on its own spots where they stand. Null where a piece laid out that way
 * would put a spot anywhere but where one is: nobody moves.
 */
export function boxPieces(
    box: PlacedBox<BoxParams>,
    cut: BoxCut,
): readonly [BoxPiece, BoxPiece] | null {
    if (!isGridBox(box)) return null;
    const { local } = boxSpotsOf(box);
    const side = (d: XY) => (cut.way === "x" ? d.x : d.y) < cut.at;
    const before: number[] = [];
    const after: number[] = [];
    local.forEach((d, i) => (side(d) ? before : after).push(i));
    if (before.length === 0 || after.length === 0) return null;
    const a = piece(box, before, local);
    const b = a && piece(box, after, local);
    return a && b ? [a, b] : null;
}

/** The box spots `indexes` of `box` make on their own, or null if it wouldn't be where they are */
function piece(
    box: PlacedBox<BoxParams>,
    indexes: readonly number[],
    local: readonly XY[],
): BoxPiece | null {
    const own = indexes.map((i) => local[i]!);
    const membersOn = (slotOf: (spot: number) => number | null) =>
        box.recipe.members.flatMap((m) => {
            const at = indexes.indexOf(m.slot);
            if (at < 0) return [];
            const slot = slotOf(at);
            return slot === null ? [] : [{ ...m, slot }];
        });
    // A single spot is no box: its marcher, if it has one, goes loose
    if (indexes.length === 1)
        return { params: null, spots: 1, members: membersOn(() => 0) };
    const xs = own.map((d) => d.x);
    const ys = own.map((d) => d.y);
    const middle = {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
    // Its settings, not what the whole box remembered across mode switches (its frame's)
    const { modes: _modes, ...rest } = box.params;
    const sized = withFileCount(rest, distinct(xs).length);
    const params: BoxParams = {
        ...sized,
        center: fromBoxAxes(box.params, middle),
        // Stored as a box lays itself out now
        distribution: boxDistribution(sized),
    };
    const laid = box.kind.shape
        .generate(params, indexes.length, NO_CONTEXT)
        .map((f) => toBoxAxes(box.params, f));
    // Each of its spots on one of the piece's own, each of those taken once
    const taken = new Set<number>();
    const slots: number[] = [];
    for (const d of own) {
        const slot = laid.findIndex(
            (l, i) =>
                !taken.has(i) &&
                Math.abs(l.x - d.x) <= SAME &&
                Math.abs(l.y - d.y) <= SAME,
        );
        if (slot < 0) return null;
        taken.add(slot);
        slots.push(slot);
    }
    const field = box.kind.shape.generate(params, indexes.length, NO_CONTEXT);
    return {
        params,
        spots: indexes.length,
        members: membersOn((at) => slots[at]!).map((m) => ({
            ...m,
            x: field[m.slot]!.x,
            y: field[m.slot]!.y,
        })),
    };
}

/** A cut on a box at a point: the cut, the two spots either side of it there, and its whole length */
export interface BoxCutAt {
    readonly cut: BoxCut;
    /** The spots either side of the cut nearest the point */
    readonly gap: { readonly from: XY; readonly to: XY };
    /** The cut drawn across the whole box, back end (up the screen) last */
    readonly mark: { readonly from: XY; readonly to: XY };
}

/**
 * The cut grid box `box` would split along at field point `at`: between the two files or ranks it
 * falls between, whichever gap it's nearer the middle of across (a point between two marchers of
 * a rank cuts between their files). `strict` (the pointer over the box): only on the gap between
 * two marchers side by side, within `reach` of the line through them. Null on a marcher (within
 * `reach`, less on a tight box), outside the box, or where no cut falls; the pieces aren't
 * checked here ({@link boxPieces}).
 */
export function boxCutAt(
    box: PlacedBox<BoxParams>,
    at: XY,
    reach: number,
    strict: boolean,
): BoxCutAt | null {
    if (!isGridBox(box)) return null;
    const { field, local } = boxSpotsOf(box);
    const xs = distinct(local.map((d) => d.x));
    const ys = distinct(local.map((d) => d.y));
    const p = toBoxAxes(box.params, at);
    // The spacing between neighbors: a press nearer a dot than a third of it is the dot's
    const gaps = [...pairs(xs), ...pairs(ys)].map(([a, b]) => b - a);
    const onDot = Math.min(reach, Math.min(...gaps, Infinity) / 3);
    if (local.some((d) => Math.hypot(d.x - p.x, d.y - p.y) <= onDot))
        return null;
    const spotAt = (x: number, y: number) =>
        local.findIndex(
            (d) => Math.abs(d.x - x) <= SAME && Math.abs(d.y - y) <= SAME,
        );
    const nearest = (values: readonly number[], v: number) =>
        values.reduce((best, w) =>
            Math.abs(w - v) < Math.abs(best - v) ? w : best,
        );
    /** A cut between `along[i]` and `along[i + 1]`, at `v` on the other axis */
    const between = (along: readonly number[], v: number) => {
        const i = along.findIndex(
            (a, j) => j + 1 < along.length && a < v && v < along[j + 1]!,
        );
        return i < 0 ? null : ([along[i]!, along[i + 1]!] as const);
    };
    const options: { cut: BoxCut; off: number; gap: [number, number] }[] = [];
    const first = (values: readonly number[]) => values[0]!;
    const last = (values: readonly number[]) => values[values.length - 1]!;
    /** The spacing between neighbors one way, or the other way's on a single rank or file */
    const spacing = (values: readonly number[], other: readonly number[]) =>
        values.length > 1
            ? values[1]! - values[0]!
            : other.length > 1
              ? other[1]! - other[0]!
              : 1;
    // Between two files: across, at the rank it's nearest
    const files = between(xs, p.x);
    if (files) {
        const y = nearest(ys, p.y);
        const from = spotAt(files[0], y);
        const to = spotAt(files[1], y);
        const off = Math.abs(p.y - y);
        const inside = p.y >= first(ys) - reach && p.y <= last(ys) + reach;
        if (strict ? from >= 0 && to >= 0 && off <= reach : inside)
            options.push({
                cut: { kind: "box", way: "x", at: (files[0] + files[1]) / 2 },
                // How far off the rank, as a share of the spacing between ranks
                off: off / spacing(ys, xs),
                gap: [from, to],
            });
    }
    const ranks = between(ys, p.y);
    if (ranks) {
        const x = nearest(xs, p.x);
        const from = spotAt(x, ranks[0]);
        const to = spotAt(x, ranks[1]);
        const off = Math.abs(p.x - x);
        const inside = p.x >= first(xs) - reach && p.x <= last(xs) + reach;
        if (strict ? from >= 0 && to >= 0 && off <= reach : inside)
            options.push({
                cut: { kind: "box", way: "y", at: (ranks[0] + ranks[1]) / 2 },
                off: off / spacing(xs, ys),
                gap: [from, to],
            });
    }
    const best = options.reduce<(typeof options)[number] | null>(
        (b, o) => (b === null || o.off < b.off ? o : b),
        null,
    );
    if (!best) return null;
    const { cut } = best;
    // Its two spots either side, or (a hole there) the two along the cut nearest the point
    const [i, j] = best.gap;
    const gap =
        i >= 0 && j >= 0
            ? { from: field[i]!, to: field[j]! }
            : { from: at, to: at };
    return { cut, gap, mark: markOf(box, cut, xs, ys, reach) };
}

/** Consecutive pairs of `values` */
const pairs = (values: readonly number[]): [number, number][] =>
    values.slice(1).map((v, i) => [values[i]!, v]);

/**
 * Cut `cut` drawn across `box`: from a reach past its edge marchers at one end to its edge
 * marchers at the other, that end the one up the screen (toward the back of the field), where
 * the scissors go
 */
function markOf(
    box: PlacedBox<BoxParams>,
    cut: BoxCut,
    xs: readonly number[],
    ys: readonly number[],
    reach: number,
): { from: XY; to: XY } {
    const across = cut.way === "x" ? ys : xs;
    const lo = across[0]!;
    const hi = across[across.length - 1]!;
    const point = (v: number) =>
        fromBoxAxes(
            box.params,
            cut.way === "x" ? { x: cut.at, y: v } : { x: v, y: cut.at },
        );
    const a = point(lo);
    const b = point(hi);
    // The scissors' end: up the screen, or on a level cut the left
    const aBack =
        a.y < b.y - SAME || (Math.abs(a.y - b.y) <= SAME && a.x < b.x);
    return aBack
        ? { from: point(hi + reach), to: a }
        : { from: point(lo - reach), to: b };
}
