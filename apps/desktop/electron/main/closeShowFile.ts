/* eslint-disable no-console */
/**
 * Closing the current show file (`closeCurrentFile` in `index.ts`), apart
 * from Electron so tests can drive it with the real open lock and database
 * services (P9.9).
 */
import * as DatabaseServices from "../database/database.services";
import { keepFileToReopen } from "./convertWorkerHost";

/** What closing the file needs from the app. */
export interface CloseShowFileDeps {
    /** The main window's page, or null when there is no main window. */
    page(): { reload(): void } | null;
    /** True while a new-show draft is the open file. */
    hasDraft(): boolean;
    discardDraft(): Promise<unknown>;
    /** Asks the page for the field's SVG (the recent-files thumbnail); may reject. */
    requestSvg(): Promise<string>;
    saveSvgPreview(filePath: string, svg: string): void;
    /** Forgets the file to reopen on the next launch (`databasePath`). */
    forgetFileToReopen(): void;
}

/**
 * Closes the current file. Not serialized: `index.ts` runs it under
 * `withOpenLock`, so it waits for an open (and its conversion) to end.
 *
 * @returns 200 for success, -1 when there is no main window
 */
export async function closeShowFileNow(
    isAppQuitting: boolean,
    deps: CloseShowFileDeps,
): Promise<number> {
    console.log("closeCurrentFile called. isAppQuitting:", isAppQuitting);
    const page = deps.page();
    if (!page) return -1;

    if (deps.hasDraft()) {
        await deps.discardDraft();
        if (!isAppQuitting) page.reload();
        return 200;
    }

    // The thumbnail needs an open file the page can draw: none while an open has the renderer's
    // SQL suspended (it is reloading, or a conversion was stopped), so don't wait 5 s for it.
    const dbPath = DatabaseServices.getDbPath();
    if (dbPath && !DatabaseServices.isSqlProxySuspended()) {
        try {
            deps.saveSvgPreview(dbPath, await deps.requestSvg());
        } catch (error) {
            console.error("Error getting SVG on close:", error);
        }
    }

    DatabaseServices.setDbPath("", false);
    // A conversion the quit stopped keeps its file as the one to reopen on the next launch.
    if (!keepFileToReopen(isAppQuitting)) deps.forgetFileToReopen();

    // Only reload if we're NOT quitting the app
    if (!isAppQuitting) page.reload();

    return 200;
}
