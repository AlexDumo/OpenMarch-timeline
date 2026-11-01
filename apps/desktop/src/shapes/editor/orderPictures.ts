import type { OrderChoice } from "../assign";
import { leastTravel } from "../leastTravel";
import type { ToolChoicePicture } from "../tool/toolKind";
import type { XY } from "../types";

/**
 * Who goes where's pictures (#559): marchers on a line (light) moving onto a new line below them,
 * each marcher drawn by its place in the order, from an empty ring (the first) to a solid dot
 * (the last), at both ends of its move. The old line bends back on itself, so the three answers
 * really differ (two straight lines would make Least travel the same as one of the others):
 * Least travel walks each marcher a short way straight down and the ramp lands mixed, Keep order
 * lands the ramp in the same order along the new line, and Reverse lands it flipped.
 */

/** The new line's spots, first to last */
const TO: readonly XY[] = [2, 12, 22].map((x) => ({ x, y: 13 }));
const NEW_LINE = { points: [TO[0]!, TO[2]!], faint: true };
/** The old line's marchers, first to last: it runs left along the top and turns back */
const FROM: readonly XY[] = [
    { x: 20, y: 1 },
    { x: 5, y: 3 },
    { x: 13, y: 5.5 },
];
/** Each marcher's place in the old line's order, 0 to 1 */
const SHADE = FROM.map((_, i) => i / (FROM.length - 1));

/** The pictures' moves, worked out with the rule each names: the spot index for each marcher */
export const ORDER_SPOTS: Readonly<Record<OrderChoice, readonly number[]>> = {
    nearest: leastTravel(FROM, TO),
    keep: FROM.map((_, i) => i),
    reverse: FROM.map((_, i) => FROM.length - 1 - i),
};

/** The old line's marchers and the new line's spots the pictures use */
export const ORDER_SAMPLE = { from: FROM, to: TO } as const;

function picture(spotOf: readonly number[]): ToolChoicePicture {
    // Each spot drawn as the marcher who lands on it
    const landed = new Array<number>(TO.length);
    spotOf.forEach((spot, marcher) => (landed[spot] = SHADE[marcher]!));
    return {
        lines: [
            NEW_LINE,
            ...FROM.map((p, i) => ({
                points: [p, TO[spotOf[i]!]!],
                faint: true,
                dashed: true,
            })),
        ],
        dots: TO,
        faintDots: FROM,
        shades: { dots: landed, faintDots: SHADE },
    };
}

export const ORDER_PICTURES: Readonly<Record<OrderChoice, ToolChoicePicture>> =
    {
        nearest: picture(ORDER_SPOTS.nearest),
        keep: picture(ORDER_SPOTS.keep),
        reverse: picture(ORDER_SPOTS.reverse),
    };
