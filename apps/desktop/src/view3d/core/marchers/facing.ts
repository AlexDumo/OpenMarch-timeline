/**
 * Which way a 3D View marcher faces, and which way its legs travel.
 *
 * The upper body always faces the front sideline (the audience). That is
 * `rotation_degrees` 0 and the only facing the app has today: nothing in the
 * editor sets or draws `marcher_pages.rotation_degrees`, so it is ignored here
 * until a facing tool defines it. The legs turn toward the travel direction
 * (om-pose's `pickDirection`), so a marcher crossing the field slides and one
 * moving upfield marches backward.
 *
 * Axes are ADR 0002 D-2: +X toward side 2 (audience right), +Z toward the
 * audience. The renderer's heading is radians about +Y with 0 facing +Z
 * (`writeMatrix`), so facing front is heading 0, and the performer's left is +X.
 */
import {
    pickDirection,
    type Direction,
} from "../../vendor/om-pose/step-blend.js";

/** Heading of a marcher facing the front sideline: radians about +Y, 0 = +Z. */
export const FRONT_HEADING = 0;

/** The heading every marcher's upper body faces. */
export function marcherHeading(): number {
    return FRONT_HEADING;
}

/**
 * The move family and leg turn for travel (dx, dz) in world meters, for a
 * marcher facing `heading`. Family "none" when it doesn't travel.
 */
export function travelDirection(
    dx: number,
    dz: number,
    heading: number = FRONT_HEADING,
): Direction {
    return pickDirection(heading, dx, dz);
}
