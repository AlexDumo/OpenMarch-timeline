import { useLayoutEffect, useRef, type FocusEvent } from "react";

/**
 * Keeps keyboard focus in a part of the editor whose controls swap (owner feedback on #526): a
 * list typed into the interval turns it into the group menu's button, and removing the last but
 * one group turns that back into the interval. When `key` changes with focus inside, lost because
 * its control went, focus goes to the first number there now, else its first control. Focus moved
 * away on purpose (a click on the field, Tab) stays away. `inside` also counts focus in a portal
 * (the group menu), which React's focus events reach through.
 */
export function useFocusCarry<T extends HTMLElement>(
    key: unknown,
    inside: (el: Element) => boolean = () => false,
) {
    const ref = useRef<T>(null);
    const had = useRef(false);
    useLayoutEffect(() => {
        if (!had.current) return;
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        // A number first (not its − or ≈), else the first control that takes focus
        const el = ref.current;
        // The number's tooltip may wrap it, taking the mark
        const number = el?.querySelector<HTMLElement>("[data-scrub-number]");
        (number?.matches("button")
            ? number
            : (number?.querySelector<HTMLElement>("button") ??
              el?.querySelector<HTMLElement>("button:not(:disabled), input"))
        )?.focus();
        // Only `key` swaps the controls
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    return {
        ref,
        onFocus: () => {
            had.current = true;
        },
        onBlur: (e: FocusEvent) => {
            const next = e.relatedTarget;
            if (next) {
                had.current =
                    !!ref.current?.contains(next) || inside(next as Element);
                return;
            }
            // Nowhere: the control was taken away (keep carrying), or focus left the window or
            // went to the page (stop), told apart once the change is through
            const was = e.target;
            setTimeout(() => {
                if (was.isConnected) had.current = false;
            });
        },
    };
}
