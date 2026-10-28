import { resizeCursor } from "../frame/frame";
import type { GapSide } from "../distribute/distribution";
import type { ToolEnv, ToolKind } from "../tool/toolKind";
import { distributionFor, type Distribution } from "../distribute/distribution";
import { layoutCatalogue, resolveLayout } from "../distribute/layouts";
import { acrossRange, nearestSides, OUTLINE_MIN } from "../distribute/outline";
import { BOX_PARAMS } from "./boxParams";
import { leftAs, readMemory, sameSize, type ModeMemory } from "./modeMemory";
import { boxRegion, boxShape } from "./boxShape";
import {
    boxBlock,
    filesIn,
    spreadIn,
    frameSizeOf,
    type FrameSize,
    boxDistribution,
    filesOf,
    grownFromPivot,
    withFileCount,
    type BoxHandleKey,
    type BoxParams,
    boxCorners,
    boxFrame,
    boxHandlePoint,
    boxInFrame,
    drawBox,
    handleDirection,
    handleKeysOf,
    insideBox,
    moveBox,
    evenOutline,
    snapInterval,
    snapToGrid,
    stretchBox,
    withBoxFrame,
} from "./boxGeometry";

/**
 * The box tool: drawn corner to corner, stretched by its corners and sides (the handles sit on the
 * edge marchers), moved from inside, and turned and flipped through its frame like every kind
 */
export const boxTool: ToolKind<BoxParams> = {
    shape: boxShape,
    params: BOX_PARAMS,
    scaling: "interval",
    ratioLock: true,
    draw: drawBox,
    handles(params, n) {
        const frame = boxFrame(params, n);
        return handleKeysOf(params, n).map((key) => ({
            key,
            at: boxHandlePoint(params, n, key),
            // The cursor faces the way the handle does, however the box is turned
            cursor: resizeCursor(
                frame,
                handleDirection(key, { halfWidth: 1, halfDepth: 1 }),
            ),
        }));
    },
    dragHandle: (base, n, key, to, env) =>
        stretchBox(base, n, key as BoxHandleKey, to, env),
    outline: boxCorners,
    snapPoints: (params, n) => [
        ...boxCorners(params, n),
        boxFrame(params, n).center,
    ],
    contains: insideBox,
    move: moveBox,
    frameOf: boxFrame,
    withFrame: (params, _n, frame) => withBoxFrame(params, frame),
    fromFrame: boxInFrame,
    settle: snapToGrid,
    closed: {
        modes: ["files", "outline", "spread"],
        region: boxRegion,
        intervals: (params) => ({ across: params.across, deep: params.deep }),
        distribution: boxDistribution,
        layouts: {
            catalogue: layoutCatalogue,
            resolved: (params, n) =>
                boxDistribution(params).mode === "files"
                    ? boxBlock(params, n)
                    : null,
        },
        startMode: (params, n, mode) =>
            distributionFor(mode, filesOf(params), n),
        withDistribution(params, n, distribution, env) {
            // How recipes said it before the distributor goes: the distribution says it now
            const {
                pattern: _pattern,
                shortRank: _shortRank,
                shortRankAt: _shortRankAt,
                ...rest
            } = params;
            // A layout at a width it can't make the count with (a saved shape's family at the
            // drawn file count) is stored as its nearest version; one whose family can't make
            // the count at all is kept as asked, Short back standing in (#387)
            const resolved =
                distribution.mode === "files"
                    ? resolveLayout(distribution.layout, n)
                    : null;
            const filled =
                distribution.mode === "files" && resolved?.fellBack === null
                    ? { ...distribution, layout: resolved.layout }
                    : distribution;
            const was = boxDistribution(params).mode;
            // Into another mode, the drawn box stays (#439, #449)
            if (was !== filled.mode)
                return switched(params, rest, n, filled, env);
            // Reshuffle and a typed seed: the same frame, another layout in it
            if (filled.mode === "spread")
                return { ...rest, distribution: filled };
            const { spreadAspect: _aspect, ...flat } = rest;
            const next: BoxParams = { ...flat, distribution: filled };
            // The same mode laid out another way (a layout, a gap): it grows from the pivot
            return grownFromPivot(
                params,
                filled.mode === "files"
                    ? withFileCount(next, filled.layout.files)
                    : next,
                n,
                env,
            );
        },
    },
};

