import { create } from "zustand";
import { usePreviewModeStore } from "./PreviewModeStore";

/**
 * **Edit move** (docs/timeline/ui.md UI-14) asks the inspector to show the move's Move card: it
 * leaves Preview, where the inspector is hidden, and records the move, so its card, once the
 * window resolves to it, takes the request (`clear`), puts focus on its heading, scrolls into view
 * and flashes. The card sits above the Timeline section, so that section's open state is left
 * as it is.
 */
interface MoveCardRevealState {
    /** The stored timeline whose Move card should come into view, or `null` */
    readonly pending: number | null;
    readonly reveal: (timelineId: number) => void;
    readonly clear: () => void;
}

export const useMoveCardRevealStore = create<MoveCardRevealState>((set) => ({
    pending: null,
    reveal: (timelineId) => {
        usePreviewModeStore.getState().setPreview(false);
        set({ pending: timelineId });
    },
    clear: () => set({ pending: null }),
}));
