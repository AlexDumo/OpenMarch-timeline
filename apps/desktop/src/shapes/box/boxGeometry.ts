import type { BlockParams } from "../kinds/block";
import type { XY } from "../types";
import {
    filesDistribution,
    storedDistribution,
    type Distribution,
} from "../distribute/distribution";
import { layoutLines, spreadScale } from "../distribute/distribute";
import { rectRegion, type Region } from "../distribute/region";
import type { ToolEnv } from "../tool/toolKind";
import { pivotOf } from "../frame/pivot";
import {
    fieldToFrame,
    frameToField,
    pivotPoint,
    rotationDegrees,
    squareToField,
    type ShapeFrame,
} from "../frame/frame";

/** What every box has: where it is, its file count and intervals, its turn and flips */
export type BoxSize = Pick<
    BlockParams,
    "center" | "rotation" | "files" | "across" | "deep" | "flipX" | "flipY"
>;

/**
 * A box as the box tool draws it (docs/timeline/research/shapes/06-box-v1.md): a block, its
 * rectangle reaching from marcher to marcher (the edge files and ranks stand on its edges). It is
 * drawn square to the field; turning and flipping it are the shape frame's
 * (08-shape-system-ux.md), so every function here works in the box's own axes.
 *
 * How it is filled is the host's `distribution` (spec #385): Files or Spread. `files` stays the
 * box's own file count, as recipes have always stored it, and the Files layout's `files` follows
 * it ({@link withFileCount}); read the layout through {@link boxDistribution}. A spread keeps the
 * block's proportions, files by ranks, at the `across` interval.
 */
export type BoxParams = BoxSize & {
    readonly distribution?: Distribution;
    /**
     * Recipes stored before the distributor (#386) say how the box was filled this way: always
     * a grid with the short rank at the back, centered, which reads as Files, Short back. A box
     * no longer writes them.
     */
    readonly pattern?: BlockParams["pattern"];
    readonly shortRank?: BlockParams["shortRank"];
    readonly shortRankAt?: BlockParams["shortRankAt"];
};

/**
 * The rectangle through the edge marchers, in the box's own axes around its center as if it were
 * square to the field, in field units. `top` is the back. A single rank or file has no depth or
 * width. Turned boxes: see {@link boxFrame}.
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

export const filesOf = (p: BoxSize): number => Math.max(1, Math.round(p.files));

/**
 * How the box is filled: its stored distribution, or Files, Short back with no stagger (a recipe
 * from before #386). A Files layout always has the box's own file count.
 */
export function boxDistribution(p: BoxParams): Distribution {
    const d = storedDistribution(p, filesOf(p));
    if (d === undefined) return filesDistribution(filesOf(p));
    if (d.mode !== "files" || d.layout.files === filesOf(p)) return d;
    return { ...d, layout: { ...d.layout, files: filesOf(p) } };
}

/** `p` with `files` across, its Files layout too */
export function withFileCount<P extends BoxParams>(p: P, files: number): P {
    const d = p.distribution;
    return {
        ...p,
        files,
        ...(d?.mode === "files"
            ? { distribution: { ...d, layout: { ...d.layout, files } } }
            : {}),
    };
}

/** The box's ranks: the lines of its Files layout */
export function ranksOf(p: BoxParams, n: number): number {
    const d = boxDistribution(p);
    const layout =
        d.mode === "files" ? d.layout : filesDistribution(filesOf(p)).layout;
    return layoutLines(layout, n).lines.length;
}

/** How many spots the short rank leaves empty: 0 when every rank is full */
export const shortBy = (p: BoxSize, n: number): number =>
    filesOf(p) * ranksOf(p, n) - Math.max(1, n);

/** Whether the box is an even spread, whose frame is the spread's edge rather than its marchers */
export const isSpread = (p: BoxParams): boolean =>
    boxDistribution(p).mode === "spread";

/**
 * The shape a spread box fills: the block's proportions, files by ranks (its cells square), so
 * switching between Files and Spread keeps how wide and deep the shape is
 */
