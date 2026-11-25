/**
 * The Rows menu's spot strips at any length (#1190 follow-up): every row drawn across the same
 * width, so the ends are always there. Past the count that fits at full size, the strips squeeze
 * and a magnifier opens where the pointer is: the same stretch of spots grows to full size in
 * every row (so how the rows sit against each other still reads), and the rest squeezes to make
 * room, like the macOS Dock. Once open, the lens holds still while the pointer moves inside it,
 * so each of its spots is a fixed full-size target; pointing past its edge drags it along.
 *
 * Positions are in spots along the drawn line, centered on it (`spotAt`), the same for every row,
 * so the rows line up. Pure.
 */

/** A row as the strips draw it: how many spots, and where it sits in half spots */
export interface LensRow {
    readonly length: number;
    readonly shift: number;
}

/** Full-size spot pitch, px: a 6 px dot and a 2 px gap */
export const PITCH = 8;
/** The widest pitch a short row gets, px */
const ROOMY_PITCH = 10;
/** Room at each end of a strip for the end dots' hover ring, px */
export const STRIP_PAD = 7;
/** The widest lens: spots each side of its center at full size, then spots over which it fades */
const LENS_FLAT = 4;
const LENS_FADE = 3;
/** The narrowest the squeezed part gets, px per spot */
const MIN_SQUEEZE = 0.02;
/** How far the lens must be open before it holds still under the pointer */
const SETTLED = 0.98;

/** Where spot `j` of `row` sits, in spots from the drawn line's middle */
export function spotAt(row: LensRow, j: number): number {
    return j - (row.length - 1) / 2 + row.shift / 2;
}

/** The stretch every row's spots cover, half a spot past the outermost ones */
export function span(rows: readonly LensRow[]): { lo: number; hi: number } {
    let lo = Infinity;
    let hi = -Infinity;
    for (const row of rows) {
        if (row.length === 0) continue;
        lo = Math.min(lo, spotAt(row, 0) - 0.5);
        hi = Math.max(hi, spotAt(row, row.length - 1) + 0.5);
    }
    return lo <= hi ? { lo, hi } : { lo: -0.5, hi: 0.5 };
}

/** Whether the rows need the lens: they don't all fit across `width` at full size */
export function needsLens(rows: readonly LensRow[], width: number): boolean {
    const { lo, hi } = span(rows);
    return (hi - lo) * PITCH > width - 2 * STRIP_PAD;
}

/** A lens's size, in spots: full size each side of its center, then fading over `fade` */
export interface LensSize {
    readonly flat: number;
    readonly fade: number;
}

/**
 * The lens for these rows across `width`: as wide as leaves the rest of the strip about a pixel
 * a spot (half the strip, for rows longer than that), so pointing past it moves it a spot or so at
 * a time and the mouse can reach every spot, never squeezing the rest to a hair (sim study of the
 * Rows lens: a full-width lens left 1 px for 40 spots).
 */
export function lensSize(rows: readonly LensRow[], width: number): LensSize {
    const { lo, hi } = span(rows);
    const R = hi - lo;
    const W = Math.max(1, width - 2 * STRIP_PAD);
    const rest = Math.min(1, (0.5 * W) / R);
    const room = Math.max(0, (W - rest * R) / (PITCH - rest));
    const fade = Math.min(LENS_FADE, Math.max(1, room / 4));
    const flat = Math.max(1, Math.min(LENS_FLAT, (room - fade) / 2));
    return { flat, fade };
}

/** ∫ of the lens's weight (1 across its flat part, fading to 0 over its fade) from −∞ to `t` */
function lensArea(t: number, { flat: H, fade: K }: LensSize): number {
    if (t <= -(H + K)) return 0;
    if (t <= -H) {
        const u = t + H + K;
        return 0.5 * (u - (K / Math.PI) * Math.sin((Math.PI * u) / K));
    }
    if (t <= H) return K / 2 + t + H;
    if (t <= H + K) {
        const u = t - H;
        return (
            K / 2 +
            2 * H +
            0.5 * (u + (K / Math.PI) * Math.sin((Math.PI * u) / K))
        );
    }
    return 2 * H + K;
}

