import {
    assignSlots,
    crossings,
    type AssignMarcher,
    type OrderChoice,
} from "../assign";
import { arcKind, type ArcParams } from "../kinds/arc";
import { lineKind, type LineParams } from "../kinds/line";
import type { AnyShapeKind, ShapeContext, XY } from "../types";

/**
 * Who goes where's walking pictures, shown in each option's tip (09-who-goes-where.md): seven
 * marchers walk from where they stand to a new form, in a scene that shows why a writer would
 * pick the option. Who takes which spot comes from the real {@link assignSlots}, so a picture
 * can't drift from what the option does. Everything here is pure; `OrderAnimation.tsx` draws it.
 *
 * The dots carry no drill numbers, so nobody reads them as their own marchers (simulated users,
 * 2026-11-26). Order shows by a leader drawn ringed instead, and sections by two colors.
 *
 * - Least travel: a scattered block makes an arc, nobody crossing.
 * - Keep order: a ring opens into an arc, in order around it.
 * - Reverse order: a line turns around, its leader coming out at the other end.
 * - Inside out: a line folds in halves, its two ends meeting in the middle.
 * - Zipper: two lines merge into one, taking turns.
 * - Within sections: one section behind another make an arc side by side, not interleaved.
 */

/** The picture's size, in CSS px: as wide as the tip's text */
export const ORDER_ANIMATION_SIZE = { width: 216, height: 104 } as const;
/** One step of the picture's field grid, in CSS px */
export const ORDER_ANIMATION_STEP = 10;

const { width: W, height: H } = ORDER_ANIMATION_SIZE;

/** How many marchers walk */
const COUNT = 7;
const CTX: ShapeContext = {
    stepPx: ORDER_ANIMATION_STEP,
    snapPoint: (p) => p,
};

/** The new arc along the bottom of the picture, bowing toward the front (down) */
const ARC: ArcParams = {
    a: { x: 22, y: H - 34 },
    b: { x: W - 22, y: H - 34 },
    bulge: 20,
    spacing: { mode: "fit" },
};
/** The new line for Inside out and Zipper: as wide as the start line */
const LINE: LineParams = {
    a: { x: 30, y: H - 22 },
    b: { x: W - 30, y: H - 22 },
    spacing: { mode: "fit" },
};

/** A marcher in a picture */
export interface OrderAnimationMarcher {
    /** Where the marcher stands before the move */
    readonly from: XY;
    /** The spot the option gives them */
    readonly to: XY;
    /** Their place in the order they start in, from 1 (not drawn: for tests) */
    readonly n: number;
    /** Which of two groups they're in (a section, or a line for Zipper), drawn in two colors */
    readonly group: 0 | 1;
    /** Drawn ringed, so the eye can follow the order: the leader, or Inside out's two ends */
    readonly lead: boolean;
}

/** A picture: the marchers, the new form and its spots */
export interface OrderAnimation {
    readonly marchers: readonly OrderAnimationMarcher[];
    /** The new form, as lines through points */
    readonly outline: readonly (readonly XY[])[];
    /** The new form's spots */
    readonly spots: readonly XY[];
}

/** One line in order, centered unless `x0` is given */
function startLine(y: number, count: number, step: number, x0?: number): XY[] {
    const left = x0 ?? (W - step * (count - 1)) / 2;
    return Array.from({ length: count }, (_, i) => ({
        x: left + i * step,
        y,
    }));
}

/** The scattered block Least travel and Within sections start from: 4 in front, 3 behind */
const BLOCK: readonly XY[] = [...startLine(14, 4, 24), ...startLine(34, 3, 24)];
/**
 * The block's sections for Within sections: one in front, one behind, as sections often stand.
 * Least travel would interleave them on the arc, each column taking neighboring spots.
 */
const BLOCK_SECTIONS: readonly (0 | 1)[] = [0, 0, 0, 0, 1, 1, 1];

/** The ring Keep order opens: seven around a circle, the widest gap at the top where it opens */
const RING: readonly XY[] = Array.from({ length: COUNT }, (_, i) => {
    const angle = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / COUNT;
    return { x: W / 2 + 22 * Math.cos(angle), y: 32 + 22 * Math.sin(angle) };
});

/** The one line Inside out starts from: as wide as the new line */
const ONE_LINE: readonly XY[] = startLine(18, COUNT, (W - 60) / (COUNT - 1));
/**
 * The line Reverse order turns around: short and off to one side, so the walks cross one by one
 * rather than all at one point
 */
