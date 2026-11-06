import { create } from "zustand";
import type { FieldModeDrawing } from "./fieldEditor";

/**
 * A drawing under the field mode's own, which isn't that mode's: the closed group path a selected
 * placed box's members walk, under the box's handles (pathways, owner on #683). Set by whoever
 * chooses the field's mode (`useShapeFieldModes`), so the field imports nothing of pathways.
 */
export const useFieldUnderlayStore = create<{
    readonly drawing: FieldModeDrawing | null;
}>(() => ({ drawing: null }));

export function setFieldUnderlay(drawing: FieldModeDrawing | null): void {
    if (useFieldUnderlayStore.getState().drawing !== drawing)
        useFieldUnderlayStore.setState({ drawing });
}
