import { resizeCursor } from "../frame/frame";
import type { ToolKind } from "../tool/toolKind";
import { distributionFor } from "../distribute/distribution";
import { layoutCatalogue, resolveLayout } from "../distribute/layouts";
import { BOX_PARAMS } from "./boxParams";
import { boxRegion, boxShape } from "./boxShape";
import {
    boxBlock,
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
        // Outline joins in #390
        modes: ["files", "spread"],
        region: boxRegion,
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
            const next: BoxParams = { ...rest, distribution: filled };
            // A new mode resizes the shape: it grows from the pivot
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
