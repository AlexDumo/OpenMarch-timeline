/**
 * Circles through marchers a given straight distance apart: neighbors `g` apart on a circle of
 * radius r are an angle 2·asin(g / 2r) apart.
 */

/** The angle a run of `gaps` turns through on a circle of radius `r` (NaN if a gap won't fit) */
export function angleOfChords(gaps: readonly number[], r: number): number {
    let angle = 0;
    for (const g of gaps) angle += 2 * Math.asin(g / (2 * r));
    return angle;
}

/**
 * The radius on which `gaps` turn through exactly `angle` (up to a full turn). The angle shrinks
 * as the radius grows, so a bisection finds it; the smallest radius is half the widest gap.
 */
export function radiusForChords(
    gaps: readonly number[],
    angle: number,
): number {
    const widest = Math.max(...gaps, 0);
    const total = gaps.reduce((sum, g) => sum + g, 0);
    if (total <= 0 || angle <= 0) return Infinity;
    let lo = widest / 2;
    // Chords never beat the arc: a radius of total / angle turns through at least `angle`
    let hi = Math.max(total / angle, lo) * 2;
    while (angleOfChords(gaps, hi) > angle) hi *= 2;
    if (!(angleOfChords(gaps, lo) >= angle)) return lo;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (angleOfChords(gaps, mid) > angle) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}
