/**
 * PROTOTYPE (design experiment, not for merge): which Facing split variant is on (see
 * `facingSplit.ts`), from `?facingSplit=` or localStorage `openmarch.facingSplitVariant`. No
 * imports beyond React, so the action definitions can read it.
 */
import { useSyncExternalStore } from "react";

export type FacingSplitVariant = "A" | "B" | "C";

const STORAGE_KEY = "openmarch.facingSplitVariant";

function read(): FacingSplitVariant | null {
    try {
        const fromUrl = new URLSearchParams(window.location.search).get(
            "facingSplit",
        );
        const v = (fromUrl ?? localStorage.getItem(STORAGE_KEY) ?? "")
            .trim()
            .toUpperCase();
        return v === "A" || v === "B" || v === "C" ? v : null;
    } catch {
        return null;
    }
}

/** The variant now (for handlers that run outside React) */
export const facingSplitVariant = read;

const subscribe = (onChange: () => void) => {
    window.addEventListener("storage", onChange);
    return () => window.removeEventListener("storage", onChange);
};

/** The variant, re-read when localStorage changes */
export function useFacingSplitVariant(): FacingSplitVariant | null {
    return useSyncExternalStore(subscribe, read, () => null);
}
