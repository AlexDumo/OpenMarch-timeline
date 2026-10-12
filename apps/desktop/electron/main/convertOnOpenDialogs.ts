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

        async warnOlderRelease(
            fileName,
            { backupPath, latestBackup, canConvertAgain },
        ) {
            const choices: {
                label: string;
                choice: "convert-again" | "keep-timelines" | "show-backup";
            }[] = canConvertAgain
                ? [
                      { label: "Convert Again", choice: "convert-again" },
                      { label: "Keep Timelines", choice: "keep-timelines" },
                  ]
                : [{ label: "Open", choice: "keep-timelines" }];
            if (latestBackup)
                choices.push({ label: "Show Backup", choice: "show-backup" });
            const buttons = [...choices.map((c) => c.label), "Cancel"];
            const cancelId = buttons.length - 1;
            const explanation = canConvertAgain
                ? "Changes made in the older version are not in its timelines. Convert Again rebuilds the timelines from the older version's changes. Keep Timelines opens the timelines as they were before, without those changes."
                : "Changes made in the older version are not in its timelines. Open sets it back to the timeline format, as it is.";
            const { response } = await messageBox(win, {
                type: "warning",
                title: "Saved by an older version",
                message: `"${fileName}" was opened in an older version of OpenMarch after it was converted to timelines.`,
                detail:
                    `${explanation}\n\nFirst, the file as it is now is saved next to it as:\n${backupPath}` +
                    (latestBackup
                        ? `\n\nThe backup from before the conversion is at:\n${latestBackup}`
                        : ""),
                buttons,
                defaultId: cancelId,
                cancelId,
                noLink: true,
            });
            const picked = choices[response]?.choice;
            if (picked === "show-backup" && latestBackup)
                shell.showItemInFolder(latestBackup);
            if (picked === "convert-again" || picked === "keep-timelines")
                return picked;
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
                detail: `${error.message}\n\nYour file wasn't converted, and wasn't changed. A copy of it from before is at:\n${backupPath}`,
                buttons: ["OK"],
            });
        },
    };
}
