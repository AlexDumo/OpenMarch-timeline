/* eslint-disable no-console */
/**
 * The main-process side of convert on open (P9.3): the dialogs and the blocking
 * "preparing your file" window around `runConvertOnOpen`
 * (`electron/database/convertOnOpen.ts`). `setActiveDb` calls it after
 * migrations.
 *
 * Everything here is a native dialog or window owned by the main process, so
 * no IPC channel is added or changed. The text is English only, like the other
 * main-process dialogs; translating it is left for when P9.4 makes the step
 * permanent.
 */
import { BrowserWindow, dialog, shell } from "electron";
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { captureException } from "@sentry/electron/main";
import {
    runConvertOnOpen,
    type ConvertOnOpenUi,
} from "../database/convertOnOpen";

/** What `setActiveDb` does next: open the file, or open nothing (the person was told why). */
export type ConvertOnOpenNext = "continue" | "stop";

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

/**
 * Shows a small modal window over `win` while `work` runs. The backup and the
 * conversion block the main process for a second or two on a large show, so
 * the window is shown and painted first. Without a main window (a file opened
 * at startup, before the window exists) the work just runs: nothing is on
 * screen yet, and a lone extra window would quit the app on Windows and Linux
 * when it closes.
 */
async function whilePreparing<T>(
    win: BrowserWindow | null,
    fileName: string,
    work: () => Promise<T>,
): Promise<T> {
    const parent = win && !win.isDestroyed() ? win : null;
    let preparing: BrowserWindow | undefined;
    if (parent) {
        try {
            preparing = new BrowserWindow({
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
                    javascript: false,
                },
            });
            await preparing.loadURL(
                `data:text/html;charset=utf-8,${encodeURIComponent(preparingHtml(fileName))}`,
            );
            preparing.show();
            parent.setProgressBar(2); // indeterminate
            // Give the window a moment to paint before the main process blocks.
            await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
            // The window is a courtesy; never fail the conversion over it.
            console.error("Could not show the preparing window:", error);
        }
    }
    try {
        return await work();
    } finally {
        if (preparing && !preparing.isDestroyed()) preparing.destroy();
        if (parent && !parent.isDestroyed()) parent.setProgressBar(-1);
    }
}

async function messageBox(
    win: BrowserWindow | null,
    options: Electron.MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> {
    return win && !win.isDestroyed()
        ? dialog.showMessageBox(win, options)
        : dialog.showMessageBox(options);
}

/**
 * The file is at version 7 but already has timeline rows: it was converted and
 * then saved by a release without the version check, or made with the
 * timeline dev flag. Converting again would drop the timeline edits, so this
 * asks instead. Opening it changes nothing in the file.
 */
async function warnOlderRelease(
    win: BrowserWindow | null,
    fileName: string,
    backupPath: string | undefined,
): Promise<"open" | "stop"> {
    const buttons = backupPath
        ? ["Open Without Converting", "Show Backup", "Cancel"]
        : ["Open Without Converting", "Cancel"];
    const cancelId = buttons.length - 1;
    const { response } = await messageBox(win, {
        type: "warning",
        title: "Saved by an older version",
        message: `"${fileName}" was saved by an older version of OpenMarch after it was converted to timelines.`,
        detail:
            "Changes made in the older version are not in its timelines. It won't be converted again." +
            (backupPath
                ? `\n\nA backup from before the conversion is at:\n${backupPath}`
                : "\n\nNo backup from before the conversion was found next to it."),
        buttons,
        defaultId: cancelId,
        cancelId,
        noLink: true,
    });
    if (response === 0) return "open";
    if (backupPath && response === 1) shell.showItemInFolder(backupPath);
    return "stop";
}

/**
 * Runs the convert-on-open step for the file at `filePath`, open on `db` with
 * migrations applied, and tells the person what happened.
 */
export async function convertOnOpenInMain(
    filePath: string,
    db: DatabaseSync,
    win: BrowserWindow | null,
): Promise<ConvertOnOpenNext> {
    const fileName = basename(filePath);
    const ui: ConvertOnOpenUi = {
        warnOlderRelease: (backupPath) =>
            warnOlderRelease(win, fileName, backupPath),
        whilePreparing: (work) => whilePreparing(win, fileName, work),
    };

    const started = Date.now();
    const outcome = await runConvertOnOpen(filePath, db, ui);
    switch (outcome.kind) {
        case "disabled":
        case "none":
            return "continue";
        case "older-release":
            console.log(
                `convert on open: ${filePath} is at version 7 with timeline rows; ${outcome.choice}`,
            );
            return outcome.choice === "open" ? "continue" : "stop";
        case "conversion":
            break;
    }

    switch (outcome.status) {
        case "converted": {
            console.log(
                `convert on open: converted ${filePath} in ${Date.now() - started} ms; backup at ${outcome.backupPath}`,
                JSON.stringify(outcome.report ?? null),
            );
            void messageBox(win, {
                type: "info",
                title: "Converted to timelines",
                message: `"${fileName}" now uses timelines.`,
                detail: `A copy from before the conversion was saved at:\n${outcome.backupPath}`,
                buttons: ["OK"],
            });
            return "continue";
        }
        case "backup-failed":
            console.error(
                `convert on open: backup of ${filePath} failed (${outcome.backup.code}); not converted`,
            );
            await messageBox(win, {
                type: "error",
                title: "Couldn't back up your file",
                message: `"${fileName}" wasn't opened, because it couldn't be backed up before converting it to timelines.`,
                detail: `${outcome.backup.message}\n\nYour file was not changed.`,
                buttons: ["OK"],
            });
            return "stop";
        case "conversion-failed":
            console.error(
                `convert on open: converting ${filePath} failed; rolled back`,
                outcome.error,
            );
            captureException(outcome.error);
            await messageBox(win, {
                type: "error",
                title: "Couldn't convert your file",
                message: `"${fileName}" wasn't opened, because converting it to timelines failed.`,
                detail: `${outcome.error.message}\n\nNothing in your file was changed. A backup is at:\n${outcome.backupPath}`,
                buttons: ["OK"],
            });
            return "stop";
    }
}
