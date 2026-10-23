import { blockKind, type BlockParams } from "../kinds/block";
import { distribute } from "../distribute/distribute";
import { rectRegion, type Region } from "../distribute/region";
import type { ShapeKind, Slot, XY } from "../types";
import {
    boxDistribution,
    boxFrame,
    type BoxParams,
    type BoxSize,
} from "./boxGeometry";

/**
 * The box's shape kind, as recipes store it (`block`, version 1): the block's, except that its
 * spots come from the host's distributor (spec #385). Files lays out exactly the spots the block
 * did, so the version stays.
 */

/** A recipe from before box v1: short rank at the front or off center, or the old offset rows */
const isPreBox = (p: BoxParams): boolean =>
    p.distribution === undefined &&
    ((p.shortRankAt ?? "front") !== "back" ||
        (p.shortRank ?? "center") !== "center" ||
        p.pattern === "offset");

/** The rectangle through the box's edge marchers, in its own axes */
export function boxRegion(p: BoxParams, n: number): Region {
    const frame = boxFrame(p, n);
    return rectRegion(frame.halfWidth, frame.halfDepth);
}

/** A point in the box's own axes, flipped, then turned and placed as the block always did */
function toField(p: BoxSize, x: number, y: number): XY {
    const lx = p.flipX ? -x : x;
    const ly = p.flipY ? -y : y;
    const c = Math.cos(p.rotation);
    const s = Math.sin(p.rotation);
    // The block's sum, in its order, so a box's spots are the same to the bit
    return {
        x: p.center.x + (c * lx + -s * ly),
        y: p.center.y + (s * lx + c * ly),
    };
}

/** The box's spots in its own axes, from the distributor */
const localSpots = (p: BoxParams, n: number) =>
    distribute({
        region: boxRegion(p, n),
        n,
        distribution: boxDistribution(p),
        across: p.across,
        deep: p.deep,
    });

export function boxSpots(p: BoxParams, n: number): Slot[] {
    return localSpots(p, n).map((s) => ({
        ...toField(p, s.x, s.y),
        row: s.row,
        col: s.col,
    }));
}

export const boxShape: ShapeKind<BoxParams> = {
    ...(blockKind as unknown as ShapeKind<BoxParams>),
    generate(p, n, ctx) {
        if (n <= 0) return [];
        return isPreBox(p)
            ? blockKind.generate(p as BlockParams, n, ctx)
            : boxSpots(p, n);
    },
    /** The rectangle around the spots, as the block drew it */
    outline(p, n, ctx) {
        if (isPreBox(p)) return blockKind.outline(p as BlockParams, n, ctx);
        const spots = localSpots(p, n);
        if (spots.length === 0) return [];
        const xs = spots.map((s) => s.x);
        const ys = spots.map((s) => s.y);
        const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
        const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
        const corners = [
            toField(p, x0, y0),
            toField(p, x1, y0),
            toField(p, x1, y1),
            toField(p, x0, y1),
        ];
        return [[...corners, corners[0]!]];
    },
};
