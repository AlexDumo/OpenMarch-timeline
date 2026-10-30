import { PIVOT_KEYS, type PivotKey } from "../frame/frame";

/**
 * The pivot grid in screen terms (#437, owner): its top-left cell is whichever of the shape's nine
 * points is at the top left on screen now. Pivots are still stored in the shape's own terms; this
 * only maps between the two, through the shape's turn snapped to the nearest quarter. A flip
 * doesn't move the frame's points (it mirrors the spots inside the frame), so it needs no mapping.
 */

/** Each key's place in the 3 × 3, −1 to 1 across (left to right) and deep (back to front) */
const PLACE: Readonly<Record<PivotKey, readonly [number, number]>> = {
    nw: [-1, -1],
    n: [0, -1],
    ne: [1, -1],
    w: [-1, 0],
    c: [0, 0],
    e: [1, 0],
    sw: [-1, 1],
    s: [0, 1],
    se: [1, 1],
};

const keyAt = (x: number, y: number): PivotKey =>
    PIVOT_KEYS.find((k) => PLACE[k][0] === x && PLACE[k][1] === y)!;

/** The shape's turn in quarters clockwise, 0 to 3, to the nearest */
export function quarterTurns(rotation: number): number {
    return (((Math.round(rotation / (Math.PI / 2)) % 4) + 4) % 4) as number;
}

/** A quarter turn clockwise on screen (y down): right goes to front */
const turn = ([x, y]: readonly [number, number]): [number, number] => [-y, x];

/** The screen cell the shape's `key` is in, for a shape turned by `rotation` */
export function screenCellOf(rotation: number, key: PivotKey): PivotKey {
    let p: readonly [number, number] = PLACE[key];
    for (let q = quarterTurns(rotation); q > 0; q--) p = turn(p);
    return keyAt(p[0], p[1]);
}

/** The shape's key in screen cell `cell`, for a shape turned by `rotation` */
export function shapeKeyAt(rotation: number, cell: PivotKey): PivotKey {
    let p: readonly [number, number] = PLACE[cell];
    // Three quarter turns on are one back
    for (let q = (4 - quarterTurns(rotation)) % 4; q > 0; q--) p = turn(p);
    return keyAt(p[0], p[1]);
}