const SHORT_LINE: readonly XY[] = startLine(16, COUNT, 16, 28);

/** Zipper's two lines, staggered so neither hides the other: 4 in front, 3 behind */
const LANES: readonly { at: XY; lane: 0 | 1; along: number }[] = [
    ...startLine(14, 4, 30, 58).map((at, along) => ({
        at,
        lane: 0 as const,
        along,
    })),
    ...startLine(34, 3, 30, 73).map((at, along) => ({
        at,
        lane: 1 as const,
        along,
    })),
];

interface Scene {
    kind: AnyShapeKind;
    params: ArcParams | LineParams;
    marchers: AssignMarcher[];
    group: (0 | 1)[];
}

const arcScene = { kind: arcKind, params: ARC };
const lineScene = { kind: lineKind, params: LINE };

/** Where an option's marchers start, as {@link assignSlots} reads them, and the form they make */
function scene(choice: OrderChoice): Scene {
    switch (choice) {
        case "nearest":
        case "sections":
            return {
                ...arcScene,
                marchers: BLOCK.map((at, i) => ({
                    id: i,
                    at,
                    drillRank: i,
                    section:
                        choice === "sections"
                            ? `${BLOCK_SECTIONS[i]}`
                            : undefined,
                })),
                group: BLOCK.map((_, i) =>
                    choice === "sections" ? BLOCK_SECTIONS[i]! : 0,
                ),
            };
        case "keep":
            // No line order: Keep order follows the ring around
            return {
                ...arcScene,
                marchers: RING.map((at, i) => ({ id: i, at, drillRank: i })),
                group: RING.map(() => 0),
            };
        case "reverse":
        case "inside": {
            const line = choice === "reverse" ? SHORT_LINE : ONE_LINE;
            return {
                ...(choice === "reverse" ? arcScene : lineScene),
                marchers: line.map((at, i) => ({
                    id: i,
                    at,
                    drillRank: i,
                    along: i,
                })),
                group: line.map(() => 0),
            };
        }
        case "zipper":
            return {
                ...lineScene,
                marchers: LANES.map(({ at, lane, along }, i) => ({
                    id: i,
                    at,
                    drillRank: i,
                    along,
                    lane,
                })),
                group: LANES.map(({ lane }) => lane),
            };
    }
}

const modeOf = (choice: OrderChoice) =>
    choice === "reverse" ? ("keep" as const) : choice;

/** The picture for an option, worked out by the real assignment */
export function orderAnimation(choice: OrderChoice): OrderAnimation {
    const { kind, params, marchers, group } = scene(choice);
    const spots = kind.generate(params, COUNT, CTX);
    const spotOf = assignSlots({
        kind,
        params,
        slots: spots,
        marchers,
        mode: modeOf(choice),
        reverse: choice === "reverse",
        ctx: CTX,
    });
    // Numbered in their start order: along their line, around the ring the way it opens (from
    // the left of its gap, anticlockwise), or as they stand in the block
    const n = marchers.map((m, i) =>
        m.along !== undefined
            ? m.along + 1
            : choice === "keep"
              ? COUNT - i
              : i + 1,
    );
    const lead = (i: number) => {
        switch (choice) {
            case "keep":
            case "reverse":
                return n[i] === 1;
            case "inside":
                return n[i] === 1 || n[i] === COUNT;
            default:
                return false;
        }
    };
    return {
        marchers: marchers.map((m, i) => ({
            from: m.at,
            to: spots[spotOf[i]!]!,
            n: n[i]!,
            group: group[i]!,
            lead: lead(i),
        })),
        outline: kind.outline(params, COUNT, CTX),
        spots,
    };
}

/**
 * The new form read left to right: each spot's marcher as their start number, with a `b` after
 * the second group's (Zipper's second line, Within sections' second section). For tests and the
 * picture's `data-sequence`.
 */
export function animationSequence(picture: OrderAnimation): string {
    const bySpot = [...picture.marchers].sort((a, b) => a.to.x - b.to.x);
    return bySpot.map((m) => `${m.n}${m.group ? "b" : ""}`).join(" ");
}

/** How many pairs of walks in a picture cross */
export const animationCrossings = (picture: OrderAnimation): number =>
    crossings(picture.marchers);
