import type { ToolEnv } from "../tool/toolKind";
import type { XY } from "../types";
import type { Distribution, DistributionMode } from "./distribution";

/**
 * A closed kind's region (spec #385), in the kind's own frame: x across, y deep (back to front),
 * from the frame's center, before any turn or flip. The distributor reads its shape and
 * proportions; every mode spaces the spots by interval, so the size follows the count rather than
 * the region (the region's size is the shape as it stands now).
 */
export interface Region {
    /** Whether a frame point is inside or on the edge */
    contains(p: XY): boolean;
    readonly area: number;
    readonly bounds: {
        readonly left: number;
        readonly top: number;
        readonly right: number;
        readonly bottom: number;
    };
    /** The edge as a closed polygon (the first point not repeated), back-left first, clockwise */
    readonly outline: readonly XY[];
    /** Which outline points are corners: Outline puts a spot on each (#390). None for a circle */
    readonly corners: readonly number[];
}

/** What a closed kind declares so the host can fill it (spec #385, story 38) */
export interface ClosedShape<P> {
    /** The modes it can be filled in, in the mode switch's order; the switch hides with one */
    readonly modes: readonly DistributionMode[];
    /** Its region as it stands, for `n` spots */
    region(params: P, n: number): Region;
    /**
     * How it is filled now: `params.distribution`, read with the kind's defaults (no
     * distribution reads as Files)
     */
    distribution(params: P, n: number): Distribution;
    /** The distribution switching to `mode` starts with (a box's Files keeps its file count) */
    startMode(params: P, n: number, mode: DistributionMode): Distribution;
    /**
     * The params filled in `distribution`, stored in `params.distribution`. The kind keeps its
     * own numbers in step (a box's file count) and grows from the host's pivot.
     */
    withDistribution(
        params: P,
        n: number,
        distribution: Distribution,
        env: ToolEnv,
    ): P;
}

/** A rectangle `halfWidth` × `halfDepth` either side of the center, its four corners */
export function rectRegion(halfWidth: number, halfDepth: number): Region {
    const w = Math.abs(halfWidth);
    const d = Math.abs(halfDepth);
    return {
        contains: (p) => Math.abs(p.x) <= w + 1e-9 && Math.abs(p.y) <= d + 1e-9,
        area: 4 * w * d,
        bounds: { left: -w, top: -d, right: w, bottom: d },
        outline: [
            { x: -w, y: -d },
            { x: w, y: -d },
            { x: w, y: d },
            { x: -w, y: d },
        ],
        corners: [0, 1, 2, 3],
    };
}
