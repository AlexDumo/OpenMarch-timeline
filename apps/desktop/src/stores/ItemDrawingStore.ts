import { create } from "zustand";
import type { OutlineType } from "@/db-functions/items";

/** The Outline being drawn on the canvas to create a prop, or null when not drawing. */
export type ItemDrawingMode = OutlineType | null;

type ItemDrawingStore = {
    drawingMode: ItemDrawingMode;
    setDrawingMode: (mode: ItemDrawingMode) => void;
    resetDrawingState: () => void;
};

export const useItemDrawingStore = create<ItemDrawingStore>((set) => ({
    drawingMode: null,
    setDrawingMode: (mode) => set({ drawingMode: mode }),
    resetDrawingState: () => set({ drawingMode: null }),
}));
