/**
 * Where a readout that follows a touch drag goes (the drag step readout, the held-roles chip):
 * clear of the finger, which covers what's under and just below it. A mouse or pen readout stays
 * beside the pointer as it always was; only a touch press uses this.
 *
 * All values are CSS pixels in the field element.
 */

/** From the fingertip up to the readout's bottom edge: clear of a fingertip, as upstream had it */
export const FINGER_CLEARANCE = 64;
/** From the fingertip across to the readout when there's no room above the finger */
export const FINGER_SIDE_CLEARANCE = 44;
/** The readout keeps this far inside the field's edges */
export const READOUT_EDGE = 8;

type Size = { readonly width: number; readonly height: number };
type Point = { readonly x: number; readonly y: number };

const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), Math.max(min, max));

/**
 * The top-left of a readout of `size` for a finger at `finger` in a field of `bounds`: centered
 * above the finger, kept inside the field. Near the top, where there's no room above, it sits
 * beside the finger instead (to the right, or the left at the right edge), never under it.
 */
export function touchReadoutPlacement(
    finger: Point,
    size: Size,
    bounds: Size,
): { left: number; top: number } {
    const above = finger.y - FINGER_CLEARANCE - size.height;
    if (above >= READOUT_EDGE) {
        return {
            left: clamp(
                finger.x - size.width / 2,
                READOUT_EDGE,
                bounds.width - size.width - READOUT_EDGE,
            ),
            top: above,
        };
    }
    const right = finger.x + FINGER_SIDE_CLEARANCE;
    const left =
        right + size.width <= bounds.width - READOUT_EDGE
            ? right
            : finger.x - FINGER_SIDE_CLEARANCE - size.width;
    return {
        left: clamp(
            left,
            READOUT_EDGE,
            bounds.width - size.width - READOUT_EDGE,
        ),
        top: clamp(
            finger.y - size.height / 2,
            READOUT_EDGE,
            bounds.height - size.height - READOUT_EDGE,
        ),
    };
}
