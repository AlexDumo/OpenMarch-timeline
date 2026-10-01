/* eslint-disable no-console */
/**
 * The native dialogs and the "preparing your file" window for convert on open
 * (P9.3). All of them belong to the main process, so no IPC channel is added.
 * The text is English only, like the other main-process dialogs; translating
 * it is left for when P9.4 makes the step permanent.
 */
import { BrowserWindow, dialog, shell } from "electron";
import { captureException } from "@sentry/electron/main";
import type { ConvertOnOpenDialogs } from "./convertOnOpenFlow";

const escapeHtml = (s: string) =>
    s.replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c]!,
    );

function preparingHtml(fileName: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Preparing your file</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
:root { color-scheme: light dark; }
body { margin: 0; height: 100vh; display: flex; flex-direction: column; justify-content: center;
  padding: 0 24px; box-sizing: border-box; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: Canvas; color: CanvasText; user-select: none; cursor: default; }
h1 { font-size: 15px; margin: 0 0 6px; }
p { margin: 0; opacity: .75; overflow: hidden; text-overflow: ellipsis; }
</style></head><body>
<h1>Preparing your file…</h1>
<p>Backing up ${escapeHtml(fileName)} and converting it to timelines. This takes a few seconds.</p>
</body></html>`;
}

/** Resolves `promise`, or undefined after `ms`, so a window problem can never hang the open. */
const withTimeout = <T>(promise: Promise<T>, ms: number) =>
    Promise.race([
        promise,
        new Promise<undefined>((resolve) => setTimeout(resolve, ms)),
    ]);

/**
 * Shows a small modal window over `parent`, and waits until it has painted:
 * `ready-to-show`, then two animation frames after showing it. Only then does
 * the blocking work start. Never throws; the window is a courtesy.
 */
async function showPreparingWindow(
    parent: BrowserWindow,
    fileName: string,
): Promise<BrowserWindow | undefined> {
    try {
        const preparing = new BrowserWindow({
            parent,
            modal: true,
            width: 440,
            height: 120,
            frame: false,
            resizable: false,
            closable: false,
            skipTaskbar: true,
            show: false,
            webPreferences: {
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
            },
        });
        const ready = new Promise<void>((resolve) =>
            preparing.once("ready-to-show", () => resolve()),
        );
        await preparing.loadURL(
            `data:text/html;charset=utf-8,${encodeURIComponent(preparingHtml(fileName))}`,
        );
        await withTimeout(ready, 2000);
        preparing.show();
        parent.setProgressBar(2); // indeterminate
        // Two animation frames after showing: the window's first frame has been produced.
        await withTimeout(
            preparing.webContents.executeJavaScript(
                "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))",
            ),
            1000,
        );
        return preparing;
    } catch (error) {
        console.error("Could not show the preparing window:", error);
        return undefined;
    }
}

function messageBox(
    win: BrowserWindow | null,
    options: Electron.MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> {
    return win && !win.isDestroyed()
        ? dialog.showMessageBox(win, options)
        : dialog.showMessageBox(options);
}

/** Native dialogs over `win` (or app-modal when there is no window yet, at startup). */
export function electronConvertOnOpenDialogs(
    win: BrowserWindow | null,
): ConvertOnOpenDialogs {
    return {
        async whilePreparing(fileName, work) {
            // Without a main window (a file opened at startup) nothing is on screen yet, and a
            // lone extra window would quit the app on Windows and Linux when it closes.
            const parent = win && !win.isDestroyed() ? win : null;
            const preparing = parent
                ? await showPreparingWindow(parent, fileName)
                : undefined;
            try {
                return await work();
            } finally {
                if (preparing && !preparing.isDestroyed()) preparing.destroy();
                if (parent && !parent.isDestroyed()) parent.setProgressBar(-1);
            }
        },

        async warnOlderRelease(fileName, backupPath) {
            const { response } = await messageBox(win, {
                type: "warning",
                title: "Saved by an older version",
                message: `"${fileName}" was saved by an older version of OpenMarch after it was converted to timelines.`,
                detail: `Changes made in the older version are not in its timelines. It won't be converted again.\n\nA backup from before the conversion is at:\n${backupPath}`,
                buttons: ["Open Without Converting", "Show Backup", "Cancel"],
                defaultId: 2,
                cancelId: 2,
                noLink: true,
            });
            if (response === 0) return "open";
            if (response === 1) shell.showItemInFolder(backupPath);
            return "stop";
        },

        converted(fileName, backupPath) {
            void messageBox(win, {
                type: "info",
                title: "Converted to timelines",
                message: `"${fileName}" now uses timelines.`,
                detail: `A copy from before the conversion was saved at:\n${backupPath}`,
                buttons: ["OK"],
            });
        },

        async backupFailed(fileName, message) {
            await messageBox(win, {
                type: "error",
                title: "Couldn't back up your file",
                message: `"${fileName}" wasn't opened, because it couldn't be backed up before converting it to timelines.`,
                detail: `${message}\n\nYour file was not changed.`,
                buttons: ["OK"],
            });
        },

        async conversionFailed(fileName, error, backupPath) {
            captureException(error);
            await messageBox(win, {
                type: "error",
                title: "Couldn't convert your file",
                message: `"${fileName}" wasn't opened, because converting it to timelines failed.`,
                detail: `${error.message}\n\nNothing in your file was changed. A backup is at:\n${backupPath}`,
                buttons: ["OK"],
            });
        },
    };
}
