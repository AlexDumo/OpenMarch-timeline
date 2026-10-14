import type { BlockParams } from "../kinds/block";
import type { XY } from "../types";
import type { ToolEnv } from "../tool/toolKind";

/**
 * A box as the box tool draws it (docs/timeline/research/shapes/06-box-v1.md): a block square to
 * the field, its rectangle reaching from marcher to marcher (the edge files and ranks stand on
 * its edges), a short rank at the back and centered.
 */
export type BoxParams = BlockParams & {
    readonly rotation: 0;
    readonly pattern: "grid";
    readonly shortRank: "center";
    readonly shortRankAt: "back";
};

/**
 * The rectangle through the edge marchers, in field units. `top` is the back (toward the back
 * sideline). A single rank or file has no depth or width.
 */
export interface Footprint {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

/** How much better, in log aspect, another file count must fit to replace the current one */
const SPLIT_HYSTERESIS = 0.15;

/**
 * How far, in log aspect, a split's cells may be from square and still count as fitting the
 * drawn rectangle: within 2× either way. Among the splits that fit, the fewest empty spots wins.
 */
const SPLIT_BAND = Math.log(2);

export const filesOf = (p: BlockParams): number =>
    Math.max(1, Math.round(p.files));

export const ranksOf = (p: BlockParams, n: number): number =>
    Math.max(1, Math.ceil(Math.max(1, n) / filesOf(p)));

/** How many spots the short rank leaves empty: 0 when every rank is full */
export const shortBy = (p: BlockParams, n: number): number =>
    filesOf(p) * ranksOf(p, n) - Math.max(1, n);

export function footprintOf(p: BlockParams, n: number): Footprint {
    const halfW = ((filesOf(p) - 1) * p.across) / 2;
    const halfH = ((ranksOf(p, n) - 1) * p.deep) / 2;
    return {
        left: p.center.x - halfW,
        right: p.center.x + halfW,
        top: p.center.y - halfH,
        bottom: p.center.y + halfH,
    };
}

export const halfStep = (env: ToolEnv): number => env.stepPx / 2;

/** An interval as drawn: half steps when snapping, never under half a step */
export function snapInterval(v: number, env: ToolEnv): number {
    const half = halfStep(env);
    const snapped = env.snap ? Math.round(v / half) * half : v;
    return Math.max(half, snapped);
}

/**
 * The file count for `n` marchers in a `width` × `depth` drag. Evenness comes first: of the
 * counts whose cells are within 2× of square, the one with the fewest empty spots in its short
 * rank, then the one closest to square. When none is within 2×, the fewest empty spots of all.
 * A drag passes through many sizes, so `current` is kept until another count fits clearly
 * better, which stops the count flickering at a boundary.
 */
export function splitFor(
    width: number,
    depth: number,
    n: number,
    current?: number,
): number {
    const count = Math.max(1, n);
    const w = Math.max(width, 1e-6);
    const d = Math.max(depth, 1e-6);
    const score = (files: number) =>
        Math.abs(Math.log(w / files / (d / Math.ceil(count / files))));
    const empty = (files: number) => files * Math.ceil(count / files) - count;
    const outside = (files: number) => (score(files) > SPLIT_BAND ? 1 : 0);
    const better = (a: number, b: number) =>
        outside(a) - outside(b) || empty(a) - empty(b) || score(a) - score(b);
    let best = 1;
    for (let files = 2; files <= count; files++)
        if (better(files, best) < 0) best = files;
    if (
        current !== undefined &&
        current >= 1 &&
        current <= count &&
        outside(current) === outside(best) &&
        empty(current) === empty(best) &&
        score(current) - score(best) < SPLIT_HYSTERESIS
    )
        return current;
    return best;
}

/**
 * `p` moved so its marchers stand on the grid: the back-left corner snaps (a spot of the full
 * grid, even when the short back rank leaves it empty), and every other marcher follows, the
 * intervals being whole half steps. Unchanged without snap.
 */
export function snapToGrid(p: BoxParams, n: number, env: ToolEnv): BoxParams {
    if (!env.snap) return p;
    const first = {
        x: p.center.x - ((filesOf(p) - 1) / 2) * p.across,
        y: p.center.y - ((ranksOf(p, n) - 1) / 2) * p.deep,
    };
    const snapped = env.gridSnap(first);
    return {
        ...p,
        center: {
            x: p.center.x + snapped.x - first.x,
            y: p.center.y + snapped.y - first.y,
        },
    };
}

/** A box from its file count and intervals, its edge marchers reaching from `anchor` toward `sign` */
function boxFrom(
    anchor: XY,
    sign: XY,
    files: number,
    across: number,
    deep: number,
    n: number,
    env: ToolEnv,
): BoxParams {
    const ranks = Math.ceil(Math.max(1, n) / files);
    const box: BoxParams = {
        center: {
            x: anchor.x + (sign.x * (files - 1) * across) / 2,
            y: anchor.y + (sign.y * (ranks - 1) * deep) / 2,
        },
        rotation: 0,
        files,
        across,
        deep,
        pattern: "grid",
        shortRank: "center",
        shortRankAt: "back",
    };
    return snapToGrid(box, n, env);
}

const signOf = (v: number) => (v < 0 ? -1 : 1);

/** Shift: one interval both ways, between the two the drag gives */
function equalized(across: number, deep: number, env: ToolEnv) {
    const both = snapInterval((across + deep) / 2, env);
    return { across: both, deep: both };
}

/**
 * The interval that spreads `count` marchers across `extent`, edge to edge, or undefined for a
 * single marcher, which has no interval on that axis
 */
const spread = (extent: number, count: number, env: ToolEnv) =>
    count > 1 ? snapInterval(extent / (count - 1), env) : undefined;

/**
 * The box a drag from `from` to `to` draws for `n` marchers: the files suit the rectangle's
 * proportions, a marcher stands on the corner pressed, and the intervals spread the rest to the
 * opposite edges, in half steps (so the far edge lands near the cursor, not always on it).
 * `previous` is the box this drag drew a moment ago, so its file count holds until another fits
 * clearly better. Undefined for a drag too short to be a box.
 */
export function drawBox(
    from: XY,
    to: XY,
    n: number,
    env: ToolEnv,
    previous?: BoxParams,
): BoxParams | undefined {
    const width = Math.abs(to.x - from.x);
    const depth = Math.abs(to.y - from.y);
    if (Math.max(width, depth) < halfStep(env)) return undefined;
    const files = splitFor(
        width,
        depth,
        n,
        previous ? filesOf(previous) : undefined,
    );
    const ranks = Math.ceil(Math.max(1, n) / files);
    // One file or one rank has no interval on that axis: it takes the other's, for a later
    // stretch or file change
    const a = spread(width, files, env);
    const d = spread(depth, ranks, env);
    let across = a ?? d ?? snapInterval(Math.max(width, depth), env);
    let deep = d ?? across;
    if (env.shift) ({ across, deep } = equalized(across, deep, env));
    return boxFrom(
        env.snap ? env.gridSnap(from) : from,
        { x: signOf(to.x - from.x), y: signOf(to.y - from.y) },
        files,
        across,
        deep,
        n,
        env,
    );
}

/** The handles a box has: four corners and four sides, by compass point (north is the back) */
export type BoxHandleKey = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const BOX_HANDLE_KEYS: readonly BoxHandleKey[] = [
    "nw",
    "n",
    "ne",
    "e",
    "se",
    "s",
    "sw",
    "w",
];

/**
 * The handles a box shows: a single file has nothing to stretch across and a single rank nothing
 * to stretch deep, so those handles go (both: none)
 */
export function handleKeysOf(p: BlockParams, n: number): BoxHandleKey[] {
    const across = filesOf(p) > 1;
    const deep = ranksOf(p, n) > 1;
    return BOX_HANDLE_KEYS.filter((key) => {
        const movesX = key.includes("e") || key.includes("w");
        const movesY = key.includes("n") || key.includes("s");
        return (!movesX || across) && (!movesY || deep);
    });
}

export function handlePoint(f: Footprint, key: BoxHandleKey): XY {
    const x = key.includes("w")
        ? f.left
        : key.includes("e")
          ? f.right
          : (f.left + f.right) / 2;
    const y = key.includes("n")
        ? f.top
        : key.includes("s")
          ? f.bottom
          : (f.top + f.bottom) / 2;
    return { x, y };
}

/**
 * The box with handle `key` dragged to `to`: the opposite corner or side stays put and the
 * intervals stretch, in half steps. Files and ranks never change here.
 */
export function stretchBox(
    base: BoxParams,
    n: number,
    key: BoxHandleKey,
    to: XY,
    env: ToolEnv,
): BoxParams {
    const f = footprintOf(base, n);
    const files = filesOf(base);
    const ranks = ranksOf(base, n);
    const movesX = key.includes("e") || key.includes("w");
    const movesY = key.includes("n") || key.includes("s");
    // The fixed edge on each axis: the one opposite the handle (left for an east handle)
    const anchor = {
        x: key.includes("e") ? f.left : f.right,
        y: key.includes("s") ? f.top : f.bottom,
    };
    let across =
        (movesX && spread(Math.abs(to.x - anchor.x), files, env)) ||
        base.across;
    let deep =
        (movesY && spread(Math.abs(to.y - anchor.y), ranks, env)) || base.deep;
    if (env.shift && movesX && movesY)
        ({ across, deep } = equalized(across, deep, env));
    // A side handle keeps the other axis where it was; past the fixed edge, the box flips over it
    const sign = {
        x: movesX ? signOf(to.x - anchor.x) : 1,
        y: movesY ? signOf(to.y - anchor.y) : 1,
    };
    const start = {
        x: movesX ? anchor.x : f.left,
        y: movesY ? anchor.y : f.top,
    };
    return boxFrom(start, sign, files, across, deep, n, env);
}

/** The box moved by `delta`, its marchers back on the grid */
export function moveBox(
    base: BoxParams,
    n: number,
    delta: XY,
    env: ToolEnv,
): BoxParams {
    return snapToGrid(
        {
            ...base,
            center: { x: base.center.x + delta.x, y: base.center.y + delta.y },
        },
        n,
        env,
    );
}

/** The box with `delta` more files (fewer when negative): same intervals, same center */
export function changeFiles(
    p: BoxParams,
    n: number,
    delta: number,
    env: ToolEnv,
): BoxParams {
    const files = Math.min(Math.max(1, n), Math.max(1, filesOf(p) + delta));
    if (files === filesOf(p)) return p;
    return snapToGrid({ ...p, files }, n, env);
}

/**
 * Whether `at` grabs the box to move it: inside its edge marchers, or within half an interval
 * of them, so a single rank or file can be grabbed too
 */
export function insideBox(p: BlockParams, n: number, at: XY): boolean {
    const f = footprintOf(p, n);
    const padX = p.across / 2;
    const padY = p.deep / 2;
    return (
        at.x >= f.left - padX &&
        at.x <= f.right + padX &&
        at.y >= f.top - padY &&
        at.y <= f.bottom + padY
    );
}
