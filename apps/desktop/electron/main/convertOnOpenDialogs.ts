/* eslint-disable no-console */
/**
 * The native dialogs of convert on open, and the progress it sends the
 * renderer. Asking before a conversion is the renderer's (`ConvertShowDialog`).
 * The text here is English only, like the other main-process dialogs.
 */
import { BrowserWindow, dialog, shell } from "electron";
import { captureException } from "@sentry/electron/main";
import type { ConvertOnOpenDialogs } from "./convertOnOpenFlow";
import { showConversionProgress, throttleProgress } from "./conversionProgress";
import { conversionWorkersStopped } from "./convertWorkerHost";

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
        async whilePreparing(work) {
            const target = win && !win.isDestroyed() ? win : undefined;
            try {
                // The worker converts off this thread: the renderer's dialog shows how far it got.
                return await work(
                    throttleProgress((p) => showConversionProgress(target, p)),
                );
            } finally {
                if (target && !target.isDestroyed()) target.setProgressBar(-1);
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
                detail: `${error.message}\n\nYour file wasn't converted. A copy of it from before is at:\n${backupPath}`,
                buttons: ["OK"],
            });
        },
    };
}
