import type { KeyboardEvent } from "react";

/**
 * Keeps a key pressed in the line menu or the line popover (#824) from reaching the app's
 * shortcuts, so Tab, Enter, Space, the arrows, Delete and letters do what the focused control
 * does there (move focus, press it, type) rather than walk, hide or delete lines, or play the
 * show. Chords with Ctrl or ⌘ (undo, save, the palette) and the F keys (F6 moves between the
 * mode's panes) still reach them. Call it last in the container's `onKeyDown`: it doesn't
 * prevent the control's own handling.
 */
export function keepKeysInside(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey) return;
    if (/^F\d{1,2}$/.test(event.key)) return;
    event.stopPropagation();
}

/** Gives the keyboard back to the field when a menu or popover inside it closes */
export function returnFocusToField(from: Element | null) {
    from?.closest<HTMLElement>("[data-field-edit-overlay]")?.focus({
        preventScroll: true,
    });
}
