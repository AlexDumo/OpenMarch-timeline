/**
 * Following a performer in the 3D View: the contract between the overlay
 * (`overlay/CameraBar.tsx`) and the camera rig (`CameraRig.tsx`).
 *
 * - `picking` and `setPicking(on)`: pick-a-performer. While on, the canvas
 *   shows a crosshair and the next click on a performer follows them; the
 *   rig turns it off after one pick or on Esc. Turning it on ends
 *   pick-a-seat, and pick-a-seat turning on ends this.
 * - `follow`: who the camera follows and how, or null for none.
 *   `"third"` keeps the camera behind them as they move (orbit and zoom
 *   still work around them); `"pov"` looks out of their eyes (drag looks
 *   around, scroll zooms).
 * - `followMarcher(id, mode)`, `setMode(mode)`, `toggleMode()` and `stop()`
 *   change it. `backOut()` is Esc: the point of view goes back to the
 *   third-person view, the third-person view stops following.
 *
 * The rig ends following on its own when the viewer pans, double-clicks,
 * picks a seat, chooses a camera, turns on the Director or changes venue, and
 * when the performer is gone from the show.
 *
 * `hiddenMarcherId` (rig only) is the performer whose body the scene leaves
 * out, so the point of view doesn't look out through their head.
 */
import { create } from "zustand";

export type FollowMode = "third" | "pov";

export interface Follow {
    marcherId: number;
    mode: FollowMode;
}

export interface FollowState {
    picking: boolean;
    setPicking: (on: boolean) => void;
    follow: Follow | null;
    followMarcher: (marcherId: number, mode?: FollowMode) => void;
    setMode: (mode: FollowMode) => void;
    toggleMode: () => void;
    stop: () => void;
    /** Esc: the point of view backs out to the third-person view, which stops. True when it did something. */
    backOut: () => boolean;
    hiddenMarcherId: number | null;
    /** Rig only. */
    _setHidden: (marcherId: number | null) => void;
}

export const useFollowStore = create<FollowState>()((set, get) => ({
    picking: false,
    setPicking: (on) => set({ picking: on }),
    follow: null,
    followMarcher: (marcherId, mode = "third") =>
        set({ follow: { marcherId, mode }, picking: false }),
    setMode: (mode) => {
        const { follow } = get();
        if (!follow || follow.mode === mode) return;
        set({ follow: { ...follow, mode } });
    },
    toggleMode: () => {
        const { follow } = get();
        if (!follow) return;
        get().setMode(follow.mode === "pov" ? "third" : "pov");
    },
    stop: () => {
        if (get().follow) set({ follow: null });
    },
    backOut: () => {
        const { follow } = get();
        if (!follow) return false;
        if (follow.mode === "pov") get().setMode("third");
        else get().stop();
        return true;
    },
    hiddenMarcherId: null,
    _setHidden: (marcherId) => {
        if (get().hiddenMarcherId !== marcherId)
            set({ hiddenMarcherId: marcherId });
    },
}));

/** The key that starts picking a performer to follow, and stops following. */
export const FOLLOW_KEY = "P";
/** The key that switches between the third-person view and the point of view. */
export const POV_KEY = "V";
