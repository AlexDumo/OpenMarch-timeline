import type { BlockParams } from "../kinds/block";
import type { CircleParams } from "../kinds/circle";
import type { FillParams } from "../kinds/fill";

/**
 * The switches between a shape's outline and its fills (owner decisions, 2026-10-11): a circle is
 * Outline or Filled; a box is Grid, Staggered (both a block, with ranks and files) or Natural
 * (a filled box's even spread). Each keeps where the shape is and how big it is.
 */

export function circleToFill(p: CircleParams): FillParams {
    return {
        outline: "circle",
        center: p.center,
        r: p.r,
        width: 2 * p.r,
        height: 2 * p.r,
        rotation: 0,
        edge: 0,
        layout: 1,
    };
}

const ranksOf = (p: BlockParams, n: number) =>
    Math.ceil(Math.max(1, n) / Math.max(1, Math.round(p.files)));

/** A block's box: its outer files and ranks, at least a step across */
export function blockToFill(
    p: BlockParams,
    n: number,
    stepPx: number,
): FillParams {
    // The area the block takes up, each marcher its own interval square: a spread over just the
    // outer files and ranks is far tighter than the block (sims, draw round 1: 1.2 steps), and a
    // bigger one isn't the block you sized (round 2)
    const files = Math.max(1, Math.round(p.files));
    const width = Math.max(stepPx, files * p.across);
    const height = Math.max(stepPx, ranksOf(p, n) * p.deep);
    return {
        outline: "box",
        center: p.center,
        r: Math.min(width, height) / 2,
        width,
        height,
        rotation: p.rotation,
        edge: 0,
        layout: 1,
        block: p,
    };
}

/** A filled box as ranks and files filling it, the files suiting its proportions */
export function fillToBlock(
    p: FillParams,
    n: number,
    pattern: BlockParams["pattern"],
): BlockParams {
    // Back to the ranks and files it came from, where it now stands
    if (p.block) return { ...p.block, center: p.center, pattern };
    const count = Math.max(1, n);
    const aspect = p.height > 1e-9 ? p.width / p.height : count;
    const files = Math.min(
        count,
        Math.max(1, Math.round(Math.sqrt(count * aspect))),
    );
    const ranks = Math.ceil(count / files);
    return {
        center: p.center,
        rotation: p.rotation,
        files,
        across: files > 1 ? p.width / (files - 1) : p.width,
        deep: ranks > 1 ? p.height / (ranks - 1) : p.height,
        pattern,
        shortRank: "start",
        keepIntervals: true,
    };
}
