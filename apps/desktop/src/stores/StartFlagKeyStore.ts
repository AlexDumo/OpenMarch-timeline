import { create } from "zustand";
import type {
    StartFlagLevels,
    StartFlagPositionsSettings,
} from "@/timeline/startFlagLevels";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";

/** A release of N sooner than this after its press is a tap, which toggles the latch. */
export const START_FLAG_TAP_MS = 250;

/** The N key for start flag positions, right now. Not saved: a restart shows the Always state. */
export interface StartFlagKeyState {
    /** N is down */
    readonly held: boolean;
    /** A quick tap of N turned the Hold N state on until the next tap */
    readonly latched: boolean;
}

interface StartFlagKeyStore extends StartFlagKeyState {
    /** Whether the field draws any start flag position right now, as the field publishes it */
    drawn: boolean;
    setDrawn: (drawn: boolean) => void;
    /** When N went down (`Date.now()`), while held */
    pressedAt: number | null;
    /** N went down; a repeat while held changes nothing */
    press: () => void;
    /** N came up: a tap (under `START_FLAG_TAP_MS`) toggles the latch */
    release: () => void;
    /** The window lost focus while N was down: let go of it without counting a tap */
    blurRelease: () => void;
    /** Turns the latch on or off (the command palette's toggle) */
    toggleLatched: () => void;
}

/** Whether the field shows the Hold N state: while N is held or latched. */
export const isStartFlagHoldActive = (state: StartFlagKeyState): boolean =>
    state.held || state.latched;

/** The levels the field draws: the Hold N state while N is held or latched, else Always. */
export const startFlagLevelsInEffect = (
    settings: StartFlagPositionsSettings,
    state: StartFlagKeyState,
): StartFlagLevels =>
    isStartFlagHoldActive(state) ? settings.hold : settings.always;

/** The N key's transient state for start flag positions (#331). */
export const useStartFlagKeyStore = create<StartFlagKeyStore>((set, get) => ({
    held: false,
    latched: false,
    pressedAt: null,
    drawn: false,
    setDrawn: (drawn) => {
        if (get().drawn !== drawn) set({ drawn });
    },
    press: () => {
        if (get().held) return;
        set({ held: true, pressedAt: Date.now() });
    },
    release: () => {
        const { held, latched, pressedAt } = get();
        if (!held) return;
        const tap =
            pressedAt !== null && Date.now() - pressedAt < START_FLAG_TAP_MS;
        set({
            held: false,
            pressedAt: null,
            latched: tap ? !latched : latched,
        });
    },
    blurRelease: () => {
        if (get().held) set({ held: false, pressedAt: null });
    },
    toggleLatched: () => set((state) => ({ latched: !state.latched })),
}));

/** The start flag positions levels the field draws now. */
export function useStartFlagLevelsInEffect(): StartFlagLevels {
    const settings = useUiSettingsStore((s) => s.uiSettings.startFlagPositions);
    const held = useStartFlagKeyStore((s) => s.held);
    const latched = useStartFlagKeyStore((s) => s.latched);
    return startFlagLevelsInEffect(settings, { held, latched });
}
