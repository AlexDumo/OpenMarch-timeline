import { create } from "zustand";

/**
 * Whether the welcome flow is on screen. Other first-run prompts (the web
 * build's welcome modal) wait until it isn't.
 */
export const useWelcomeFlowStore = create<{
    showing: boolean;
    setShowing: (showing: boolean) => void;
}>((set) => ({
    showing: false,
    setShowing: (showing) => set({ showing }),
}));
