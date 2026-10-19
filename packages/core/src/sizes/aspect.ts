/**
 * The one "same aspect" rule (docs/3d/props-spec.md section 3, "Fit"): the
 * desktop's sizing code scales an Artwork of the same aspect and crops or
 * pads one of another, and the cue compile notes a Silk whose Artwork's
 * aspect differs from its flag's Cut. Both use this rule, so a note appears
 * exactly when the Artwork is fitted rather than matched.
 */

/** Default relative tolerance for "same aspect": 0.5% of the larger. */
export const ASPECT_TOLERANCE = 0.005;

/** Whether two width ÷ height ratios match within a relative tolerance. */
export function sameAspect(
    a: number,
    b: number,
    tolerance = ASPECT_TOLERANCE,
): boolean {
    return Math.abs(a - b) <= tolerance * Math.max(a, b);
}
