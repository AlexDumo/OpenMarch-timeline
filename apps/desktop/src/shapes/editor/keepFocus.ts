/**
 * For a shape control's `onPointerDown`: a press on it doesn't move focus to it, so Enter still
 * places the open shape and Escape still cancels it, rather than pressing the last button clicked
 * again. The floating editor, the Transform section and ☆ Save use it.
 */
export const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();
