/**
 * Copies of a Line, Curve or Arc (spec #1190): the drawn line repeated in rows behind it
 * (`behind`) and in front (`front`), `apart` field units from row to row, and in columns to its
 * left and right (`left`, `right`, steps #1192), `gap` field units clear of each other. Each row
 * can sit `stagger` further sideways than the one in front of it. The line and its copies are one
 * shape: every copy follows the drawn line, and each holds as many spots as the drawn line does,
 * the last copy (the back row's right end) the short one when the marchers don't divide evenly.
 * Only on an open line; a closed one is filled instead. Absent: no copies.
 */
export interface LineCopies {
    /** Rows behind the drawn line, toward the back sideline (−y) */
    readonly behind: number;
    /** Rows in front of it, toward the front sideline (+y) */
    readonly front: number;
    /** From one row to the next, in field units; more than 0 */
    readonly apart: number;
    /** Columns to its left (−x), as the audience sees it (#1192). None when absent. */
    readonly left?: number;
    /** Columns to its right (+x) (#1192). None when absent. */
    readonly right?: number;
    /**
     * Clear space between one column and the next, side to side, in field units: the drawn
     * line's own width apart plus this, so columns follow its length (#1192). 0 or more.
     */
    readonly gap?: number;
    /**
     * How much further right each row sits than the row in front of it, in field units; negative
     * for left (#1192). None when absent.
     */
    readonly stagger?: number;
    /**
     * Which way behind and left are (#1192): the field's (toward the back sideline, stage left),
     * or `shape`, the line's own as drawn, turning with it. The field's when absent.
     */
    readonly direction?: "shape";
}

/** The most copies any one way */
export const MAX_COPIES = 20;

const COPIES_KEYS = new Set([
    "behind",
    "front",
    "apart",
    "left",
    "right",
    "gap",
    "stagger",
    "direction",
]);

const isCount = (x: unknown): x is number =>
    typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= MAX_COPIES;
const isOptionalCount = (x: unknown) => x === undefined || isCount(x);
const isFiniteNumber = (x: unknown): x is number =>
    typeof x === "number" && Number.isFinite(x);

/** A stored `copies`: absent, or only the fields this build knows (ADR 0006, decision 5) */
export function isCopies(c: unknown): c is LineCopies | undefined {
    if (c === undefined) return true;
    if (typeof c !== "object" || c === null) return false;
    if (Object.keys(c).some((key) => !COPIES_KEYS.has(key))) return false;
    const { behind, front, apart, left, right, gap, stagger, direction } =
        c as LineCopies;
    return (
        isCount(behind) &&
        isCount(front) &&
        isOptionalCount(left) &&
        isOptionalCount(right) &&
        behind + front + (left ?? 0) + (right ?? 0) > 0 &&
        isFiniteNumber(apart) &&
        apart > 0 &&
        (gap === undefined || (isFiniteNumber(gap) && gap >= 0)) &&
        (stagger === undefined || isFiniteNumber(stagger)) &&
        (direction === undefined || direction === "shape")
    );
}

/** How many copies `c` makes, the drawn line not counted */
export const copyCount = (c: Partial<LineCopies>): number =>
    (c.behind ?? 0) + (c.front ?? 0) + (c.left ?? 0) + (c.right ?? 0);

/** The copies that lay out: none on a closed line, which is filled instead */
export const copiesOf = (p: {
    readonly copies?: LineCopies;
    readonly closed?: boolean;
}): LineCopies | null =>
    p.copies && p.closed !== true && copyCount(p.copies) > 0 ? p.copies : null;

/** How many rows the shape has front to back, the drawn line's included */
export const rowsOf = (c: LineCopies | null): number =>
    c ? 1 + c.behind + c.front : 1;
/** How many columns it has side to side, the drawn line's included */
export const columnsOf = (c: LineCopies | null): number =>
    c ? 1 + (c.left ?? 0) + (c.right ?? 0) : 1;

/** How many lines the shape has, the drawn line's included */
export const lineCount = (p: Parameters<typeof copiesOf>[0]): number => {
    const c = copiesOf(p);
    return rowsOf(c) * columnsOf(c);
};

/** The spots each line holds for `n` marchers: the drawn line's own count */
export const lineSpotCount = (p: Parameters<typeof copiesOf>[0], n: number) =>
    Math.max(1, Math.ceil(n / lineCount(p)));
