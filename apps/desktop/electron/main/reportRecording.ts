/**
 * The report recorder's screen requests (fork #801, #1378). The editor asks
 * for the screen once per open OpenMarch window, naming the window first, and
 * each request is answered with that window's own page: no system picker,
 * never the whole screen or another app. While a recording runs, main tells
 * the editor which windows are open and which has focus, so the video can
 * follow the window in front (`src/feedback/useReportRecording.ts`).
 */
import { app, BrowserWindow, ipcMain, session } from "electron";
import { APP_ORIGIN } from "./appProtocol";
import {
    REPORT_RECORDING_CHANNELS,
    type RecordableWindows,
} from "../../src/feedback/recordingWindows";

interface RecordingOptions {
    getMainWindow: () => BrowserWindow | null;
}

/** OpenMarch's own pages: the packaged app, or the dev server in development. */
function isOwnPage(url: string): boolean {
    const dev = process.env.VITE_DEV_SERVER_URL;
    return url.startsWith(`${APP_ORIGIN}/`) || (!!dev && url.startsWith(dev));
}

/** Windows on screen that show an OpenMarch page; hidden helper windows (exports) aren't. */
function recordableWindows(): BrowserWindow[] {
    return BrowserWindow.getAllWindows().filter(
        (w) =>
            !w.isDestroyed() &&
            !w.webContents.isDestroyed() &&
            w.isVisible() &&
            isOwnPage(w.webContents.getURL()),
    );
}

// eslint-disable-next-line max-lines-per-function -- one handler and its watchers
export function registerReportRecording(options: RecordingOptions) {
    const editor = () => {
        const main = options.getMainWindow();
        return main && !main.isDestroyed() ? main : null;
    };
    const isEditor = (contents: Electron.WebContents) =>
        editor()?.webContents === contents;

    const snapshot = (): RecordableWindows => {
        const main = editor();
        const windows = recordableWindows();
        const focused = BrowserWindow.getFocusedWindow();
        return {
            windows: windows.map((w) => ({
                id: w.id,
                editor: w === main,
                minimized: w.isMinimized(),
            })),
            focusedId: focused && windows.includes(focused) ? focused.id : null,
        };
    };

    // The window the editor's next screen request is for
    let nextTarget: number | null = null;
    let watching = false;
    let sendQueued = false;

    /** Sends one snapshot after the current burst of window events settles */
    const changed = () => {
        if (!watching || sendQueued) return;
        sendQueued = true;
        setTimeout(() => {
            sendQueued = false;
            const main = editor();
            if (watching && main)
                main.webContents.send(
                    REPORT_RECORDING_CHANNELS.windows,
                    snapshot(),
                );
        }, 0);
    };

    const watchWindow = (w: BrowserWindow) => {
        for (const event of [
            "show",
            "hide",
            "minimize",
            "restore",
            "closed",
        ] as const)
            w.on(event as "show", changed);
        // A new window's page loads after it's created
        w.webContents.on("did-finish-load", changed);
    };
    app.on("browser-window-created", (_e, w) => watchWindow(w));
    app.on("browser-window-focus", changed);
    app.on("browser-window-blur", changed);
    void app
        .whenReady()
        .then(() => BrowserWindow.getAllWindows().forEach(watchWindow));

    ipcMain.handle(REPORT_RECORDING_CHANNELS.watch, (event) => {
        if (!isEditor(event.sender)) return null;
        watching = true;
        return snapshot();
    });
    ipcMain.on(REPORT_RECORDING_CHANNELS.unwatch, (event) => {
        if (isEditor(event.sender)) watching = false;
    });
    ipcMain.handle(
        REPORT_RECORDING_CHANNELS.target,
        (event, windowId: unknown) => {
            if (!isEditor(event.sender)) return false;
            const known = recordableWindows().some((w) => w.id === windowId);
            nextTarget = known ? (windowId as number) : null;
            return known;
        },
    );

    // Only the editor's own requests are answered, each with one OpenMarch
    // window's page (the editor unless it named another). Every other
    // request is refused, as before this handler existed.
    void app.whenReady().then(() =>
        session.defaultSession.setDisplayMediaRequestHandler(
            (request, callback) => {
                const main = editor();
                const target = nextTarget;
                nextTarget = null;
                if (
                    !main ||
                    request.frame?.top !== main.webContents.mainFrame
                ) {
                    callback({});
                    return;
                }
                const window =
                    recordableWindows().find((w) => w.id === target) ?? main;
                callback({ video: window.webContents.mainFrame });
            },
        ),
    );
}
