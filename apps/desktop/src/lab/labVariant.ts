import { create } from "zustand";

/**
 * TEMPORARY, fork-only (the lab's "versions in one build", from fork PR #125). A lab test can
 * build two or more versions of a behavior into one test build and link each with `?variant=` in
 * the URL. When the test's manifest lists `variants`, the build's toolbar has a Version switch
 * (`web/variants.ts`) that sets it without reloading. The lab's feedback records the page's URL,
 * so it says which version was on.
 *
 * Code reads the version with `useLabVariant()` in components or `getLabVariant()` elsewhere. It
 * is `null` with no `variant` in the URL, which means the app's current behavior.
 *
 * Don't carry a version switch into a pull request for OpenMarch's `main`: keep the version that
 * won and remove the others.
 */
interface LabVariantState {
    /** The version being tried, from the URL's `variant`, or null */
    readonly variant: string | null;
    readonly setVariant: (variant: string | null) => void;
}

const fromUrl = (): string | null => {
    try {
        return new URLSearchParams(window.location.search).get("variant");
    } catch {
        return null;
    }
};

export const useLabVariantStore = create<LabVariantState>()((set) => ({
    variant: typeof window === "undefined" ? null : fromUrl(),
    setVariant: (variant) => {
        set({ variant });
        // A reload keeps it, and feedback filed now records it
        try {
            const url = new URL(window.location.href);
            if (variant === null) url.searchParams.delete("variant");
            else url.searchParams.set("variant", variant);
            window.history.replaceState(window.history.state, "", url);
        } catch {
            // No window (tests)
        }
    },
}));

export const getLabVariant = (): string | null =>
    useLabVariantStore.getState().variant;

export const useLabVariant = (): string | null =>
    useLabVariantStore((state) => state.variant);
