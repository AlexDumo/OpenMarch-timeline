import {
    assignSlots,
    crossings,
    type AssignMarcher,
    type OrderChoice,
} from "../assign";
import { lineKind, type LineParams } from "../kinds/line";
import type { ShapeContext, Slot, XY } from "../types";

/**
 * Who goes where's walking pictures, shown in each option's tip (09-who-goes-where.md): seven
 * marchers walk from where they stand to a new line. Who takes which spot comes from the real
 * {@link assignSlots}, so a picture can't drift from what the option does. Everything here is pure;
 * `OrderAnimation.tsx` draws it.
 *
 * Each option gets the start that shows it best. Least travel and Within sections start from the
 * same scattered block (in two sections for Within sections), Keep order, Reverse order and Inside
 * out from one line in order, and Zipper from two lines.
 */

/** The picture's size, in CSS px: as wide as the tip's text */
export const ORDER_ANIMATION_SIZE = { width: 216, height: 88 } as const;
/** One step of the picture's field grid, in CSS px: the new line's spots are 3 steps apart */
export const ORDER_ANIMATION_STEP = 10;

const { width: W, height: H } = ORDER_ANIMATION_SIZE;

/** How many marchers walk */
const COUNT = 7;
/** The new line, left to right along the bottom of the picture */
const LINE: LineParams = {
    a: { x: 18, y: H - 14 },
    b: { x: W - 18, y: H - 14 },
    spacing: { mode: "fit" },
};
const SPOT_STEP = (LINE.b.x - LINE.a.x) / (COUNT - 1);
/** The new line's spots, first (left) to last */
const SPOTS: readonly Slot[] = Array.from({ length: COUNT }, (_, i) => ({
    x: LINE.a.x + i * SPOT_STEP,
    y: LINE.a.y,
    s: i,
}));

const CTX: ShapeContext = { stepPx: SPOT_STEP, snapPoint: (p) => p };

/** A marcher in a picture */
export interface OrderAnimationMarcher {
    /** Where the marcher stands before the move */
    readonly from: XY;
    /** The spot the option gives them */
    readonly to: XY;
    /** The number drawn on them: their place in their line's order, or their drill order */
    readonly n: number;
    /** Which of two groups they're in (a section, or a line for Zipper), drawn in two colors */
    readonly group: 0 | 1;
}

/** A picture: the marchers, the new line and its spots */
export interface OrderAnimation {
    readonly marchers: readonly OrderAnimationMarcher[];
    /** The new line */
    readonly line: { readonly a: XY; readonly b: XY };
    /** The new line's spots */
    readonly spots: readonly XY[];
}

/** One line in order, narrower than the new line so the walks fan out */
function startLine(y: number, count: number, step: number, x0?: number): XY[] {
    const left = x0 ?? (W - step * (count - 1)) / 2;
    return Array.from({ length: count }, (_, i) => ({
        x: left + i * step,
        y,
    }));
}

/** The scattered block Least travel and Within sections start from: 4 in front, 3 behind */
const BLOCK: readonly XY[] = [...startLine(18, 4, 24), ...startLine(38, 3, 24)];
/**
 * The block's sections for Within sections, mixed so Least travel would interleave them: front
 * row A B A B, back row B A B
 */
const BLOCK_SECTIONS: readonly (0 | 1)[] = [0, 1, 0, 1, 1, 0, 1];

/** The one line Keep order, Reverse order and Inside out start from */
const ONE_LINE: readonly XY[] = startLine(24, COUNT, 22);

/** Zipper's two lines, staggered so neither hides the other: 4 in front, 3 behind */
const LANES: readonly { at: XY; lane: 0 | 1; along: number }[] = [
    ...startLine(18, 4, 30, 58).map((at, along) => ({
        at,
        lane: 0 as const,
        along,
    })),
    ...startLine(38, 3, 30, 73).map((at, along) => ({
        at,
        lane: 1 as const,
        along,
    })),
];

/** The marchers an option starts from, as {@link assignSlots} reads them */
function sample(choice: OrderChoice): {
    marchers: AssignMarcher[];
    n: number[];
    group: (0 | 1)[];
} {
    switch (choice) {
        case "nearest":
        case "sections":
            return {
                marchers: BLOCK.map((at, i) => ({
                    id: i,
                    at,
                    drillRank: i,
                    section:
                        choice === "sections"
                            ? `${BLOCK_SECTIONS[i]}`
                            : undefined,
                })),
                // Numbered within their section, as drill numbers are
                n: BLOCK.map((_, i) =>
                    choice === "sections"
                        ? BLOCK_SECTIONS.slice(0, i + 1).filter(
                              (g) => g === BLOCK_SECTIONS[i],
                          ).length
                        : i + 1,
                ),
                group: BLOCK.map((_, i) =>
                    choice === "sections" ? BLOCK_SECTIONS[i]! : 0,
                ),
            };
        case "keep":
        case "reverse":
        case "inside":
            return {
                marchers: ONE_LINE.map((at, i) => ({
                    id: i,
                    at,
                    drillRank: i,
                    along: i,
                })),
                n: ONE_LINE.map((_, i) => i + 1),
                group: ONE_LINE.map(() => 0),
            };
        case "zipper":
            return {
                marchers: LANES.map(({ at, lane, along }, i) => ({
                    id: i,
                    at,
                    drillRank: i,
                    along,
                    lane,
                })),
                n: LANES.map(({ along }) => along + 1),
                group: LANES.map(({ lane }) => lane),
            };
    }
}

const modeOf = (choice: OrderChoice) =>
    choice === "reverse" ? ("keep" as const) : choice;

/** The picture for an option, worked out by the real assignment */
export function orderAnimation(choice: OrderChoice): OrderAnimation {
    const { marchers, n, group } = sample(choice);
    const spotOf = assignSlots({
        kind: lineKind,
        params: LINE,
        slots: SPOTS,
        marchers,
        mode: modeOf(choice),
        reverse: choice === "reverse",
        ctx: CTX,
    });
    return {
        marchers: marchers.map((m, i) => ({
            from: m.at,
            to: SPOTS[spotOf[i]!]!,
            n: n[i]!,
            group: group[i]!,
        })),
        line: { a: LINE.a, b: LINE.b },
        spots: SPOTS,
    };
}

/**
 * The new line read left to right: each spot's marcher as its number, with a `b` after the second
 * group's (Zipper's second line, Within sections' second section). For tests and the picture's
 * `data-sequence`.
 */
export function animationSequence(picture: OrderAnimation): string {
    const bySpot = [...picture.marchers].sort((a, b) => a.to.x - b.to.x);
    return bySpot.map((m) => `${m.n}${m.group ? "b" : ""}`).join(" ");
}

/** How many pairs of walks in a picture cross */
export const animationCrossings = (picture: OrderAnimation): number =>
    crossings(picture.marchers);