/**
 * Where each position lands across a strip `width` px wide, the lens centered on `focus` and open
 * `strength` (0 closed, 1 open). Shared by every row, so their columns line up.
 */
export function warp(
    rows: readonly LensRow[],
    width: number,
    focus: number,
    strength: number,
): (u: number) => number {
    const { lo, hi } = span(rows);
    const R = hi - lo;
    const W = Math.max(1, width - 2 * STRIP_PAD);
    if (R * PITCH <= W) {
        const pitch = Math.min(ROOMY_PITCH, W / R);
        const mid = (lo + hi) / 2;
        return (u) => width / 2 + (u - mid) * pitch;
    }
    const a = Math.max(0, Math.min(1, strength));
    if (a < 0.001) {
        const s = W / R;
        return (u) => STRIP_PAD + (u - lo) * s;
    }
    const size = lensSize(rows, width);
    const G = lensArea(hi - focus, size) - lensArea(lo - focus, size);
    // The rest squeezes as far as it must so the lens stays full size
    let s = (W - a * PITCH * G) / (R - a * G);
    let b = PITCH;
    if (s < MIN_SQUEEZE) {
        s = MIN_SQUEEZE;
        b = (W - s * (R - a * G)) / (a * G);
    }
    const base = lensArea(lo - focus, size);
    return (u) =>
        STRIP_PAD +
        s * (u - lo) +
        a * (b - s) * (lensArea(u - focus, size) - base);
}

/** The position whose `place(position)` lands on `px`, by halving (`place` rises with it) */
function solve(
    rows: readonly LensRow[],
    px: number,
    place: (u: number) => number,
): number {
    let { lo, hi } = span(rows);
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (place(mid) < px) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/** The lens centered under `px`, so the spot pointed at stays under the pointer as it opens */
export function focusUnder(
    rows: readonly LensRow[],
    width: number,
    px: number,
    strength: number,
): number {
    return solve(rows, px, (f) =>
        warp(rows, width, f, Math.max(strength, 0.001))(f),
    );
}

/**
 * Where the lens goes as the pointer moves to `px`: while it's still opening, centered under the
 * pointer; once open, nowhere while the pointer is inside it, and dragged by its edge, the edge
 * kept under the pointer, once the pointer goes past.
 */
export function followPointer(
    rows: readonly LensRow[],
    width: number,
    focus: number,
    strength: number,
    px: number,
): number {
    if (strength < SETTLED) return focusUnder(rows, width, px, strength);
    const X = warp(rows, width, focus, strength);
    const { lo, hi } = span(rows);
    let a = lo - 1;
    let b = hi + 1;
    for (let i = 0; i < 40; i++) {
        const mid = (a + b) / 2;
        if (X(mid) < px) a = mid;
        else b = mid;
    }
    const at = (a + b) / 2;
    const { flat } = lensSize(rows, width);
    if (at > focus + flat)
        return solve(rows, px, (f) => warp(rows, width, f, strength)(f + flat));
    if (at < focus - flat)
        return solve(rows, px, (f) => warp(rows, width, f, strength)(f - flat));
    return focus;
}

/** The spot of `row` nearest `px`, under the lens as it is */
export function spotUnder(
    rows: readonly LensRow[],
    row: LensRow,
    width: number,
    focus: number,
    strength: number,
    px: number,
): number {
    const X = warp(rows, width, focus, strength);
    let best = 0;
    let gap = Infinity;
    for (let j = 0; j < row.length; j++) {
        const d = Math.abs(X(spotAt(row, j)) - px);
        if (d < gap) {
            gap = d;
            best = j;
        }
    }
    return best;
}

/** A spot's dot size where it lands: full size in the lens, down to a hair where squeezed */
export function dotSize(X: (u: number) => number, u: number): number {
    const pitch = X(u + 0.5) - X(u - 0.5);
    return Math.max(1.6, Math.min(8, pitch - 2));
}

/** The spot in `to` in the same column as spot `j` of `from`, for moving between rows by key */
export function sameColumn(from: LensRow, j: number, to: LensRow): number {
    const u = spotAt(from, j);
    const k = Math.round(u + (to.length - 1) / 2 - to.shift / 2);
    return Math.max(0, Math.min(to.length - 1, k));
}
