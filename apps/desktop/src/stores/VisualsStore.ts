import { create } from "zustand";
import type { CueRipple } from "@openmarch/core";
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
/**
 * Copied cues (performer-behavior.md section 7.4): their channel, and each
 * cue's spacing in counts from the first, with everything but its who.
 */
export interface VisualsClipboard {
    channel: VisualsChannel;
    cues: readonly {
        offset: number;
        kind: "state" | "phrase";
        value: string;
        length: number | null;
        transitionLength: number | null;
        settings: Record<string, unknown>;
        ripple: CueRipple | null;
        notes: string | null;
    }[];
}

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
    /** The cues picked on the editable lane, in the order picked. */
    selectedCueIds: readonly number[];
    /** Picks `id`; with `add`, toggles it in the picked cues instead. */
    selectCue(id: number, add?: boolean): void;
    clearSelectedCues(): void;
    /** The copied cues, for pasting onto any who on the same channel. */
    clipboard: VisualsClipboard | null;
    setClipboard(clipboard: VisualsClipboard): void;
    /** Whether the timeline's cue band is folded to its title. */
    bandCollapsed: boolean;
    toggleBandCollapsed(): void;
}

export const useVisualsStore = create<VisualsState>((set) => ({
    channel: "feet",
    // a picked cue is on one channel's lane for one who
    setChannel: (channel) => set({ channel, selectedCueIds: [] }),
    focus: null,
    toggleFocus: (who) =>
        set((state) =>
            sameWho(state.focus, who)
                ? { focus: null, focusMarcherIds: null, selectedCueIds: [] }
                : { focus: who, selectedCueIds: [] },
        ),
    clearFocus: () =>
        set({ focus: null, focusMarcherIds: null, selectedCueIds: [] }),
    focusMarcherIds: null,
    setFocusMarcherIds: (focusMarcherIds) => set({ focusMarcherIds }),
    selectedCueIds: [],
    selectCue: (id, add = false) =>
        set((state) => ({
            selectedCueIds: !add
                ? [id]
                : state.selectedCueIds.includes(id)
                  ? state.selectedCueIds.filter((x) => x !== id)
                  : [...state.selectedCueIds, id],
        })),
    clearSelectedCues: () => set({ selectedCueIds: [] }),
    clipboard: null,
    setClipboard: (clipboard) => set({ clipboard }),
    bandCollapsed: false,
    toggleBandCollapsed: () =>
        set((state) => ({ bandCollapsed: !state.bandCollapsed })),
}));
