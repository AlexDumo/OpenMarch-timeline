/**
 * The floating editor's numbers, which you type or drag (08-shape-system-ux.md, "Numbers you can
 * type or drag"). The pixel rates are first guesses, to be tuned by feel. Everything here is pure.
 */

/** Which way a number drags: sideways (right for more) or up and down (up for more) */
export type ScrubAxis = "x" | "y";

/** What a drag on a number reports, from where the press was */
export interface ScrubMove {
    readonly dx: number;
    readonly dy: number;
    /** The direction a two-way number locked to */
    readonly axis: ScrubAxis;
    readonly alt: boolean;
    readonly shift: boolean;
}

export interface ScrubRate {
    readonly axis: ScrubAxis;
    /** Pixels of drag per step of the value */
    readonly px: number;
    /** How much one step changes the value */
    readonly step: number;
}

/** Spacings: half a step per 8 px, tenths of a step with Alt */
export const SPACING_RATE = { px: 8, step: 0.5 } as const;
export const SPACING_FINE_STEP = 0.1;
/** Counts (how many across or deep): one per 16 px */
export const COUNT_RATE = { px: 16, step: 1 } as const;

/** How far a press must move before it's a drag, not a click, in px */
export const SCRUB_SLOP_PX = 3;

/** The drag along the number's axis, in px, positive for more */
export const scrubDistance = (
    axis: ScrubAxis,
    dx: number,
    dy: number,
): number => (axis === "x" ? dx : -dy);

/**
 * The value dragged `dx`, `dy` px from `base`, in whole steps from it (so a drag back to where it
 * started gives `base` exactly, unrounded)
 */
export function scrubValue(
    base: number,
    dx: number,
    dy: number,
    rate: ScrubRate,
): number {
    const steps = Math.trunc(scrubDistance(rate.axis, dx, dy) / rate.px);
    return steps === 0 ? base : base + steps * rate.step;
}

/**
 * Which way a two-way number (a box's size) is being dragged: the first direction moved past the
 * slop, kept for the rest of the drag. Null until then.
 */
export function lockedAxis(
    current: ScrubAxis | null,
    dx: number,
    dy: number,
): ScrubAxis | null {
    if (current) return current;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SCRUB_SLOP_PX) return null;
    return Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
}

/**
 * Steps as typed: "2", "2.5", "2½", "2 1/2", "½". Null for anything else, or a value not above 0.
 */
export function parseSteps(text: string): number | null {
    const t = text
        .trim()
        .replace(/steps?$/i, "")
        .trim();
    const m = /^(\d+(?:\.\d+)?)?\s*(½|1\/2)?$/.exec(t);
    if (!m || (m[1] === undefined && m[2] === undefined)) return null;
    const value = Number(m[1] ?? 0) + (m[2] ? 0.5 : 0);
    return value > 0 ? value : null;
}

/** A size as typed: "6", "6 × 2", "6x2", "6 by 2". Null for anything else. */
export function parseSize(
    text: string,
): { across: number; deep?: number } | null {
    const m = /^\s*(\d+)\s*(?:(?:×|x|X|\*|by)\s*(\d+))?\s*$/.exec(text);
    if (!m) return null;
    const across = Number(m[1]);
    if (!(across >= 1)) return null;
    return m[2] === undefined ? { across } : { across, deep: Number(m[2]) };
}

/** A rotation as typed, in degrees: "45", "45°", "-90". Null for anything else. */
export function parseDegrees(text: string): number | null {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*°?\s*$/.exec(text);
    return m ? Number(m[1]) : null;
}
