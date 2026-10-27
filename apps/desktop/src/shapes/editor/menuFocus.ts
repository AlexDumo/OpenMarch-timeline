import { useId, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { create } from "zustand";
import { keepFocus } from "./keepFocus";

/**
 * The floating editor's one open menu (#437, owner): the mode, layout, Leftover, pivot and seed
 * menus share it, so opening one closes any other. Their popovers don't see a press on another's
 * button as outside them (the editor keeps its presses to itself), so this is what closes them.
 */
const useEditorMenuStore = create<{ open: string | null }>(() => ({
    open: null,
}));

/** A menu of the floating editor's open state, shared so only one is open at a time */
export function useEditorMenu(): [boolean, (open: boolean) => void] {
    const id = useId();
    const open = useEditorMenuStore((s) => s.open === id);
    const setOpen = (next: boolean) => {
        if (next) useEditorMenuStore.setState({ open: id });
        else if (useEditorMenuStore.getState().open === id)
            useEditorMenuStore.setState({ open: null });
    };
    return [open, setOpen];
}

/**
 * Focus for the floating editor's small menus (the pivot, Leftover and the layout, #435). Opened
 * with a press, the menu doesn't take focus, so Enter still places the open shape and the editor
 * can fade (#426). Opened from the keyboard, focus goes into the menu, onto what's picked now
 * (`focusTarget`), and Escape or a pick hands it back to the button.
 */
export function useMenuFocus(
    focusTarget: (content: HTMLElement) => HTMLElement | null,
) {
    /** Whether the menu was last opened, or closed, by a pointer press */
    const pressed = useRef(false);
    /** Whether it was opened from the keyboard: then the menu has the keys it gets */
    const keyboard = useRef(false);
    const content = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    return {
        trigger: {
            ref: button,
            onPointerDown: (e: PointerEvent) => {
                keepFocus(e);
                pressed.current = true;
            },
            onKeyDown: (e: KeyboardEvent) => {
                pressed.current = false;
                // Enter and Space open the menu, and don't also place the shape or play
                if (e.key === "Enter" || e.key === " ") e.stopPropagation();
            },
        },
        content: {
            ref: content,
            onOpenAutoFocus: (e: Event) => {
                e.preventDefault();
                keyboard.current = !pressed.current;
                if (pressed.current) return;
                // Again for a few frames until it holds: as the menu settles, its button's
                // tooltip closing can take the focus back (seen in 1 of 8 browser runs)
                let frames = 6;
                const into = () => {
                    const el = content.current;
                    if (el && !el.contains(document.activeElement))
                        (
                            focusTarget(el) ??
                            el.querySelector<HTMLElement>("button")
                        )?.focus();
                    if (--frames > 0) requestAnimationFrame(into);
                };
                into();
            },
            // Back to the button, found afresh: its tooltip may have drawn it again while open
            onCloseAutoFocus: (e: Event) => {
                e.preventDefault();
                // Not when another menu opening closed it: focus stays with that one
                if (
                    !pressed.current &&
                    useEditorMenuStore.getState().open === null
                )
                    button.current?.focus();
            },
            onPointerDownOutside: () => {
                pressed.current = true;
            },
            onPointerDownCapture: () => {
                pressed.current = true;
            },
            onKeyDownCapture: () => {
                pressed.current = false;
            },
            // Opened from the keyboard, Enter and Space press the focused control and the arrows
            // move in the menu: they don't also reach the app's keys, where Enter places the open
            // shape, Space plays and the arrows nudge marchers. Opened by a press, the keys stay
            // the app's, as before
            onKeyDown: (e: KeyboardEvent) => {
                const keys =
                    e.key === "Enter" ||
                    e.key === " " ||
                    e.key.startsWith("Arrow");
                if (keys && keyboard.current) e.stopPropagation();
            },
        },
    };
}

/**
 * Arrow keys move focus between `items` laid out `columns` wide (1 for a list), without wrapping
 * off the ends. Returns whether it handled the key.
 */
export function arrowFocus(
    e: KeyboardEvent,
    items: readonly HTMLElement[],
    columns = 1,
): boolean {
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return false;
    const by: Record<string, number> = {
        ArrowUp: -columns,
        ArrowDown: columns,
        ...(columns > 1 ? { ArrowLeft: -1, ArrowRight: 1 } : {}),
    };
    const step = by[e.key];
    if (step === undefined) return false;
    e.preventDefault();
    e.stopPropagation();
    const next = items[at + step];
    if (columns > 1 && Math.abs(step) === 1) {
        // Left and right stay on the row
        if (
            !next ||
            Math.floor((at + step) / columns) !== Math.floor(at / columns)
        )
            return true;
    }
    next?.focus();
    return true;
}
