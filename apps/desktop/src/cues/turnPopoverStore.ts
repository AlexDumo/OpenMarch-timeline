import { create } from "zustand";

/**
 * The Facing turn popover (fork #993): which cue's turn it edits, or null when closed. The Facing
 * lane draws it at that cue's bar; double-clicking a turn and Edit turn… open it.
 */
export const useTurnPopoverStore = create<{
    readonly cueId: number | null;
    readonly open: (cueId: number) => void;
    readonly close: () => void;
}>((set) => ({
    cueId: null,
    open: (cueId) => set({ cueId }),
    close: () => set({ cueId: null }),
}));

/**
 * The field's side names (`SideDescriptions`: "Side 1", or "Stage right" on a stage), for the
 * Facing menus that can't read the field themselves. The cue action handlers keep it current.
 */
export const useSideNamesStore = create<{
    readonly side1: string | null;
    readonly side2: string | null;
}>(() => ({ side1: null, side2: null }));
