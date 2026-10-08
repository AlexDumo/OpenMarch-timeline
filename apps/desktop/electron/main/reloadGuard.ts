/**
 * No reload while a file converts on open (P9.9). A reload would drop the
 * "Preparing your file…" overlay and load the page against a file the worker
 * is converting (its SQL is refused until the open ends). Apart from Electron
 * so tests can drive it.
 */
import { conversionInProgress } from "./convertWorkerHost";

/** The parts of Electron's `Input` (`before-input-event`) the guard reads. */
export interface KeyInput {
    type: string;
    key: string;
    meta: boolean;
    control: boolean;
    alt: boolean;
}

/** Cmd/Ctrl+R, Cmd/Ctrl+Shift+R, F5 and Ctrl+F5: the keys that reload the page. */
export function isReloadShortcut(input: KeyInput): boolean {
    if (input.type !== "keyDown") return false;
    if (input.key === "F5") return true;
    return (
        (input.meta || input.control) &&
        !input.alt &&
        input.key.toLowerCase() === "r"
    );
}

/**
 * For the main window's `before-input-event`: swallows a reload shortcut
 * while a conversion is in progress, before the page or the menu sees it.
 */
export function blockReloadWhileConverting(
    event: { preventDefault(): void },
    input: KeyInput,
): boolean {
    if (!conversionInProgress() || !isReloadShortcut(input)) return false;
    event.preventDefault();
    return true;
}

/** The parts of `webContents` the View menu's reload items use. */
export interface ReloadTarget {
    reload(): void;
    reloadIgnoringCache(): void;
}

/** View > Reload and Force Reload: do nothing while a conversion is in progress. */
export function reloadUnlessConverting(
    webContents: ReloadTarget | undefined,
    ignoreCache: boolean,
): boolean {
    if (!webContents || conversionInProgress()) return false;
    if (ignoreCache) webContents.reloadIgnoringCache();
    else webContents.reload();
    return true;
}
