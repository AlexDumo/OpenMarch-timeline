import { resizeCursor } from "../frame/frame";
import type { ToolEnv, ToolKind } from "../tool/toolKind";
import { distributionFor, type Distribution } from "../distribute/distribution";
import { layoutCatalogue, resolveLayout } from "../distribute/layouts";
import { acrossRange, nearestSides, OUTLINE_MIN } from "../distribute/outline";
import { BOX_PARAMS } from "./boxParams";
import { boxRegion, boxShape } from "./boxShape";
import {
    boxBlock,
    filesIn,
    spreadIn,
    SPLIT_BAND,
    halfStep,
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
            const { spreadAspect: _aspect, ...flat } = rest;
            const was = boxDistribution(params).mode;
            if (filled.mode === "spread") {
                const next: BoxParams = { ...rest, distribution: filled };
                // Reshuffle and a typed seed: the same frame, another layout in it
                if (was === "spread") return next;
                // Spread fills the frame the box had (#439); a single rank or file has none
                const kept = spreadIn(params, next, n, env);
                if (kept) return kept;
            }
            const next: BoxParams = { ...flat, distribution: filled };
            // Into another mode, the drawn box stays: its center, and its size as near as
            // half-step intervals allow (#439, #449)
            if (was !== "files" && filled.mode === "files")
                return filesIn(
                    params,
                    withFileCount(next, filled.layout.files),
                    n,
                    env,
                );
            if (was !== "outline" && filled.mode === "outline")
                return outlineIn(params, next, n, filled, env);
            // The same mode laid out another way (a layout, a gap), or a box with no frame to
            // keep: it grows from the pivot
            return grownFromPivot(
                params,
                filled.mode === "files"
                    ? withFileCount(next, filled.layout.files)
                    : filled.mode === "outline"
                      ? outlineIn(params, next, n, filled, env)
                      : next,
                n,
                env,
            );
        },
    },
};

/**
 * `next` (the box with its new distribution) sized for Outline. One already in Outline keeps its
 * spots across. Otherwise it keeps the space the box takes up (owner, lab feedback 2026-10-23:
 * designers care about the space, then adjust the interval; #449: every switch keeps the frame):
 * the sides with the space's proportions, each interval refitted to it in half steps; or, when
 * those miss the frame by more than half a step a side, of the splits whose cells are within 2×
 * of square, the one whose half-step intervals come nearest it. A single rank or file
 * has no space to keep, so it keeps its intervals and goes round as wide (or deep) as it can.
 */
function outlineIn(
    params: BoxParams,
    next: BoxParams,
    n: number,
    distribution: Extract<Distribution, { mode: "outline" }>,
    env: ToolEnv,
): BoxParams {
    if (boxDistribution(params).mode === "outline") return next;
    if (n < OUTLINE_MIN) return withFileCount(next, Math.max(1, n));
    const { halfWidth, halfDepth } = boxFrame(params, n);
    const side = distribution.oddGap.side;
    if (!(halfWidth > 0) || !(halfDepth > 0)) {
        const aspect = halfWidth / params.across / (halfDepth / params.deep);
        return withFileCount(next, nearestSides(n, aspect, side).a + 1);
    }
    const width = 2 * halfWidth;
    const depth = 2 * halfDepth;
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
        if (f.square > SPLIT_BAND) continue;
        if (best.square > SPLIT_BAND || f.off < best.off - 1e-9) best = f;
    }
    return best.params;
}
