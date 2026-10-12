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
    const width = Math.max(stepPx, (files - 1) * p.across);
    const height = Math.max(stepPx, (ranksOf(p, n) - 1) * p.deep);
    return {
        outline: "box",
        center: p.center,
        r: Math.min(width, height) / 2,
        width,
        height,
        rotation: p.rotation,
        edge: 0,
        layout: 1,
    };
}

/** A filled box as ranks and files filling it, the files suiting its proportions */
export function fillToBlock(
    p: FillParams,
    n: number,
    pattern: BlockParams["pattern"],
): BlockParams {
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
