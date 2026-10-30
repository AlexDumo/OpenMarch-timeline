import { startGestureKeys, type GestureKeys } from "@/input/gestureKeys";
import type { HeldKeys, RoleKey, Roles } from "@/input/modifierRoles";

/**
 * Starts following one field gesture's held roles (`startGestureKeys` in the
 * "field" context; version A: Shift fine, $mod constrain), calling `changed`
 * when a key pressed or released mid-drag changes them. A gesture starts it
 * once, at its press, and disposes it when it ends or is cancelled.
 */
export type FieldKeys = (changed: (roles: Roles) => void) => GestureKeys;

/**
 * The {@link FieldKeys} of a press: `press` is the pointer-down (a
 * `FieldPointer` carries its keys), `usedByPress` the key a selection choice
 * used (a Shift-press that added the marcher), which is no role until it's
 * released and pressed again.
 */
export function fieldKeys(
    press: HeldKeys,
    {
        usedByPress,
        isMac,
    }: { usedByPress?: readonly RoleKey[]; isMac?: boolean } = {},
): FieldKeys {
    return (changed) =>
        startGestureKeys({
            context: "field",
            press,
            usedByPress,
            isMac,
            onRolesChange: changed,
        });
}
