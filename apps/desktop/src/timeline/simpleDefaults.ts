import { useSyncExternalStore } from "react";

/**
 * TEMPORARY study flag (2026-10-12, docs/timeline/research/basic-mode, "One timeline, simple by
 * default"): the full timeline with simple defaults, compared with Basic mode in
 * ~/ux-sim/basic-vs-simple. With it on, outside Basic:
 *
 * - an edit with the start flag unpinned writes where each marcher is at the playhead inside its
 *   page, splitting its move there (Basic's point writer); marchers whose moves there already
 *   cross a flag or overlap get the window edit instead, so nothing locks;
 * - moves inside one page show as ticks, not clips; clips are for moves that cross a flag or
 *   overlap.
 *
 * Read from localStorage `openmarch.simpleDefaults` ("on"); becomes the default or goes away
 * once the study decides.
 */
const KEY = "openmarch.simpleDefaults";

export function simpleDefaultsOn(): boolean {
    try {
        return localStorage.getItem(KEY) === "on";
    } catch {
        return false;
    }
}

const subscribe = (onChange: () => void) => {
    window.addEventListener("storage", onChange);
    return () => window.removeEventListener("storage", onChange);
};

/** `simpleDefaultsOn` as a hook */
export function useSimpleDefaults(): boolean {
    return useSyncExternalStore(subscribe, simpleDefaultsOn, () => false);
}
