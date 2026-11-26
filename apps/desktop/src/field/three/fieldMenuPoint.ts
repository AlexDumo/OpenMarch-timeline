import { create } from "zustand";
import type { PointerKind } from "@/field/editor/pointerThresholds";

/**
 * Where on the field the field's menu was opened, in field units: the right-click or long press
 * that opened it. Null while it's closed, and when it was opened from the keyboard, which points
 * at nothing. Entries about a place on the field (a placed line's Split here, #1336) read it, with
 * what pressed there: a finger's long press reaches further than a mouse's right-click.
 */
export const useFieldMenuPointStore = create<{
    readonly at: { readonly x: number; readonly y: number } | null;
    readonly kind: PointerKind;
}>(() => ({ at: null, kind: "mouse" }));
