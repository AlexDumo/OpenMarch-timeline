import type { XY } from "../types";
import { DEGREE, flipFrame, normalizeAngle, type ShapeFrame } from "./frame";

/**
 * A similarity of the field (#1236): a turn, one scale for both axes and a move, perhaps after a
 * mirror. It takes point z to `t + k·z`, or `t + k·z̄` when `mirror` (z̄ the point mirrored front to
 * back, y negated), with k = `a + b·i`: its length is the scale and its angle the turn. What a
 * selection of marchers goes through when its handles turn or scale it evenly, so a shape whose
 * members all went through one keeps its form. Everything here is pure.
 */
export interface Similarity {
    readonly a: number;
    readonly b: number;
    readonly t: XY;
    readonly mirror: boolean;
}

/** Where `sim` takes `p` */
export function applySimilarity(sim: Similarity, p: XY): XY {
    const y = sim.mirror ? -p.y : p.y;
    return {
        x: sim.t.x + sim.a * p.x - sim.b * y,
        y: sim.t.y + sim.b * p.x + sim.a * y,
    };
}

/** How much `sim` scales lengths by */
export const similarityScale = (sim: Similarity): number =>
    Math.hypot(sim.a, sim.b);

/** How far `sim` turns, in radians (toward +y, as a frame's rotation) */
export const similarityTurn = (sim: Similarity): number =>
    Math.atan2(sim.b, sim.a);

/** Whether `sim` only moves: no turn, scale or mirror */
export const isTranslation = (sim: Similarity, eps = 1e-9): boolean =>
    !sim.mirror && Math.abs(sim.a - 1) <= eps && Math.abs(sim.b) <= eps;

/**
 * The similarity taking each `from` to its `to`, fitted by least squares, when every point lands
 * within `tolerance` field units of where it went; null otherwise, or when the points don't span
 * two distinct places (nothing fixes the turn and scale then). One without a mirror wins when
 * both fit, as they do for points in one line.
 */
export function fitSimilarity(
    pairs: readonly { readonly from: XY; readonly to: XY }[],
    tolerance: number,
): Similarity | null {
    const n = pairs.length;
    if (n < 2) return null;
    const mean = (pick: (p: (typeof pairs)[number]) => XY): XY => ({
        x: pairs.reduce((s, p) => s + pick(p).x, 0) / n,
        y: pairs.reduce((s, p) => s + pick(p).y, 0) / n,
    });
    const from = mean((p) => p.from);
    const to = mean((p) => p.to);
    let spread = 0;
    for (const p of pairs)
        spread += (p.from.x - from.x) ** 2 + (p.from.y - from.y) ** 2;
    if (spread < 1e-12) return null;
    const fit = (mirror: boolean): Similarity | null => {
        // k = Σ v·conj(u) / Σ|u|², u (mirrored when it mirrors) and v about their means
        let re = 0;
        let im = 0;
        for (const p of pairs) {
            const ux = p.from.x - from.x;
            const uy = (mirror ? -1 : 1) * (p.from.y - from.y);
            const vx = p.to.x - to.x;
            const vy = p.to.y - to.y;
            re += vx * ux + vy * uy;
            im += vy * ux - vx * uy;
        }
        const fy = mirror ? -from.y : from.y;
        // Through the means, for k = a + b·i
        const through = (a: number, b: number): Similarity => ({
            a,
            b,
            t: {
                x: to.x - (a * from.x - b * fy),
                y: to.y - (b * from.x + a * fy),
            },
            mirror,
        });
        const fits = (sim: Similarity) =>
            pairs.every((p) => {
                const at = applySimilarity(sim, p.from);
                return Math.hypot(at.x - p.to.x, at.y - p.to.y) <= tolerance;
            });
        const sim = through(re / spread, im / spread);
        if (similarityScale(sim) < 1e-9 || !fits(sim)) return null;
        // Positions saved to thousandths fit a turn and scale a hair off the ones the marchers
        // went through: a scale of 1.5 or 1, a turn of 37°, kept when it still fits
        const scale = Math.round(similarityScale(sim) * 1e4) / 1e4;
        const turn =
            (Math.round((similarityTurn(sim) / DEGREE) * 1e3) / 1e3) * DEGREE;
        const tidy = through(scale * Math.cos(turn), scale * Math.sin(turn));
        return scale > 0 && fits(tidy) ? tidy : sim;
    };
    return fit(false) ?? fit(true);
}

/**
 * `frame` taken through `sim`, its size as it was: its center goes where `sim` takes it, it turns
 * by `sim`'s turn, and a mirror flips it (front to back about its center, then turned). A kind's
 * `withFrame` with this frame moves, turns and mirrors the shape exactly as `sim` does, but for
 * the scale, which is the kind's own.
 */
export function similarFrame(frame: ShapeFrame, sim: Similarity): ShapeFrame {
    const mirrored = sim.mirror ? flipFrame(frame, "deep", "c") : frame;
    return {
        ...mirrored,
        center: applySimilarity(sim, frame.center),
        rotation: normalizeAngle(mirrored.rotation + similarityTurn(sim)),
    };
}
