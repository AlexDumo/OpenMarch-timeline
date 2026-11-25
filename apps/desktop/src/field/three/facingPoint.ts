/**
 * The point a performer's dot is drawn with toward where they face (fork #1316), in field units
 * from the dot's center (the dot's radius is 5). The marchers layer draws it; the labels layer
 * keeps drill numbers clear of it.
 *
 * The tip reaches 9.5, a little under half the 2-step interval of a block (22.5), so points stay
 * clear of the next dot. A circle tapers to it from its whole width, a teardrop; the other shapes
 * grow a narrower point from inside them.
 */
export const NOSE_TIP = 9.5;
export const NOSE_TIP_RADIUS = 0.75;
export const NOSE_BASE = 2.5;

/** How far the point reaches past a round dot's edge. */
const NOSE_REACH = NOSE_TIP - 5;

/**
 * Each label's anchor (x, y per marcher, field units) moved off the point when it aims at the
 * label: up by as much as it reaches up, for a label above the dot, or right by as much as it
 * reaches right, for one beside it. `directions` are the marchers layer's (x, y per marcher, 0, 0
 * for a plain dot). Writes into `out` and returns it.
 */
export function anchorsClearOfPoints(
    positions: Float64Array,
    directions: Float32Array,
    beside: boolean,
    out: Float64Array,
): Float64Array {
    out.set(positions);
    const n = Math.min(positions.length, directions.length) / 2;
    for (let i = 0; i < n; i++) {
        if (beside) {
            const right = directions[i * 2];
            if (right > 0) out[i * 2] += right * NOSE_REACH;
        } else {
            const up = -directions[i * 2 + 1];
            if (up > 0) out[i * 2 + 1] -= up * NOSE_REACH;
        }
    }
    return out;
}
