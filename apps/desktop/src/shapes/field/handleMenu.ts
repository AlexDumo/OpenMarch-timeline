import { create } from "zustand";
import type { ShapeTarget } from "../frame/gestures";
import type { AnyToolKind, ToolMenuSection } from "../tool/toolKind";
import type { XY } from "../types";

/** A shape handle's right-click menu, open (#569) */
export interface OpenHandleMenu {
    /** Where it opens, in CSS pixels in the field's element */
    readonly at: XY;
    /** The handle it's for */
    readonly key: string;
    readonly sections: readonly ToolMenuSection[];
    /** Picks an entry, on the shape it was opened on */
    pick(value: string): void;
}

/** The handle menu open on the field, or null */
export const useHandleMenuStore = create<{ menu: OpenHandleMenu | null }>(
    () => ({ menu: null }),
);

export const closeHandleMenu = (): void =>
    useHandleMenuStore.setState({ menu: null });

/**
 * Opens the menu of the handle a right-click at `at` landed on, when it's a handle whose kind has
 * one (`ToolKind.menu`); says whether it did. `pick` applies an entry picked to handle `key`.
 */
export function openHandleMenu(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    target: ShapeTarget | { type: "draw" } | null,
    at: XY,
    pick: (key: string, value: string) => void,
): boolean {
    if (target?.type !== "handle" || params === null) return false;
    const { key } = target;
    const sections = kind.menu?.sections(params, n, key);
    if (!sections?.some((s) => s.items.length > 0)) return false;
    useHandleMenuStore.setState({
        menu: { at, key, sections, pick: (value) => pick(key, value) },
    });
    return true;
}
