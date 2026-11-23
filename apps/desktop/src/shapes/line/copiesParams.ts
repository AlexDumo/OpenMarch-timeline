import type { XY } from "../types";

/**
 * Copies of a Line, Curve or Arc (spec #1190, step 1 #1191): rows that are the drawn line slid
 * straight toward the back sideline (`behind`) or the front one (`front`), `apart` field units
 * from row to row. The line and its copies are one shape: every row follows the drawn line, and
 * each holds as many spots as the drawn line does, the back row the short one when the marchers
 * don't divide evenly. Only on an open line; a closed one is filled instead. Absent: no copies.
 */
export interface LineCopies {
    /** Rows behind the drawn line, toward the back sideline (−y) */
    readonly behind: number;
    /** Rows in front of it, toward the front sideline (+y) */
    readonly front: number;
    /** From one row to the next, in field units; more than 0 */
    readonly apart: number;
}

/** The most copies either way */
export const MAX_COPIES = 20;

const COPIES_KEYS = new Set(["behind", "front", "apart"]);

const isCount = (x: unknown): x is number =>
    typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= MAX_COPIES;

/** A stored `copies`: absent, or only the fields this build knows (ADR 0006, decision 5) */
export function isCopies(c: unknown): c is LineCopies | undefined {
    if (c === undefined) return true;
    if (typeof c !== "object" || c === null) return false;
    if (Object.keys(c).some((key) => !COPIES_KEYS.has(key))) return false;
    const { behind, front, apart } = c as LineCopies;
    return (
        isCount(behind) &&
        isCount(front) &&
        behind + front > 0 &&
        typeof apart === "number" &&
        Number.isFinite(apart) &&
        apart > 0
    );
}

/** The copies that lay out: none on a closed line, which is filled instead */
export const copiesOf = (p: {
    readonly copies?: LineCopies;
    readonly closed?: boolean;
}): LineCopies | null =>
    p.copies && p.closed !== true && p.copies.behind + p.copies.front > 0
        ? p.copies
        : null;

/** How many rows the shape has, the drawn line's included */
export const rowCount = (p: Parameters<typeof copiesOf>[0]): number => {
    const c = copiesOf(p);
    return c ? 1 + c.behind + c.front : 1;
};

/** The spots each row holds for `n` marchers: the drawn line's own count */
export const rowSpots = (p: Parameters<typeof copiesOf>[0], n: number) =>
    Math.max(1, Math.ceil(n / rowCount(p)));

/**
 * Where each row sits from the drawn line, front row first and back row last (the order its spots
 * run in), the drawn line `{0, 0}` among them
 */
export function rowOffsets(p: Parameters<typeof copiesOf>[0]): XY[] {
    const c = copiesOf(p);
    if (!c) return [{ x: 0, y: 0 }];
    const rows: XY[] = [];
    for (let i = c.front; i >= -c.behind; i--)
        rows.push({ x: 0, y: i * c.apart });
    return rows;
}
