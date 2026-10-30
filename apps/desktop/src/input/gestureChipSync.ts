import {
    useGestureChipStore,
    type GestureChipScreen,
} from "./gestureChipStore";
import type { Roles } from "./modifierRoles";

/** Keeps the field chip in step with a drag's held roles and pointer. */
export function syncGestureChip(
    roles: Roles,
    {
        dragging,
        constrainWord,
        screen,
    }: {
        dragging: boolean;
        constrainWord?: string;
        screen?: GestureChipScreen;
    },
): void {
    if (!dragging) return;
    const store = useGestureChipStore.getState();
    const payload = { roles, constrainWord, screen };
    if (store.active) store.update(payload);
    else store.show(payload);
}

export function clearGestureChip(): void {
    useGestureChipStore.getState().clear();
}