export function spreadShapeOf(p: BoxParams, n: number): Region {
    return rectRegion(filesOf(p) / 2, ranksOf(p, n) / 2);
}

/** How far a spread box reaches either side of its center, and front to back */
function spreadHalves(p: BoxParams, n: number) {
    const d = boxDistribution(p);
    if (d.mode !== "spread") throw new Error("Not a spread");
    const scale = spreadScale(spreadShapeOf(p, n), n, d, p.across);
    return {
        halfWidth: (filesOf(p) / 2) * scale,
        halfDepth: (ranksOf(p, n) / 2) * scale,
    };
}

export function footprintOf(p: BoxSize, n: number): Footprint {
    const halfW = ((filesOf(p) - 1) * p.across) / 2;
    const halfH = ((ranksOf(p, n) - 1) * p.deep) / 2;
    return {
        left: p.center.x - halfW,
        right: p.center.x + halfW,
        top: p.center.y - halfH,
        bottom: p.center.y + halfH,
    };
}

/**
 * The box's frame: its center, the half sizes through its edge marchers (a spread's edge, which
 * its marchers keep their distance from), its turn and flip
 */
export function boxFrame(p: BoxParams, n: number): ShapeFrame {
    const half = isSpread(p)
        ? spreadHalves(p, n)
        : {
              halfWidth: ((filesOf(p) - 1) * p.across) / 2,
              halfDepth: ((ranksOf(p, n) - 1) * p.deep) / 2,
          };
    return {
        center: p.center,
        ...half,
        rotation: p.rotation,
        flipX: p.flipX === true,
        flipY: p.flipY === true,
    };
}

/** The box with `frame`'s center, turn and flip; its size is its own */
export function withBoxFrame<P extends BoxSize>(p: P, frame: ShapeFrame): P {
    return {
        ...p,
        center: frame.center,
        rotation: frame.rotation,
        // Absent rather than false, so a box that was never flipped stores as before
        ...(frame.flipX ? { flipX: true } : { flipX: undefined }),
        ...(frame.flipY ? { flipY: true } : { flipY: undefined }),
    };
}

export const halfStep = (env: ToolEnv): number => env.stepPx / 2;

/**
 * An interval as drawn or stretched: half steps, tenths of a step with Alt (spec #344), never
 * under half a step
 */
