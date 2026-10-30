import {
    useGestureChipStore,
    type GestureChipScreen,
    type HonoredRoles,
} from "./gestureChipStore";
import type { Roles } from "./modifierRoles";

/** Keeps the field chip in step with a drag's held roles and pointer; the first call shows it */
export function syncGestureChip(
    honored: HonoredRoles,
    roles: Roles,
    screen: GestureChipScreen | undefined,
): void {
    const store = useGestureChipStore.getState();
    if (store.active) store.follow(roles, screen);
    else if (screen) store.show(honored, roles, screen);
}

export function clearGestureChip(): void {
    useGestureChipStore.getState().clear();
}

/** Whether a role the drag honors is held, so the chip has something to name */
export function holdsHonored(honored: HonoredRoles, roles: Roles): boolean {
    return (
        (roles.fine && honored.fine !== undefined) ||
        (roles.constrain && honored.constrain !== undefined) ||
        (roles.fromCenter && honored.fromCenter !== undefined)
    );
}
