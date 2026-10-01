/* eslint-disable no-console */
/**
 * The native dialogs and the "Preparing your file…" overlay for convert on
 * open (P9.3). All of them belong to the main process, so no IPC channel is
 * added. The text is English only, like the other main-process dialogs;
 * translating it is left for when P9.4 makes the step permanent.
 */
import { dialog, shell, type BrowserWindow } from "electron";
import { captureException } from "@sentry/electron/main";
import type { ConvertOnOpenDialogs } from "./convertOnOpenFlow";
import {
    hidePreparingOverlay,
    showPreparingOverlay,
    showPreparingProgress,
    throttleProgress,
} from "./preparingOverlay";
import { beginPreparing, conversionWorkersStopped } from "./convertWorkerHost";

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
            // A quit or a main-window close from here on stops the conversion first (P9.9).
            const endPreparing = beginPreparing();
            // Without a main window (a file opened at startup) nothing is on screen yet.
            const target = win && !win.isDestroyed() ? win : undefined;
            try {
                // An overlay in the main window's page, not a native window: a native modal
                // that can't be closed refused the close a macOS Quit asks for (P9.9).
                if (target) await showPreparingOverlay(target, fileName);
                // The worker converts off this thread (P9.8): show how far it has got.
                return await work(
                    throttleProgress((p) => showPreparingProgress(target, p)),
                );
            } finally {
                hidePreparingOverlay(target);
                endPreparing();
            }
        },

        async warnOlderRelease(fileName, backupPath) {
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
            if (backupPath && response === 1)
                shell.showItemInFolder(backupPath);
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
            // The app is quitting and stopped the worker: nothing to tell.
            if (conversionWorkersStopped()) return;
            await messageBox(win, {
                type: "error",
                title: "Couldn't back up your file",
                message: `"${fileName}" wasn't opened, because it couldn't be backed up before converting it to timelines.`,
                detail: `${message}\n\nYour file was not changed.`,
                buttons: ["OK"],
            });
        },

        async conversionFailed(fileName, error, backupPath) {
            if (conversionWorkersStopped()) return;
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
