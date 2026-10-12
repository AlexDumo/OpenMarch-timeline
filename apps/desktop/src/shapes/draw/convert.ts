import type { BlockParams } from "../kinds/block";
import type { CircleParams } from "../kinds/circle";
import type { FillParams } from "../kinds/fill";
import { FIT } from "../kinds/pathKind";

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

export function fillToCircle(p: FillParams): CircleParams {
    return { center: p.center, r: p.r, start: Math.PI / 2, spacing: FIT };
}

const ranksOf = (p: BlockParams, n: number) =>
    Math.ceil(Math.max(1, n) / Math.max(1, Math.round(p.files)));

/** A block's box: its outer files and ranks, at least a step across */
export function blockToFill(
    p: BlockParams,
    n: number,
    stepPx: number,
): FillParams {
    const files = Math.max(1, Math.round(p.files));
    let width = Math.max(stepPx, (files - 1) * p.across);
    let height = Math.max(stepPx, (ranksOf(p, n) - 1) * p.deep);
    // Room for the spread at about the block's own intervals: a natural spread over just the
    // block's outer files and ranks is far tighter than the block (sims, draw round 1: 1.2 steps)
    const needed = (Math.sqrt(3) / 2) * Math.max(1, n) * p.across * p.deep;
    if (width * height < needed) {
        const k = Math.sqrt(needed / (width * height));
        width *= k;
        height *= k;
    }
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
