import { create } from "zustand";
import {
    sameWho,
    type VisualsChannel,
    type VisualsWho,
} from "@/components/visuals/visualsWho";

/**
 * Visuals mode's own state (performer-behavior.md section 7.1): the
 * channel tab, and the focused who, whose marchers the field keeps lit
 * while everyone else dims.
 */
interface VisualsState {
    channel: VisualsChannel;
    setChannel(channel: VisualsChannel): void;
    /** The focused who, or null for none. */
    focus: VisualsWho | null;
    /** Focuses `who`; focusing the focused who again clears the focus. */
    toggleFocus(who: VisualsWho): void;
    clearFocus(): void;
    /**
     * The focused who's marchers, kept current by `useVisualsFocusSync` as
     * the show and the selection change; null with no focus.
     */
    focusMarcherIds: ReadonlySet<number> | null;
    setFocusMarcherIds(ids: ReadonlySet<number> | null): void;
}

export const useVisualsStore = create<VisualsState>((set) => ({
    channel: "feet",
    setChannel: (channel) => set({ channel }),
    focus: null,
    toggleFocus: (who) =>
        set((state) =>
            sameWho(state.focus, who)
                ? { focus: null, focusMarcherIds: null }
                : { focus: who },
        ),
    clearFocus: () => set({ focus: null, focusMarcherIds: null }),
    focusMarcherIds: null,
    setFocusMarcherIds: (focusMarcherIds) => set({ focusMarcherIds }),
}));
