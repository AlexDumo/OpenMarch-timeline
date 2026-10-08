/**
 * Guards for the timeline's raw window key listeners (G, Shift+Z, Esc), which sit outside the
 * app's registered keyboard actions and so must check for themselves what owns the key.
 */

/**
 * A popover, menu or dialog is open: its keys (Esc above all) are its own, and nothing else's.
 * Tooltips share Radix's popper wrapper but take no keys, so a hovered tooltip doesn't count.
 */
export const overlayOpen = () =>
    Array.from(
        document.querySelectorAll("[data-radix-popper-content-wrapper]"),
    ).some((wrapper) => wrapper.querySelector('[role="tooltip"]') === null) ||
    document.querySelector(
        '[role="menu"], [role="dialog"][data-state="open"], [role="alertdialog"]',
    ) !== null;

/** The key goes to a text field */
export const isTyping = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Space always plays (docs/timeline/ui.md UI-14, round-2 review): on the move controls (a clip,
 * its ⋯ button, the Move card, the isolation bar) Space doesn't also press the focused button or
 * radio. Its default (a click on key up) is cancelled on key down and key up; the key still goes
 * on to the app's Play shortcut. Text fields keep their Space. For `onKeyDown` and `onKeyUp`.
 */
export const spaceStaysPlay = (event: {
    readonly key: string;
    readonly target: EventTarget | null;
    preventDefault: () => void;
}) => {
    if (event.key === " " && !isTyping(event.target)) event.preventDefault();
};

/**
 * Whether a key belongs to the focused timeline move control (UI-14 round-2 review): on a clip,
 * its ⋯ button or name field, the Move card or the isolation bar (`data-timeline-own-keys`),
 * Enter activates the control and the arrows (and WASD) work it or do nothing, as anywhere else on
 * a web page. The app's registered shortcuts skip these keys there: Enter would create a shape,
 * the arrows and WASD would nudge the selected marchers unseen. Space isn't one: it still plays.
 */
export const isTimelineOwnKey = (
    event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">,
    focused: Element | null,
): boolean =>
    focused?.closest("[data-timeline-own-keys]") != null &&
    (event.key === "Enter" ||
        event.key.startsWith("Arrow") ||
        (/^[wasd]$/i.test(event.key) &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey));