/**
 * The box switched to `distribution`'s mode (#439, #449): its center and turn kept, and its size
 * fitted to the frame the designer drew or last shaped ({@link ModeMemory}), never to the frame
 * a switch left, so switching back and forth doesn't walk the box. A mode left since that frame
 * was drawn comes back with the numbers it had (Grid its file count and intervals, Outline its
 * sides, Spread its seed), so a round trip is the box it was.
 */
function switched(
    params: BoxParams,
    rest: BoxParams,
    n: number,
    distribution: Distribution,
    env: ToolEnv,
): BoxParams {
    const was = boxDistribution(params);
    const now = frameSizeOf(params, n);
    const memory = readMemory(params);
    const stands =
        memory !== undefined &&
        memory.count === n &&
        sameSize(memory.seen, now);
    const frame = stands ? memory.frame : now;
    const left = {
        ...(stands ? memory.left : {}),
        [was.mode]: leftAs(params, was),
    };
    const { spreadAspect: _aspect, ...flat } = rest;
    const back = left[distribution.mode];
    let next: BoxParams;
    if (back) next = { ...flat, ...back, center: params.center };
    else if (distribution.mode === "files")
        next = filesIn(
            frame,
            withFileCount({ ...flat, distribution }, distribution.layout.files),
            n,
            env,
        );
    else if (distribution.mode === "outline")
        next = outlineIn(
            frame,
            params,
            { ...flat, distribution },
            n,
            distribution,
            env,
        );
    else
        next =
            spreadIn(frame, { ...rest, distribution }, n, env) ??
            // A single rank or file has no frame to fill: it grows from the pivot
            grownFromPivot(params, { ...rest, distribution }, n, env);
    const modes: ModeMemory = {
        frame,
        seen: frameSizeOf(next, n),
        count: n,
        left,
    };
    return { ...next, modes };
}

/**
 * `next` (the box switched to Outline) in a frame `width` × `depth`, with one interval all the
 * way round (#458): the interval spreads the marchers over the frame's perimeter in half steps,
 * and each side takes as many as its length holds, so a long side gets more than a short one. An
 * outline must have its spots half a step apart or more, so one that can't go round the frame
 * that close (48 round a box 3½ × 2½ steps) grows to the size it needs. Under
 * {@link OUTLINE_MIN} marchers it is a line, and a box with no area (a single rank or file) keeps
 * its intervals and goes round as wide (or deep) as it can.
 */
function outlineIn(
    { width, depth }: FrameSize,
    params: BoxParams,
    next: BoxParams,
    n: number,
    distribution: Extract<Distribution, { mode: "outline" }>,
    env: ToolEnv,
): BoxParams {
    if (n < OUTLINE_MIN) return withFileCount(next, Math.max(1, n));
    const side = distribution.oddGap.side;
    if (!(width > 0) || !(depth > 0)) {
        const aspect = width / params.across / (depth / params.deep);
        return withFileCount(next, nearestSides(n, aspect, side).a + 1);
    }
    const { a, interval } = keptOutline(width, depth, n, side, env);
    return {
        ...withFileCount(next, a + 1),
        across: interval,
        deep: interval,
    };
}

/**
 * The split and the one interval (#458) that keep an outline of `n` nearest a `width` × `depth`
 * frame, the interval kept exactly (to 600ths of a step, as typed) even off the half steps: the
 * space comes first, and the first edit after puts the interval back on half steps (owner on
 * #458). For each split, the interval at which its worse side misses least: one fitting a side,
 * or one where the two sides miss by as much; then the split nearer the frame's proportions.
 * Never under half a step, so a frame too small to go round that close grows.
 */
function keptOutline(
    width: number,
    depth: number,
    n: number,
    side: GapSide,
    env: ToolEnv,
): { a: number; interval: number } {
    const sum = Math.ceil(n / 2);
    const { min, max } = acrossRange(n, side);
    const proportional = evenOutline(width, depth, n, side, env).a;
    let best: { a: number; interval: number; off: number } | null = null;
    for (let a = min; a <= max; a++) {
        const b = sum - a;
        const tries = [width / a, depth / b, (width + depth) / sum];
        if (a !== b) tries.push((width - depth) / (a - b));
        for (const v of tries) {
            if (!(v > 0)) continue;
            const interval = snapInterval(v, env, true);
            const off = Math.max(
                Math.abs(a * interval - width),
                Math.abs(b * interval - depth),
            );
            if (
                best === null ||
                off < best.off - 1e-9 ||
                (Math.abs(off - best.off) <= 1e-9 &&
                    Math.abs(a - proportional) <
                        Math.abs(best.a - proportional))
            )
                best = { a, interval, off };
        }
    }
    return best!;
}
