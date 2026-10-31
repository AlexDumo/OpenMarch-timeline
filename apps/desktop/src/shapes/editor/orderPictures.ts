import type { OrderChoice } from "../assign";
import type { ToolChoicePicture } from "../tool/toolKind";
import type { XY } from "../types";

/**
 * Who goes where's pictures (#559), drawn by hand: no kind's geometry says who goes where. Each
 * shows marchers (light) moving onto a new line below them. Least travel takes each to the spot
 * nearest it; Keep order takes the first of a line to the first spot and so on, so the moves fan
 * out without crossing; Reverse takes the first to the last, so they cross.
 */

const TO: readonly XY[] = [2, 8.67, 15.33, 22].map((x) => ({ x, y: 13 }));
const NEW_LINE = { points: [TO[0]!, TO[3]!], faint: true };
/** A line of marchers placed before, for Keep order and Reverse to follow */
const FROM_LINE: readonly XY[] = [7, 10.33, 13.67, 17].map((x) => ({
    x,
    y: 3,
}));
/** Marchers standing anywhere, for Least travel */
const SCATTERED: readonly XY[] = [
    { x: 3.5, y: 5 },
    { x: 9.5, y: 3 },
    { x: 14, y: 6 },
    { x: 20.5, y: 4 },
];

const moves = (from: readonly XY[], to: readonly XY[]) =>
    from.map((p, i) => ({ points: [p, to[i]!], faint: true, dashed: true }));

const picture = (
    from: readonly XY[],
    to: readonly XY[],
): ToolChoicePicture => ({
    lines: [NEW_LINE, ...moves(from, to)],
    dots: TO,
    faintDots: from,
});

export const ORDER_PICTURES: Readonly<Record<OrderChoice, ToolChoicePicture>> =
    {
        nearest: picture(SCATTERED, TO),
        keep: picture(FROM_LINE, TO),
        reverse: picture(FROM_LINE, [...TO].reverse()),
    };
