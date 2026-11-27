/**
 * Which OpenMarch window a report recording shows (fork #1378). The desktop
 * recorder captures every open OpenMarch window and the video follows the
 * one in front; main sends the editor a snapshot of the windows whenever one
 * opens, closes, hides or takes focus (`electron/main/reportRecording.ts`).
 * Pure, so main, the editor and Vitest can all load it.
 */

export const REPORT_RECORDING_CHANNELS = {
    /** Editor → main (invoke): start sending window snapshots; returns the first */
    watch: "report-recording:watch",
    /** Editor → main (send): stop sending window snapshots */
    unwatch: "report-recording:unwatch",
    /** Editor → main (invoke): the window the next screen request should get */
    target: "report-recording:target",
    /** Main → editor: the windows changed */
    windows: "report-recording:windows",
} as const;

export interface RecordableWindow {
    /** `BrowserWindow.id` */
    readonly id: number;
    /** The editor, which holds the recorder */
    readonly editor: boolean;
    /** Minimized windows draw nothing new, so they aren't shown */
    readonly minimized: boolean;
}

export interface RecordableWindows {
    /** OpenMarch's visible windows, nothing else on screen */
    readonly windows: readonly RecordableWindow[];
    /** The OpenMarch window with focus; null while another app is in front */
    readonly focusedId: number | null;
}

/**
 * The window the video shows: the focused one; while another app is in
 * front, the one shown before; when that is minimized or gone, the editor or
 * any other window still on screen. Null when every window is minimized.
 */
export function chooseShownWindow(
    snapshot: RecordableWindows,
    previous: number | null,
): number | null {
    const onScreen = snapshot.windows.filter((w) => !w.minimized);
    const has = (id: number | null) =>
        id !== null && onScreen.some((w) => w.id === id);
    if (has(snapshot.focusedId)) return snapshot.focusedId;
    if (has(previous)) return previous;
    return (onScreen.find((w) => w.editor) ?? onScreen[0])?.id ?? null;
}

/** Where a window's picture goes in the video: as large as fits, centred, aspect kept. */
export function fitInside(
    source: { readonly width: number; readonly height: number },
    frame: { readonly width: number; readonly height: number },
): { x: number; y: number; width: number; height: number } {
    const scale = Math.min(
        frame.width / source.width,
        frame.height / source.height,
    );
    const width = Math.round(source.width * scale);
    const height = Math.round(source.height * scale);
    return {
        x: Math.round((frame.width - width) / 2),
        y: Math.round((frame.height - height) / 2),
        width,
        height,
    };
}

/** The video's size: the editor's picture, no larger than 1920 × 1080, in even pixels for the encoder. */
export function videoSize(editor: {
    readonly width: number;
    readonly height: number;
}): { width: number; height: number } {
    const scale = Math.min(1, 1920 / editor.width, 1080 / editor.height);
    const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
    return { width: even(editor.width), height: even(editor.height) };
}
