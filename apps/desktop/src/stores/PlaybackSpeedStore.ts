import { create } from "zustand";

/** The speeds a click on the speed button steps through, in order; it wraps from the last */
export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4] as const;
export const MIN_PLAYBACK_SPEED = 0.1;
export const MAX_PLAYBACK_SPEED = 4;

/** A held speed key: `]` plays at double the speed while held, `[` at half */
export type PlaybackSpeedHold = "faster" | "slower";

interface PlaybackSpeedStore {
    /** The chosen speed, 1 = as written */
    speed: number;
    hold: PlaybackSpeedHold | null;
    setSpeed: (speed: number) => void;
    /** To the next speed in `PLAYBACK_SPEEDS` (or the previous one with `back`) */
    stepSpeed: (back?: boolean) => void;
    setHold: (hold: PlaybackSpeedHold | null) => void;
}

export const clampPlaybackSpeed = (speed: number): number =>
    Math.min(MAX_PLAYBACK_SPEED, Math.max(MIN_PLAYBACK_SPEED, speed));

/** The speed after `speed` in `PLAYBACK_SPEEDS`, or before it with `back`; an off-list speed goes to the nearest one that way */
export function nextPlaybackSpeed(speed: number, back = false): number {
    const list = PLAYBACK_SPEEDS;
    if (back) {
        const lower = [...list].reverse().find((s) => s < speed - 1e-6);
        return lower ?? list[list.length - 1];
    }
    return list.find((s) => s > speed + 1e-6) ?? list[0];
}

/** The speed playing now: the chosen one, doubled or halved while a speed key is held */
export function effectivePlaybackSpeed(state: {
    speed: number;
    hold: PlaybackSpeedHold | null;
}): number {
    if (state.hold === "faster") return clampPlaybackSpeed(state.speed * 2);
    if (state.hold === "slower") return clampPlaybackSpeed(state.speed / 2);
    return state.speed;
}

/** "1×", "0.25×", "1.5×" */
export const formatPlaybackSpeed = (speed: number): string =>
    `${Number(speed.toFixed(2))}×`;

/**
 * Playback speed, like a video player's. Not saved: a show opens at 1×. The audio player, the
 * live clock and the 3D window's clock all read `effectivePlaybackSpeed`.
 */
export const usePlaybackSpeedStore = create<PlaybackSpeedStore>((set) => ({
    speed: 1,
    hold: null,
    setSpeed: (speed) => set({ speed: clampPlaybackSpeed(speed) }),
    stepSpeed: (back) =>
        set((state) => ({ speed: nextPlaybackSpeed(state.speed, back) })),
    setHold: (hold) => set({ hold }),
}));
