import { onScreenRoles } from "@/stores/TouchModifierStore";

type ModifierEvent = { shiftKey?: boolean } | undefined;

/**
 * Whether snapping to steps (coordinate rounding, line snapping, 15° rotation
 * steps) is off for this move. Fine turns it off (version A: Shift, or the
 * pill's Fine on a tablet). The Snap toggle turns it off for every drag.
 *
 * The keyboard Alt key is not read here: with a mouse it pans the field.
 */
export const isSnapOff = (event?: ModifierEvent): boolean =>
    Boolean(event?.shiftKey) || onScreenRoles().has("fine");
