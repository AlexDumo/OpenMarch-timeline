import type { FrameSpot } from "./distribute";
import type { GapSide, OddGap } from "./distribution";

/**
 * Outline for a region with corners (#390, spec #385): spots around the edge of a rectangle at
 * the interval, one on every corner. Its sides are whole intervals, `a` across (the back and the
 * front) and `b` deep (the left and the right), so the full loop has 2(a + b) spots. An even
 * count fills it; an odd count leaves one spot between corners out, on the side the designer
 * picks. Fewer than 4 marchers make a line across the front. Everything is pure, in the kind's
 * frame: x across, y deep (the back is −y), from the center.
 */

/** A box outline's sides, in intervals: `a` across, `b` deep */
export interface OutlineSides {
    readonly a: number;
    readonly b: number;
}

/** Fewer than this make a line across the front */
export const OUTLINE_MIN = 4;

const acrossSide = (side: GapSide) => side === "back" || side === "front";

/**
 * The intervals across an outline of `n` may have: 1 to a + b − 1, where a + b is half the full
 * loop. With an odd count the gap's side needs at least 2 intervals, so it has a spot between its
 * corners to leave out.
 */
export function acrossRange(
    n: number,
    side: GapSide,
): { readonly min: number; readonly max: number } {
    const sum = Math.ceil(n / 2);
    const odd = n % 2 === 1;
    return {
        min: odd && acrossSide(side) ? 2 : 1,
        max: odd && !acrossSide(side) ? sum - 2 : sum - 1,
    };
}

/** The sides of an outline of `n` (4 or more) with about `a` intervals across */
export function outlineSides(
    n: number,
    a: number,
    side: GapSide,
): OutlineSides {
    const { min, max } = acrossRange(n, side);
    const across = Math.min(max, Math.max(min, Math.round(a)));
    return { a: across, b: Math.ceil(n / 2) - across };
}

/**
 * The sides of an outline of `n` (4 or more) whose proportions, a ÷ b in intervals, are nearest
 * `aspect`; the wider of two that are as near
 */
export function nearestSides(
    n: number,
    aspect: number,
    side: GapSide,
): OutlineSides {
    const { min, max } = acrossRange(n, side);
    const sum = Math.ceil(n / 2);
    if (!(aspect > 0)) return { a: min, b: sum - min };
    if (!Number.isFinite(aspect)) return { a: max, b: sum - max };
    let best = max;
    let score = Infinity;
    for (let a = max; a >= min; a--) {
        const s = Math.abs(Math.log(a / (sum - a) / aspect));
        if (s < score - 1e-9) {
            best = a;
            score = s;
        }
    }
    return { a: best, b: sum - best };
}

/** The spot an odd count leaves out: on `side`, `at` intervals from its start */
export interface OutlineGap {
    readonly side: GapSide;
    readonly at: number;
}

/** How many intervals long `side` is */
export const sideLength = (sides: OutlineSides, side: GapSide): number =>
    acrossSide(side) ? sides.a : sides.b;

/**
 * Where the gap is for `n` on `sides`: the stored spot when it still exists, the middle of its
 * side when it doesn't (or none was picked). Null for an even count, or a side with no spot
 * between its corners.
 */
export function gapOf(
    n: number,
    sides: OutlineSides,
    oddGap: OddGap,
): OutlineGap | null {
    if (n < OUTLINE_MIN || n % 2 === 0) return null;
    const len = sideLength(sides, oddGap.side);
    if (len < 2) return null;
    const at =
        oddGap.at !== null && oddGap.at >= 1 && oddGap.at <= len - 1
            ? oddGap.at
            : Math.round(len / 2);
    return { side: oddGap.side, at };
}

/**
 * The point `u` intervals along `side` from its start: left to right on the back and front,
 * front to back on the left and right
 */
function sidePoint(
    sides: OutlineSides,
    side: GapSide,
    u: number,
    across: number,
    deep: number,
): { x: number; y: number } {
    const halfW = (sides.a * across) / 2;
    const halfD = (sides.b * deep) / 2;
    switch (side) {
        case "back":
            return { x: -halfW + u * across, y: -halfD };
        case "front":
            return { x: -halfW + u * across, y: halfD };
        case "left":
            return { x: -halfW, y: halfD - u * deep };
        case "right":
            return { x: halfW, y: halfD - u * deep };
    }
}

/** A spot of the full loop: a corner (no side) or the spot `at` intervals along `side` */
export interface LoopSpot extends FrameSpot {
    readonly side: GapSide | null;
    readonly at: number;
}

/**
 * The sides in loop order, clockwise from the back-left corner, each with whether the loop runs
 * along it the way `at` counts
 */
