import { getEffectiveBindings, type ShortcutOverrides } from "./keymap";

/**
 * The play keys (docs/timeline/ui.md UI-22). Both play from the start flag. While playing, one
 * stops (the playhead goes to the end flag, `playStop`) and the other pauses on the nearest beat
 * (`playPause`). By default Space stops and Shift+Space pauses; Settings swaps them, which is
 * stored as the two actions' bindings, so the shortcut list and the setting always agree.
 */
export const PLAY_KEYS = { space: "Space", shiftSpace: "Shift+Space" } as const;

/** What Space does while playing, by the play actions' bindings now */
export function spacePlayKey(overrides: ShortcutOverrides): "stop" | "pause" {
    return getEffectiveBindings("playPause", overrides).includes(
        PLAY_KEYS.space,
    ) && !getEffectiveBindings("playStop", overrides).includes(PLAY_KEYS.space)
        ? "pause"
        : "stop";
}

/**
 * The overrides with Space set to stop or pause, and Shift+Space to the other. Stop on Space is
 * the default, so it drops both actions' overrides.
 */
export function withSpacePlayKey(
    overrides: ShortcutOverrides,
    space: "stop" | "pause",
): ShortcutOverrides {
    const { playStop: _stop, playPause: _pause, ...rest } = overrides;
    return space === "stop"
        ? rest
        : {
              ...rest,
              playStop: [PLAY_KEYS.shiftSpace],
              playPause: [PLAY_KEYS.space],
          };
}
