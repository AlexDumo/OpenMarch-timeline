import { create } from "zustand";
import type { PlacedBox } from "./placedBox";

/**
 * Placed boxes and the selection (docs/timeline/research/shapes/07-placed-boxes.md): the box whose
 * members are exactly the selected marchers, if any, and the box you've double-clicked into.
 */
export const useBoxSelectionStore = create<{
    /** The placed box that is selected as a whole */
    readonly selected: PlacedBox | null;
    /** The recipe id of the box you're inside, picking its marchers one by one */
    readonly inside: number | null;
}>(() => ({ selected: null, inside: null }));

export const setInsideBox = (inside: number | null): void =>
    useBoxSelectionStore.setState({ inside });
