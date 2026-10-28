import { resizeCursor } from "../frame/frame";
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
    halfStep,
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
 * `next` (the box switched to Outline) in a frame `width` × `depth`: the sides with the frame's
 * proportions, each interval refitted to it in half steps (owner, lab feedback 2026-10-23:
 * designers care about the space, then adjust the interval); or, when those miss it by more than
 * half a step a side, the split whose half-step intervals come nearest it, the squarer cells on a
 * tie (#449). An outline must have its spots half a step apart or more, so one that can't go
 * round the frame that close (48 round a box 3½ × 2½ steps) grows to the size it needs. Under
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
    const fit = ({ a, b }: { a: number; b: number }) => {
        const across = snapInterval(width / a, env);
        const deep = snapInterval(depth / b, env);
        return {
            params: { ...withFileCount(next, a + 1), across, deep },
            off: Math.abs(a * across - width) + Math.abs(b * deep - depth),
            square: Math.abs(Math.log(across / deep)),
        };
    };
    let best = fit(nearestSides(n, width / depth, side));
    // The frame's proportions, when they keep it within half a step a side
    if (best.off <= 2 * halfStep(env) + 1e-9) return best.params;
    const { min, max } = acrossRange(n, side);
    for (let a = min; a <= max; a++) {
        const f = fit({ a, b: Math.ceil(n / 2) - a });
        if (
            f.off < best.off - 1e-9 ||
            (Math.abs(f.off - best.off) <= 1e-9 && f.square < best.square)
        )
            best = f;
    }
    return best.params;
}
