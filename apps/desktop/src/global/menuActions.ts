/**
 * The app menu's playback and help items (UI-17 follow-up; docs/adr/0003-menu-actions-ipc.md).
 * The main process builds menu items from this list and sends the chosen item's `action` on
 * `MENU_ACTION_CHANNEL`; the renderer runs the action of that name, and nothing
 * outside this list. Shared by the main process, the preload and the renderer, so it imports
 * nothing.
 */
export const MENU_ACTION_CHANNEL = "menu:action";

export interface MenuAction {
    /** An action id (`shortcuts/definitions.ts`) */
    readonly action: string;
    readonly label: string;
    /**
     * The shortcut, in Electron's accelerator form; empty for none. The menu only shows it: the
     * renderer's own keyboard handler owns the key, so text fields keep Space and letters
     */
    readonly accelerator: string;
}

export const PLAYBACK_MENU_ACTIONS: readonly MenuAction[] = [
    // UI-22: the accelerators are the defaults; Settings can swap Space and Shift+Space, which
    // the menu, built once by the main process, doesn't show
    { action: "playStop", label: "Play / Stop", accelerator: "Space" },
    { action: "playPause", label: "Play / Pause", accelerator: "Shift+Space" },
    { action: "stopPlayback", label: "Stop at End Flag", accelerator: "." },
    { action: "toggleLoop", label: "Loop On / Off", accelerator: "C" },
];

export const HELP_MENU_ACTIONS: readonly MenuAction[] = [
    {
        action: "showShortcuts",
        label: "Keyboard Shortcuts",
        accelerator: "Shift+/",
    },
];

/** Whether `action` is one the menu may send */
export const isMenuAction = (action: unknown): action is string =>
    typeof action === "string" &&
    [...PLAYBACK_MENU_ACTIONS, ...HELP_MENU_ACTIONS].some(
        (item) => item.action === action,
    );
