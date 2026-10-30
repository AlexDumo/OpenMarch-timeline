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
    /** Whether a click on a member selects its box (`useBoxSelection`) */
    readonly enabled: boolean;
}>(() => ({ selected: null, inside: null, enabled: false }));

export const setInsideBox = (inside: number | null): void =>
    useBoxSelectionStore.setState({ inside });

/**
 * The selected box as a number in its floating editor is being dragged, before it's saved on
 * release; null otherwise. The field draws it live.
 */
export const usePlacedBoxPreviewStore = create<{
    readonly params: unknown;
}>(() => ({ params: null }));

export const previewPlacedBox = (params: unknown): void =>
    usePlacedBoxPreviewStore.setState({ params });

/**
 * A selected placed shape while its edits are being saved (`commitBox`): the shape as the last of
 * them will read it back, null with none going. Until then it's the box selected, so the shape
 * doesn't jump back to where it was, and a press or a key goes on from the edit (a second drag
 * right after the first used to start from the old shape and drop the first).
 */
export const useSavingBoxStore = create<{
    readonly box: PlacedBox | null;
}>(() => ({ box: null }));
