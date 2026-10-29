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
 * A binding as the transport's tooltips write it: words joined with " + " ("Shift + Space"), so
 * the button's ARIA shortcut can be read from it. Alt stays "Alt"; the guides say "Option" on a Mac.
 */
export const transportKeys = (binding: string, isMac: boolean): string => {
    const words = {
        $mod: isMac ? "Cmd" : "Ctrl",
        Control: "Ctrl",
        Meta: isMac ? "Cmd" : "Win",
        Alt: "Alt",
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
