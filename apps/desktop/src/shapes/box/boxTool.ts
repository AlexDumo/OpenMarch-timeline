import { resizeCursor } from "../frame/frame";
import type { ToolKind } from "../tool/toolKind";
import { distributionFor, type Distribution } from "../distribute/distribution";
import { nearestSides, OUTLINE_MIN } from "../distribute/outline";
import { BOX_PARAMS } from "./boxParams";
import { boxRegion, boxShape } from "./boxShape";
import {
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
        // Even spread (#391) joins in its ticket
        modes: ["files", "outline"],
        region: boxRegion,
        intervals: (params) => ({ across: params.across, deep: params.deep }),
        distribution: boxDistribution,
        startMode: (params, _n, mode) => distributionFor(mode, filesOf(params)),
        withDistribution(params, n, distribution, env) {
            // How recipes said it before the distributor goes: the distribution says it now
            const {
                pattern: _pattern,
                shortRank: _shortRank,
                shortRankAt: _shortRankAt,
                ...rest
            } = params;
            const next: BoxParams = { ...rest, distribution };
            if (distribution.mode === "files")
                return grownFromPivot(
                    params,
                    withFileCount(next, distribution.layout.files),
                    n,
                    env,
                );
            if (distribution.mode === "outline")
                return grownFromPivot(
                    params,
                    withFileCount(next, outlineFiles(params, n, distribution)),
                    n,
                    env,
                );
            return next;
        },
    },
};

/**
 * Spots across a box going into Outline: kept by one already in Outline; otherwise the outline's
 * proportions are the nearest to the box's as it stands (#390)
 */
function outlineFiles(
    params: BoxParams,
    n: number,
    distribution: Extract<Distribution, { mode: "outline" }>,
): number {
    if (boxDistribution(params).mode === "outline") return filesOf(params);
    if (n < OUTLINE_MIN) return Math.max(1, n);
    const frame = boxFrame(params, n);
    const aspect =
        frame.halfWidth / params.across / (frame.halfDepth / params.deep);
    return nearestSides(n, aspect, distribution.oddGap.side).a + 1;
}
