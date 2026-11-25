import { DOT_RADIUS } from "@/field/editor/hitTest";
import { dotSizes } from "./selectionRing";

/**
 * The facing arrow drawn from each performer's dot toward where they face (fork #1316), sized as
 * quiver plots and pose arrows draw them: a shaft and a clear head, starting just outside the dot.
 * The facing arrows layer draws it; the labels layer keeps drill numbers off it.
 *
 * In field units (a dot's radius is 5) while zoomed in. Zoomed out, the whole arrow grows to keep
 * {@link MIN_ARROW_PX} on screen, so a whole-field view still reads, and the shaft never gets
 * thinner than {@link MIN_SHAFT_PX}.
 */
/** From the dot's edge to the arrow's tail. */
const ARROW_GAP = 1.5;
/** Tail to tip: a little over 1.5 dot diameters. */
const ARROW_LENGTH = 16;
const HEAD_LENGTH = 7;
const HEAD_HALF_WIDTH = 4.5;
const SHAFT_HALF_WIDTH = 1.1;
/** On screen, CSS px: the shortest arrow (tail to tip), gap and shaft width, and the halo. */
const MIN_ARROW_PX = 13;
const MIN_GAP_PX = 1.5;
const MIN_SHAFT_PX = 1.75;
const HALO_PX = 1.25;

/** An equipment icon in place of the dot reaches about this far from the spot, in dot radii. */
export const ICON_DOT_REACH = 1.5;

/** The arrow at a zoom, in field units, measured along the facing from the dot's center. */
export type ArrowSizes = {
    /** Where the tail starts for a round dot (`start` × the marcher's reach in dot radii) */
    start: number;
    /** Tail to tip */
    length: number;
    headLength: number;
    headHalfWidth: number;
    shaftHalfWidth: number;
    /** The background-colored edge round the arrow */
    halo: number;
};

/** The arrow's sizes at `zoom` (CSS px per field unit). */
export function arrowSizes(zoom: number): ArrowSizes {
    const grow = Math.max(1, MIN_ARROW_PX / (ARROW_LENGTH * zoom));
    return {
        start:
            DOT_RADIUS * dotSizes(zoom).scale +
            Math.max(ARROW_GAP, MIN_GAP_PX / zoom),
        length: ARROW_LENGTH * grow,
        headLength: HEAD_LENGTH * grow,
        headHalfWidth: HEAD_HALF_WIDTH * grow,
        shaftHalfWidth: Math.max(
            SHAFT_HALF_WIDTH * grow,
            MIN_SHAFT_PX / 2 / zoom,
        ),
        halo: HALO_PX / zoom,
    };
}

/** Where a label sits round its dot, in field units: the labels layer's placement. */
export type LabelPlacement = {
    /** Beside the dot (left-aligned, to its right) rather than centered above it */
    beside: boolean;
    /** Above: the label's center above the dot's. Beside: its left end right of the dot's center */
    offset: number;
    /** The label's height */
    height: number;
};

/**
 * Each label's anchor (x, y per marcher, field units) moved off its own facing arrow: a label
 * above the dot goes below it when the arrow points through it, and one beside the dot goes to
 * the left when the arrow points right through it. `directions` are the arrows' (x, y per
 * marcher, 0, 0 for none) and `widths` each label's width. Writes into `out` and returns it.
 */
export function anchorsClearOfArrows({
    positions,
    directions,
    widths,
    label,
    arrow,
    out,
}: {
    positions: Float64Array;
    directions: Float32Array;
    widths: ArrayLike<number>;
    label: LabelPlacement;
    arrow: ArrowSizes;
    out: Float64Array;
}): Float64Array {
    out.set(positions);
    const n = Math.min(positions.length, directions.length) / 2;
    // The shaft, then the head (as wide as its base all along), each with its halo
    const tail = arrow.start - arrow.halo;
    const neck = arrow.start + arrow.length - arrow.headLength;
    const tip = arrow.start + arrow.length + arrow.halo;
    const shaft = arrow.shaftHalfWidth + arrow.halo;
    const head = arrow.headHalfWidth + arrow.halo;
    const h = label.height / 2;
    for (let i = 0; i < n; i++) {
        const dx = directions[i * 2];
        const dy = directions[i * 2 + 1];
        if (dx === 0 && dy === 0) continue;
        const width = widths[i] ?? 0;
        const part = (
            from: number,
            to: number,
            half: number,
            x0: number,
            y0: number,
            x1: number,
            y1: number,
        ) =>
            segmentHitsBox(
                dx * from,
                dy * from,
                dx * to,
                dy * to,
                x0 - half,
                y0 - half,
                x1 + half,
                y1 + half,
            );
        const hits = (x0: number, y0: number, x1: number, y1: number) =>
            part(tail, neck, shaft, x0, y0, x1, y1) ||
            part(neck, tip, head, x0, y0, x1, y1);
        if (label.beside) {
            const left = label.offset;
            if (!hits(left, -h, left + width, h)) continue;
            // To the dot's left, the same gap from its center
            const moved = -2 * label.offset - width;
            if (!hits(left + moved, -h, left + moved + width, h))
                out[i * 2] += moved;
        } else {
            const top = -label.offset - h;
            if (!hits(-width / 2, top, width / 2, top + label.height)) continue;
            // Below the dot, as far as it was above
            const below = label.offset - h;
            if (!hits(-width / 2, below, width / 2, below + label.height))
                out[i * 2 + 1] += 2 * label.offset;
        }
    }
    return out;
}

/** Whether the segment (x0, y0)–(x1, y1) crosses the box (bx0, by0)–(bx1, by1): a slab test. */
function segmentHitsBox(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    bx0: number,
    by0: number,
    bx1: number,
    by1: number,
): boolean {
    let t0 = 0;
    let t1 = 1;
    const ddx = x1 - x0;
    const ddy = y1 - y0;
    for (const [p, d, lo, hi] of [
        [x0, ddx, bx0, bx1],
        [y0, ddy, by0, by1],
    ] as const) {
        if (d === 0) {
            if (p < lo || p > hi) return false;
            continue;
        }
        let a = (lo - p) / d;
        let b = (hi - p) / d;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
        if (t0 > t1) return false;
    }
    return true;
}