const LOOP: readonly { side: GapSide; forward: boolean }[] = [
    { side: "back", forward: true },
    { side: "right", forward: false },
    { side: "front", forward: false },
    { side: "left", forward: true },
];

/** Where each side's start corner is, in `at` terms on the side the loop reaches it from */
const CORNER_BEFORE: Readonly<Record<GapSide, (s: OutlineSides) => number>> = {
    back: () => 0,
    right: (s) => s.b,
    front: (s) => s.a,
    left: () => 0,
};

/**
 * The row an outline's spots carry: negative, unlike a grid's, and different for every split
 * (a across), so a marcher keeps their spot only while the sides hold the same counts. With one
 * interval all round a handle drag can move marchers from one side to another (#458), and the
 * same place in the loop is then on another side: who goes where is worked out again (review).
 * The spots an odd count spreads along one side are the row below.
 */
const loopRow = (sides: OutlineSides): number => -1 - 2 * sides.a;

/**
 * Every spot of the full loop, 2(a + b) of them, in a fixed order: clockwise from the back-left
 * corner, each side's corner first. Stored slot numbers count in this order, and the spot's `col`
 * is its place in it.
 */
export function outlineLoop(
    sides: OutlineSides,
    across: number,
    deep: number,
): LoopSpot[] {
    const spots: LoopSpot[] = [];
    for (const { side, forward } of LOOP) {
        const len = sideLength(sides, side);
        const start = CORNER_BEFORE[side](sides);
        spots.push({
            ...sidePoint(sides, side, start, across, deep),
            side: null,
            at: start,
            row: loopRow(sides),
            col: spots.length,
        });
        for (let j = 1; j < len; j++) {
            const at = forward ? j : len - j;
            spots.push({
                ...sidePoint(sides, side, at, across, deep),
                side,
                at,
                row: loopRow(sides),
                col: spots.length,
            });
        }
    }
    return spots;
}

/**
 * The outline's spots for `n` on `sides`, in loop order: the full loop for an even count; for an
 * odd one, the loop without the gap's spot, or with the gap's side spread evenly between its
 * corners ("spreads evenly", off the half steps)
 */
export function outlineSpots(
    n: number,
    sides: OutlineSides,
    oddGap: OddGap,
    across: number,
    deep: number,
): FrameSpot[] {
    const loop = outlineLoop(sides, across, deep);
    const gap = gapOf(n, sides, oddGap);
    if (!gap) return loop.map(frameSpot);
    if (oddGap.style === "gap")
        return loop
            .filter((s) => !(s.side === gap.side && s.at === gap.at))
            .map(frameSpot);
    // Spread: the side keeps len − 2 spots between its corners, evenly over its length
    const len = sideLength(sides, gap.side);
    return loop
        .filter((s) => !(s.side === gap.side && s.at === len - 1))
        .map((s) =>
            s.side === gap.side
                ? {
                      ...sidePoint(
                          sides,
                          gap.side,
                          (s.at * len) / (len - 1),
                          across,
                          deep,
                      ),
                      row: loopRow(sides) - 1,
                      col: s.col,
                  }
                : frameSpot(s),
        );
}

const frameSpot = ({ x, y, row, col }: LoopSpot): FrameSpot => ({
    x,
    y,
    row,
    col,
});

/** Fewer than 4: a line across the front at the across interval, centered */
export function outlineLine(n: number, across: number): FrameSpot[] {
    return Array.from({ length: n }, (_, j) => ({
        x: (j - (n - 1) / 2) * across,
        y: 0,
        row: -1,
        col: j,
    }));
}

/** Where the gap's missing spot is, in the frame; null when the outline has no gap to show */
export function gapPoint(
    n: number,
    sides: OutlineSides,
    oddGap: OddGap,
    across: number,
    deep: number,
): { x: number; y: number } | null {
    const gap = gapOf(n, sides, oddGap);
    if (!gap || oddGap.style !== "gap") return null;
    return sidePoint(sides, gap.side, gap.at, across, deep);
}

/**
 * The gap as the field shows it on a shape flipped by `flipX` and `flipY`: a flip side to side
 * swaps left and right and counts the back and front from the other end. Its own inverse.
 */
export function gapAsSeen(
    gap: OddGap,
    sides: OutlineSides,
    flipX: boolean,
    flipY: boolean,
): OddGap {
    let { side, at } = gap;
    const across = side === "back" || side === "front";
    const len = sideLength(sides, side);
    if (flipX) {
        if (across) at = at === null ? null : len - at;
        else side = side === "left" ? "right" : "left";
    }
    if (flipY) {
        if (across) side = side === "back" ? "front" : "back";
        else at = at === null ? null : len - at;
    }
    return { ...gap, side, at };
}
