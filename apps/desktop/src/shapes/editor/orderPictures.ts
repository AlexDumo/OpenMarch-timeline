import type { OrderChoice } from "../assign";
import { leastTravel } from "../leastTravel";
import type { ToolChoicePicture } from "../tool/toolKind";
import type { XY } from "../types";

/**
 * Who goes where's pictures (#559): four marchers on an old line (drawn faint) walk onto a new
 * line below it. Only the old line's first marcher is picked out, solid where it starts and where
 * it lands, so each picture asks one question: where does the solid one land? The old line starts
 * low on the left and turns up and along the top, so the three answers land it on three different
 * spots: Least travel walks it a short way onto the second spot (the marcher above it takes the
 * first), Keep order takes it to the first spot with the others following in order, and Reverse
 * to the last, the walks crossing.
 */

/** The menu's pictures are larger than the other menus': four marchers need the room */
export const ORDER_PICTURE_SIZE = { width: 36, height: 22 } as const;

/** The new line's spots, first to last */
const TO: readonly XY[] = [0, 10, 20, 30].map((x) => ({ x, y: 18 }));
const NEW_LINE = { points: [TO[0]!, TO[TO.length - 1]!] };
/**
 * The old line's marchers, first to last: the first stands low on the left, then the line runs up
 * and along the top to the right
 */
const FROM: readonly XY[] = [
    { x: 3, y: 11 },
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 2 },
];
const OLD_LINE = { points: FROM, faint: true };
/** The marcher each picture picks out: the old line's first */
const FIRST = 0;

/** The pictures' moves, worked out with the rule each names: the spot index for each marcher */
export const ORDER_SPOTS: Readonly<Record<OrderChoice, readonly number[]>> = {
    nearest: leastTravel(FROM, TO),
    keep: FROM.map((_, i) => i),
    reverse: FROM.map((_, i) => FROM.length - 1 - i),
};

/** The old line's marchers and the new line's spots the pictures use */
export const ORDER_SAMPLE = { from: FROM, to: TO } as const;

function picture(spotOf: readonly number[]): ToolChoicePicture {
    return {
        lines: [
            OLD_LINE,
            NEW_LINE,
            // The first marcher's walk drawn stronger than the others', so the eye follows it
            ...FROM.map((p, i) => ({
                points: [p, TO[spotOf[i]!]!],
                faint: i !== FIRST,
                dashed: true,
            })),
        ],
        dots: TO,
        faintDots: FROM,
        marked: { dot: spotOf[FIRST]!, faintDot: FIRST },
    };
}

export const ORDER_PICTURES: Readonly<Record<OrderChoice, ToolChoicePicture>> =
    {
        nearest: picture(ORDER_SPOTS.nearest),
        keep: picture(ORDER_SPOTS.keep),
        reverse: picture(ORDER_SPOTS.reverse),
    };
