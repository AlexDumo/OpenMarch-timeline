import { useMemo } from "react";
import { parseBinding, formatBindingKeys } from "@/shortcuts/bindings";
import type { ActionId } from "@/shortcuts/definitions";
import { getDisplayBindings, type ShortcutOverrides } from "@/shortcuts/keymap";
import { isMacPlatform } from "@/shortcuts/platform";
import { useShortcutOverridesStore } from "@/stores/ShortcutOverridesStore";
import type { TransportShortcuts } from "./TransportButtons";

/** The action behind each transport shortcut */
const TRANSPORT_ACTIONS = {
    previousPage: "previousPage",
    nextPage: "nextPage",
    firstPage: "firstPage",
    lastPage: "lastPage",
    previousBeat: "previousBeat",
    nextBeat: "nextBeat",
    play: "playPause",
    playPage: "playPage",
    playOn: "playOn",
    loop: "toggleLoop",
    fit: "timelineFit",
} as const satisfies Record<keyof TransportShortcuts, ActionId>;

/**
 * A binding as the transport's tooltips write it: words joined with " + " ("Shift + Space"), with
 * Cmd and Option on a Mac (`ariaKeyShortcut` turns it into ARIA's names)
 */
export const transportKeys = (binding: string, isMac: boolean): string => {
    const words = {
        $mod: isMac ? "Cmd" : "Ctrl",
        Control: "Ctrl",
        Meta: isMac ? "Cmd" : "Win",
        Alt: isMac ? "Option" : "Alt",
        Shift: "Shift",
    };
    const { modifiers } = parseBinding(binding);
    const key = formatBindingKeys(binding, false).at(-1)!;
    return [...modifiers.map((m) => words[m]), key].join(" + ");
};

/** Each transport shortcut's first binding as the user has them; undefined when unbound */
export const transportShortcuts = (
    overrides: ShortcutOverrides,
    isMac: boolean = isMacPlatform(),
): TransportShortcuts => {
    const entries = Object.entries(TRANSPORT_ACTIONS).map(([name, id]) => {
        const [binding] = getDisplayBindings(id, overrides, isMac);
        return [name, binding && transportKeys(binding, isMac)];
    });
    return Object.fromEntries(entries) as TransportShortcuts;
};

/** The transport's shortcuts, following the user's changed shortcuts (`ShortcutOverridesStore`) */
export function useTransportShortcuts(): TransportShortcuts {
    const overrides = useShortcutOverridesStore((s) => s.overrides);
    return useMemo(() => transportShortcuts(overrides), [overrides]);
}

/** The go-to box's keys as the user has them, at most two ("G or Cmd + G"); "" when unbound */
export function useGoToKeys(): string {
    const overrides = useShortcutOverridesStore((s) => s.overrides);
    return useMemo(() => {
        const isMac = isMacPlatform();
        return getDisplayBindings("timelineGoTo", overrides, isMac)
            .slice(0, 2)
            .map((binding) => transportKeys(binding, isMac))
            .join(" or ");
    }, [overrides]);
}
