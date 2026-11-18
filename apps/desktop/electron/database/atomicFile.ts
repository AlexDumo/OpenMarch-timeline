/**
 * Durable file replacement for show files (ADR 0018).
 *
 * A show is replaced by putting a complete, flushed temp file beside it and renaming it over the
 * show, then flushing the folder. Readers (a sync app, a backup, another program) see either the
 * old file or the new one, never a partial write, and no `-journal` ever appears next to the
 * show. Main process only.
 */
import * as fs from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";

/** Flushes a file's contents to disk. On macOS libuv uses F_FULLFSYNC. */
export async function fsyncFile(filePath: string): Promise<void> {
    const handle = await fs.promises.open(filePath, "r+");
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}

/**
 * Flushes a folder so a rename inside it survives power loss.
 *
 * Windows can't open a folder for flushing, so this does nothing there. Some file systems refuse
 * the call; that only loses the extra durability, so those errors are ignored.
 */
export async function fsyncDirectory(
    directory: string,
    platform: NodeJS.Platform = process.platform,
): Promise<void> {
    if (platform === "win32") return;
    let handle: fs.promises.FileHandle | undefined;
    try {
        handle = await fs.promises.open(directory, "r");
        await handle.sync();
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (
            code === "EINVAL" ||
            code === "EISDIR" ||
            code === "EPERM" ||
            code === "EBADF" ||
            code === "ENOTSUP"
        )
            return;
        throw error;
    } finally {
        await handle?.close();
    }
}

/**
 * Error codes for a file another process holds open: Windows gives these to a rename or delete
 * while a sync app, an antivirus or the search indexer has the file open without delete sharing.
 */
const BUSY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

export function isBusyError(error: unknown): boolean {
    return BUSY_CODES.has((error as NodeJS.ErrnoException)?.code ?? "");
}

export type RenameRetryOptions = {
    /** The platform to behave as. Retries only happen on Windows. */
    platform?: NodeJS.Platform;
    /** How long to keep retrying, in ms. */
    budgetMs?: number;
    rename?: (from: string, to: string) => Promise<void>;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    /** Called before each retry; stops retrying when it returns false. */
    shouldRetry?: () => Promise<boolean>;
};

export class RenameRetriesExhaustedError extends Error {
    readonly attempts: number;
    constructor(attempts: number, cause: unknown) {
        super(
            `Couldn't replace the file after ${attempts} attempts: ${
                (cause as Error)?.message ?? String(cause)
            }`,
            { cause },
        );
        this.name = "RenameRetriesExhaustedError";
        this.attempts = attempts;
    }
}

const defaultSleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Renames `from` over `to`.
 *
 * On Windows a rename over a file fails with EPERM, EBUSY or EACCES while another process has
 * it open without delete sharing. Those failures are retried with a growing delay (10, 20,
 * 30 ms … up to 100 ms) until `budgetMs` runs out, as VS Code and graceful-fs do. Then this
 * throws {@link RenameRetriesExhaustedError} and leaves both files where they were.
 */
export async function renameWithRetry(
    from: string,
    to: string,
    options: RenameRetryOptions = {},
): Promise<{ attempts: number }> {
    const platform = options.platform ?? process.platform;
    const budgetMs = options.budgetMs ?? 5000;
    const rename = options.rename ?? fs.promises.rename;
    const sleep = options.sleep ?? defaultSleep;
    const now = options.now ?? Date.now;

    const start = now();
    let attempts = 0;
    for (;;) {
        attempts++;
        try {
            await rename(from, to);
            return { attempts };
        } catch (error) {
            if (platform !== "win32" || !isBusyError(error)) throw error;
            const delay = Math.min(100, attempts * 10);
            if (now() - start + delay > budgetMs)
                throw new RenameRetriesExhaustedError(attempts, error);
            await sleep(delay);
            if (options.shouldRetry && !(await options.shouldRetry()))
                throw new RenameRetriesExhaustedError(attempts, error);
        }
    }
}

/** Deletes a file if it exists, ignoring a missing file. */
export async function removeIfPresent(filePath: string): Promise<void> {
    try {
        await fs.promises.unlink(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
}

/**
 * Deletes a file, retrying for a while when another process holds it (a sync app uploading a
 * temp file it just saw). Returns false, instead of throwing, when it is still there at the end:
 * callers clean up best effort and must not hide the error they are handling.
 */
export async function removeWithRetry(
    filePath: string,
    {
        budgetMs = 2000,
        sleep = defaultSleep,
        now = Date.now,
    }: Pick<RenameRetryOptions, "budgetMs" | "sleep" | "now"> = {},
): Promise<boolean> {
    const start = now();
    for (let attempt = 1; ; attempt++) {
        try {
            await removeIfPresent(filePath);
            return true;
        } catch (error) {
            const delay = Math.min(200, attempt * 25);
            if (!isBusyError(error) || now() - start + delay > budgetMs)
                return false;
            await sleep(delay);
        }
    }
}

/** A temp file's name beside `target`: `.~<name>.<hex>.tmp`. */
export function tempPathBeside(target: string): string {
    return join(
        dirname(target),
        `.~${basename(target)}.${randomBytes(4).toString("hex")}.tmp`,
    );
}

/** Matches the temp files {@link tempPathBeside} makes for a file named `fileName`. */
export function tempFilePattern(fileName: string): RegExp {
    const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Older builds wrote the snapshot beside the show, so a crash could also leave its journal.
    return new RegExp(`^\\.~${escaped}\\.[0-9a-f]+\\.tmp(-journal)?$`);
}

export type PublishOptions = RenameRetryOptions & {
    /** Runs on the finished temp file just before the rename (copy permissions, a last check). */
    beforeRename?: (tempPath: string) => Promise<void>;
};

/**
 * Puts a copy of the finished file `source` at `target`, all at once.
 *
 * `source` is built somewhere private (the app's user data); only the finished bytes go beside
 * `target`, as a temp file that is flushed and then renamed over it. The temp file is removed
 * again if anything fails. `source` is left as it is.
 */
export async function publishFile(
    source: string,
    target: string,
    options: PublishOptions = {},
): Promise<{ attempts: number; tempPath: string }> {
    const tempPath = tempPathBeside(target);
    try {
        await fs.promises.copyFile(
            source,
            tempPath,
            fs.constants.COPYFILE_EXCL,
        );
        await fsyncFile(tempPath);
        await options.beforeRename?.(tempPath);
        const result = await renameWithRetry(tempPath, target, options);
        await fsyncDirectory(dirname(target), options.platform);
        return { ...result, tempPath };
    } catch (error) {
        await removeWithRetry(tempPath);
        throw error;
    }
}