export function snapInterval(v: number, env: ToolEnv): number {
    const half = halfStep(env);
    const unit = env.snap ? half : env.stepPx / 10;
    return Math.max(half, Math.round(v / unit) * unit);
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
 * intervals being whole half steps. Unchanged without snap, and for a box turned off the field's
 * axes, whose marchers can't all stand on the grid.
 */
export function snapToGrid(p: BoxParams, n: number, env: ToolEnv): BoxParams {
    // A spread has no corner marcher: its center goes on the grid, as a circle's does
    if (env.snap && isSpread(p))
        return { ...p, center: env.gridSnap(p.center) };
    if (!env.snap || !squareToField(p.rotation)) return p;
    const frame = boxFrame(p, n);
    const first = frameToField(frame, {
        x: -frame.halfWidth,
        y: -frame.halfDepth,
    });
    const snapped = env.gridSnap(first);
    return {
        ...p,
        center: {
            x: p.center.x + snapped.x - first.x,
            y: p.center.y + snapped.y - first.y,
        },
    };
}

/**
 * A box from its file count and intervals, its edge marchers reaching from `anchor` toward
 * `sign`, filled as `like` is (Files, Short back for a new box)
 */
function boxFrom(
    anchor: XY,
    sign: XY,
    files: number,
    across: number,
    deep: number,
    n: number,
    env: ToolEnv,
    like?: BoxParams,
): BoxParams {
    const sized = withFileCount(
        {
            center: { x: 0, y: 0 },
            rotation: 0,
            files,
            across,
            deep,
            distribution: like
                ? boxDistribution(like)
                : filesDistribution(files),
        },
        files,
    );
    const ranks = ranksOf(sized, n);
    const box: BoxParams = {
        ...sized,
        center: {
            x: anchor.x + (sign.x * (files - 1) * across) / 2,
            y: anchor.y + (sign.y * (ranks - 1) * deep) / 2,
        },
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
 * A box filling `frame`, as if drawn over it: the files suit the frame's proportions and the
 * intervals spread the marchers edge to edge in half steps, turned and flipped like the frame
 */
export function boxInFrame(
    frame: ShapeFrame,
    n: number,
    env: ToolEnv,
): BoxParams {
    const width = 2 * frame.halfWidth;
    const depth = 2 * frame.halfDepth;
    const files = splitFor(width, depth, n);
    const ranks = Math.ceil(Math.max(1, n) / files);
    const a = spread(width, files, env);
    const d = spread(depth, ranks, env);
    const across = a ?? d ?? snapInterval(Math.max(width, depth), env);
    const box: BoxParams = {
        center: frame.center,
        rotation: 0,
        files,
        across,
        deep: d ?? across,
        distribution: filesDistribution(files),
    };
    return snapToGrid(withBoxFrame(box, frame), n, env);
}

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
export function handleKeysOf(p: BoxParams, n: number): BoxHandleKey[] {
    // A spread always has an area to reshape
    if (isSpread(p)) return [...BOX_HANDLE_KEYS];
    const across = filesOf(p) > 1;
    const deep = ranksOf(p, n) > 1;
    return BOX_HANDLE_KEYS.filter((key) => {
        const movesX = key.includes("e") || key.includes("w");
        const movesY = key.includes("n") || key.includes("s");
        return (!movesX || across) && (!movesY || deep);
    });
}

/** Where handle `key` is on the field, on the box's corner or edge marchers, turned with it */
export function boxHandlePoint(p: BoxParams, n: number, key: BoxHandleKey): XY {
    const frame = boxFrame(p, n);
    return frameToField(frame, handleDirection(key, frame));
}

/** Which way handle `key` faces in the box's axes, scaled to reach its corner or side */
export function handleDirection(
    key: BoxHandleKey,
    half: { readonly halfWidth: number; readonly halfDepth: number },
): XY {
    return {
        x: key.includes("w")
            ? -half.halfWidth
            : key.includes("e")
              ? half.halfWidth
              : 0,
        y: key.includes("n")
            ? -half.halfDepth
            : key.includes("s")
              ? half.halfDepth
              : 0,
    };
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
    if (isSpread(base))
        return inBoxAxes(base, n, env, (flat) =>
            reshapeSpread(flat, n, key, fieldToFrame(boxFrame(base, n), to)),
        );
    return inBoxAxes(base, n, env, (flat, flatEnv) =>
        stretchSquare(
            flat,
            n,
            key,
            fieldToFrame(boxFrame(base, n), to),
            flatEnv,
        ),
    );
}

/**
 * `change` worked out in the box's own axes: on a copy of the box centered on 0, 0 and square to
 * the field, with nothing snapped to the field's grid (that grid is the field's, not the box's).
 * The result is put back where the box is, turned and flipped as it was, then snapped.
 */
function inBoxAxes(
    base: BoxParams,
    n: number,
    env: ToolEnv,
    change: (flat: BoxParams, flatEnv: ToolEnv) => BoxParams,
): BoxParams {
    const frame = boxFrame(base, n);
    const flat: BoxParams = {
        ...base,
        center: { x: 0, y: 0 },
        rotation: 0,
    };
    const out = change(flat, { ...env, gridSnap: (p) => p });
    return snapToGrid(
        {
            ...out,
            center: frameToField(frame, out.center),
            rotation: base.rotation,
            flipX: base.flipX,
            flipY: base.flipY,
        },
        n,
        env,
    );
}

/** {@link stretchBox} for a box square to the field, `to` in its axes */
function stretchSquare(
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
    else if (env.ratioLocked)
        ({ across, deep } = keepRatio(base, across, deep, movesX, movesY, env));
    // A side handle keeps the other axis where it was; past the fixed edge, the box flips over it
    const sign = {
        x: movesX ? signOf(to.x - anchor.x) : 1,
        y: movesY ? signOf(to.y - anchor.y) : 1,
    };
    const start = {
        x: movesX ? anchor.x : f.left,
        y: movesY ? anchor.y : f.top,
    };
    return boxFrom(start, sign, files, across, deep, n, env, base);
}

/**
 * {@link stretchBox} for a spread square to the field, `to` in its axes: the interval stays and
 * the size follows the count, so a handle reshapes it. The opposite corner or side stays put and
 * the file count (which sets the proportions) is the one nearest the shape the drag asks for: a
 * side handle keeps the other side's length as asked.
 */
function reshapeSpread(
    base: BoxParams,
    n: number,
    key: BoxHandleKey,
    to: XY,
): BoxParams {
    const frame = boxFrame(base, n);
    const movesX = key.includes("e") || key.includes("w");
    const movesY = key.includes("n") || key.includes("s");
    const anchor = {
        x: key.includes("e") ? -frame.halfWidth : frame.halfWidth,
        y: key.includes("s") ? -frame.halfDepth : frame.halfDepth,
    };
    const width = movesX ? Math.abs(to.x - anchor.x) : 2 * frame.halfWidth;
    const depth = movesY ? Math.abs(to.y - anchor.y) : 2 * frame.halfDepth;
    const files = filesFor(width, depth, n);
    if (files === filesOf(base)) return base;
    const next = withFileCount(base, files);
    const half = boxFrame(next, n);
    // Grown away from the fixed corner or side, toward the handle (past it, the other way)
    return {
        ...next,
        center: {
            x: movesX ? anchor.x + signOf(to.x - anchor.x) * half.halfWidth : 0,
            y: movesY ? anchor.y + signOf(to.y - anchor.y) * half.halfDepth : 0,
        },
    };
}

/**
 * The file count whose block, files by ranks, is nearest the shape of a `width` × `depth`
 * rectangle: what a spread box is reshaped to
 */
export function filesFor(width: number, depth: number, n: number): number {
    const count = Math.max(1, n);
    const want = Math.log(Math.max(width, 1e-6) / Math.max(depth, 1e-6));
    let best = 1;
    let bestFit = Infinity;
    for (let files = 1; files <= count; files++) {
        const fit = Math.abs(Math.log(files / Math.ceil(count / files)) - want);
        if (fit < bestFit - 1e-9) {
            bestFit = fit;
            best = files;
        }
    }
    return best;
}

/**
 * The intervals with the ratio lock on: the one the drag changed most, by proportion, decides,
 * and the other keeps the box's deep-to-across ratio. Both stay on half steps (owner,
 * 2026-10-16), so the ratio is as near as half steps allow. A side handle changes only its own.
 */
export function keepRatio(
    base: Pick<BoxSize, "across" | "deep">,
    across: number,
    deep: number,
    movesX: boolean,
    movesY: boolean,
    env: ToolEnv,
): { across: number; deep: number } {
    if (!(base.across > 0) || !(base.deep > 0)) return { across, deep };
    const ratio = base.deep / base.across;
    const acrossLeads =
        movesX &&
        (!movesY ||
            Math.abs(Math.log(across / base.across)) >=
                Math.abs(Math.log(deep / base.deep)));
    return acrossLeads
        ? { across, deep: snapInterval(across * ratio, env) }
        : { across: snapInterval(deep / ratio, env), deep };
}

/**
 * The box moved by `delta`, its marchers back on the grid. A box turned off the field's axes
 * can't stand on the grid, so it moves by whole half steps instead.
 */
export function moveBox(
    base: BoxParams,
    n: number,
    delta: XY,
    env: ToolEnv,
): BoxParams {
    const by =
        env.snap && !squareToField(base.rotation)
            ? {
                  x: Math.round(delta.x / halfStep(env)) * halfStep(env),
                  y: Math.round(delta.y / halfStep(env)) * halfStep(env),
              }
            : delta;
    return snapToGrid(
        {
            ...base,
            center: { x: base.center.x + by.x, y: base.center.y + by.y },
        },
        n,
        env,
    );
}

/** The box with `delta` more files (fewer when negative): same intervals, grown from the pivot */
export function changeFiles(
    p: BoxParams,
    n: number,
    delta: number,
    env: ToolEnv,
): BoxParams {
    return resizeFiles(p, n, filesOf(p) + delta, env);
}

/**
 * The box with `files` across (clamped to 1 to `n`): it keeps its spacing and grows or shrinks
 * around the pivot. (Keeping its size and refitting the spacing instead lost an A/B with the
 * simulated users on 2026-10-18: everyone's typed spacing broke.)
 */
export function resizeFiles(
    p: BoxParams,
    n: number,
    files: number,
    env: ToolEnv,
): BoxParams {
    const clamped = Math.min(Math.max(1, n), Math.max(1, Math.round(files)));
    if (clamped === filesOf(p)) return p;
    return grownFromPivot(p, withFileCount(p, clamped), n, env);
}

/**
 * `after`, a resize of `before` (a new count or spacing), moved so the pivot stays where it was:
 * the shape's own, the center by default (2026-10-18). Then back on the grid.
 */
export function grownFromPivot(
    before: BoxParams,
    after: BoxParams,
    n: number,
    env: ToolEnv,
): BoxParams {
    const key = env.pivot ?? pivotOf(before);
    const was = pivotPoint(boxFrame(before, n), key);
    const now = pivotPoint(boxFrame(after, n), key);
    return snapToGrid(
        {
            ...after,
            center: {
                x: after.center.x + was.x - now.x,
                y: after.center.y + was.y - now.y,
            },
        },
        n,
        env,
    );
}

/**
 * Whether `at` grabs the box to move it: inside its edge marchers, or within half an interval
 * of them, so a single rank or file can be grabbed too
 */
export function insideBox(p: BoxSize, n: number, at: XY): boolean {
    const frame = boxFrame(p, n);
    const local = fieldToFrame(frame, at);
    return (
        Math.abs(local.x) <= frame.halfWidth + p.across / 2 &&
        Math.abs(local.y) <= frame.halfDepth + p.deep / 2
    );
}

/** The outline through the box's edge marchers, turned with it: back-left first */
export function boxCorners(p: BoxSize, n: number): XY[] {
    const frame = boxFrame(p, n);
    const { halfWidth: w, halfDepth: d } = frame;
    return [
        frameToField(frame, { x: -w, y: -d }),
        frameToField(frame, { x: w, y: -d }),
        frameToField(frame, { x: w, y: d }),
        frameToField(frame, { x: -w, y: d }),
    ];
}

/** The field-aligned rectangle around the box's edge marchers, however it's turned */
export function boxBounds(p: BoxSize, n: number): Footprint {
    const corners = boxCorners(p, n);
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    return {
        left: Math.min(...xs),
        right: Math.max(...xs),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
    };
}

/**
 * Whether the box is turned far enough that its own deep runs side to side on the field: between
 * 45° and 135° (or 225° and 315°). The editor's numbers then follow the field, so "across" is
 * always side to side as people see it (owner, 2026-10-17). Exactly 45° keeps the box's own.
 */
export function acrossIsDeep(rotation: number): boolean {
    const d = rotationDegrees(rotation) % 180;
    return d > 45 && d < 135;
}

/** The box's counts and spacings as the field shows them: across is side to side */
export function onField(p: BoxSize, spots: number) {
    const swap = acrossIsDeep(p.rotation);
    const files = filesOf(p);
    const ranks = ranksOf(p, spots);
    return {
        swap,
        across: swap ? ranks : files,
        deep: swap ? files : ranks,
        acrossSpacing: swap ? p.deep : p.across,
        deepSpacing: swap ? p.across : p.deep,
        /** The box's own parameter each field number edits */
        acrossKey: (swap ? "deep" : "across") as "across" | "deep",
        deepKey: (swap ? "across" : "deep") as "across" | "deep",
    };
}
