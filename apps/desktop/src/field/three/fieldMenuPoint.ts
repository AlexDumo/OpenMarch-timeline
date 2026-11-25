import { create } from "zustand";

/**
 * Where on the field the field's menu was opened, in field units: the right-click or long press
 * that opened it. Null while it's closed, and when it was opened from the keyboard, which points
 * at nothing. Entries about a place on the field (a placed line's Split here, #1336) read it.
 */
export const useFieldMenuPointStore = create<{
    readonly at: { readonly x: number; readonly y: number } | null;
}>(() => ({ at: null }));
