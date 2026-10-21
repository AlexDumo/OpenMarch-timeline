/**
 * PROTOTYPE (tempo mode, branch tempo/track-proto): whether the timeline is in tempo mode. Its
 * own module, so the app's layout can read it without loading the tempo lanes.
 */
import { create } from "zustand";

/** Whether the timeline is in tempo mode */
export const useTempoModeStore = create<{
    on: boolean;
    toggle: () => void;
    setOn: (on: boolean) => void;
}>((set) => ({
    on: false,
    toggle: () => set((s) => ({ on: !s.on })),
    setOn: (on) => set({ on }),
}));
