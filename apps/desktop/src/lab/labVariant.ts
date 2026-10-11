import { create } from "zustand";

/**
 * TEMPORARY, fork-only (see apps/desktop/web/README.md, "Comparing versions"). A lab test can
 * build two or more versions of a behavior into one test build. Testers switch between them from
 * the test build's toolbar, without reloading, so they compare them on the same show.
 *
 * Code reads the version with `useLabVariant()` in components or `getLabVariant()` elsewhere. It
 * is `null` outside a lab test build with versions, which means the app's current behavior.
 *
 * Don't carry a version switch into a pull request for OpenMarch's `main`: keep the version that
 * won and remove the others.
 */
interface LabVariantState {
    /** The `id` of the version being tried, from the test's manifest, or null */
    readonly variant: string | null;
    readonly setVariant: (variant: string | null) => void;
}

export const useLabVariantStore = create<LabVariantState>()((set) => ({
    variant: null,
    setVariant: (variant) => set({ variant }),
}));

export const getLabVariant = (): string | null =>
    useLabVariantStore.getState().variant;

export const useLabVariant = (): string | null =>
    useLabVariantStore((state) => state.variant);
