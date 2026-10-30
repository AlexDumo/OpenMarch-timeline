import { isAltHeld, isShiftHeld } from "@/stores/TouchModifierStore";

type ModifierEvent = { shiftKey?: boolean; altKey?: boolean } | undefined;

/**
 * Whether coordinate-rounding snap is off for this move. Fine (Shift, or the
 * on-screen Shift button while dragging) drops the grid; the on-screen "No
 * snap" button does too. The Snap toggle is separate ({@link MoveRules.snap}).
 *
 * Keyboard Alt is not read here: with a mouse it pans the field.
 */
export const isSnapOff = (event?: ModifierEvent): boolean =>
    isShiftHeld(event) || isAltHeld(undefined);
