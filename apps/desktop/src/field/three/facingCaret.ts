import { DOT_RADIUS } from "@/field/editor/hitTest";
import { dotSizes, ringReach } from "./selectionRing";

/**
 * The facing caret drawn just in front of each performer's dot, pointing where they face (fork
 * #1316): a small chevron (^) whose point aims the facing, as a heading caret on a map. The facing
 * carets layer draws it; the labels layer keeps drill numbers off it.
 *
 * In field units (a dot's radius is 5) while zoomed in. Zoomed out, the caret grows to keep
 * {@link MIN_CARET_PX} across on screen, and its stroke never gets thinner than
 * {@link MIN_STROKE_PX}.
 */
/** From the dot's edge to the caret's arms. */
const CARET_GAP = 1;
/** Arms to point, along the facing. */
const CARET_DEPTH = 3;
/** Half the caret's width, across the facing. */
const CARET_HALF_WIDTH = 3.75;
const STROKE_HALF_WIDTH = 0.8;
/** On screen, CSS px: the narrowest caret (across), the gap and stroke, and the halo. */
const MIN_CARET_PX = 7;
const MIN_GAP_PX = 1;
const MIN_STROKE_PX = 1.5;
const HALO_PX = 1;

/** An equipment icon in place of the dot reaches about this far from the spot, in dot radii. */
export const ICON_DOT_REACH = 1.5;

/** The caret at a zoom, in field units, measured along the facing from the dot's center. */
export type CaretSizes = {
    /** Where the arms start for a round dot (`start` × the marcher's reach in dot radii) */
    start: number;
    /**
     * Where the arms start at the least for a selected marcher: past their selection ring, which
     * is drawn opaque over anything under the dots ({@link caretStart})
     */
    selectedStart: number;
    /** Arms to point, along the facing */
    depth: number;
    /** Half the caret's width, across the facing, arm to arm */
    halfWidth: number;
    /** Half the stroke's width */
    strokeHalfWidth: number;
    /** The background-colored edge round the caret */
    halo: number;
};

/** The caret's sizes at `zoom` (CSS px per field unit). */
export function caretSizes(zoom: number): CaretSizes {
    const grow = Math.max(1, MIN_CARET_PX / (2 * CARET_HALF_WIDTH * zoom));
    const gap = Math.max(CARET_GAP, MIN_GAP_PX / zoom);
    return {
        start: DOT_RADIUS * dotSizes(zoom).scale + gap,
        selectedStart: ringReach(zoom) + gap,
        depth: CARET_DEPTH * grow,
        halfWidth: CARET_HALF_WIDTH * grow,
        strokeHalfWidth: Math.max(
            STROKE_HALF_WIDTH * grow,
            MIN_STROKE_PX / 2 / zoom,
        ),
        halo: HALO_PX / zoom,
    };
}

/**
 * Where a marcher's caret arms start, along the facing from the dot's center: past the dot, or an
 * icon in its place (`reach` dot radii across, 1 for a dot), and past the selection ring when
 * `selected`. The carets layer's shader does the same per instance.
 */
export function caretStart(
    caret: CaretSizes,
    reach: number,
    selected: boolean,
): number {
    const start = caret.start * reach;
    return selected ? Math.max(start, caret.selectedStart) : start;
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
 * Each label's anchor (x, y per marcher, field units) moved off its own facing caret: a label
 * above the dot goes below it when the caret points through it, and one beside the dot goes to
 * the left when the caret points right through it. `directions` are the carets' (x, y per
 * marcher, 0, 0 for none), `widths` each label's width, and `reach` and `selected` (per marcher,
 * both optional) where each caret starts ({@link caretStart}). Writes into `out` and returns it.
 * Allocates nothing: it runs on frames the field changes.
 */
export function anchorsClearOfCarets({
    positions,
    directions,
    widths,
    reach,
    selected,
    label,
    caret,
    out,
}: {
    positions: Float64Array;
    directions: Float32Array;
    widths: ArrayLike<number>;
    /** An icon in place of the dot reaches this many dot radii (1 or missing for a dot) */
    reach?: ArrayLike<number>;
    /** 1 for a selected marcher, whose caret starts past the selection ring */
    selected?: ArrayLike<number>;
    label: LabelPlacement;
    caret: CaretSizes;
    out: Float64Array;
}): Float64Array {
    out.set(positions);
    const n = Math.min(positions.length, directions.length) / 2;
    const h = label.height / 2;
    for (let i = 0; i < n; i++) {
        const dx = directions[i * 2];
        const dy = directions[i * 2 + 1];
        if (dx === 0 && dy === 0) continue;
        const width = widths[i] ?? 0;
        const arms = caretStart(caret, reach?.[i] ?? 1, selected?.[i] === 1);
        if (label.beside) {
            const left = label.offset;
            if (!caretHitsBox(dx, dy, arms, caret, left, -h, left + width, h))
                continue;
            // To the dot's left, the same gap from its center
            const moved = -2 * label.offset - width;
            if (
                !caretHitsBox(
                    dx,
                    dy,
                    arms,
                    caret,
                    left + moved,
                    -h,
                    left + moved + width,
                    h,
                )
            )
                out[i * 2] += moved;
        } else {
            const top = -label.offset - h;
            if (
                !caretHitsBox(
                    dx,
                    dy,
                    arms,
                    caret,
                    -width / 2,
                    top,
                    width / 2,
                    top + label.height,
                )
            )
                continue;
            // Below the dot, as far as it was above
            const below = label.offset - h;
            if (
                !caretHitsBox(
                    dx,
                    dy,
                    arms,
                    caret,
                    -width / 2,
                    below,
                    width / 2,
                    below + label.height,
                )
            )
                out[i * 2 + 1] += 2 * label.offset;
        }
    }
    return out;
}

/**
 * Whether a caret facing (dx, dy) from the dot's center, its arms `arms` out, touches the box
 * (x0, y0)–(x1, y1) relative to the dot: either stroke, from an arm to the point, as thick as the
 * stroke and its halo.
 */
function caretHitsBox(
    dx: number,
    dy: number,
    arms: number,
    caret: CaretSizes,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
): boolean {
    const thick = caret.strokeHalfWidth + caret.halo;
    const point = arms + caret.depth;
    // Along the facing (dx, dy) and across it (-dy, dx)
    const px = dx * point;
    const py = dy * point;
    const ax = dx * arms;
    const ay = dy * arms;
    const cx = -dy * caret.halfWidth;
    const cy = dx * caret.halfWidth;
    const bx0 = x0 - thick;
    const by0 = y0 - thick;
    const bx1 = x1 + thick;
    const by1 = y1 + thick;
    return (
        segmentHitsBox(ax + cx, ay + cy, px, py, bx0, by0, bx1, by1) ||
        segmentHitsBox(ax - cx, ay - cy, px, py, bx0, by0, bx1, by1)
    );
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
    // Across x, then y: the part of the segment inside each slab
    const ddx = x1 - x0;
    if (ddx === 0) {
        if (x0 < bx0 || x0 > bx1) return false;
    } else {
        const a = (bx0 - x0) / ddx;
        const b = (bx1 - x0) / ddx;
        t0 = Math.max(t0, Math.min(a, b));
        t1 = Math.min(t1, Math.max(a, b));
        if (t0 > t1) return false;
    }
    const ddy = y1 - y0;
    if (ddy === 0) return y0 >= by0 && y0 <= by1;
    const a = (by0 - y0) / ddy;
    const b = (by1 - y0) / ddy;
    return Math.max(t0, Math.min(a, b)) <= Math.min(t1, Math.max(a, b));
}
