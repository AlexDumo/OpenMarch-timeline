/**
 * Durable file replacement for show files.
 *
 * A show is replaced by writing a complete temp file beside it, flushing it to
 * disk, renaming it over the show and flushing the folder. Readers (a sync
 * client, a backup, another app) then see either the old file or the new one,
 * never a partial write.
 */
import * as fs from "node:fs";
import { dirname } from "node:path";

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
 * Windows can't open a folder for flushing, so this does nothing there. Some
 * file systems refuse the call; that only loses the extra durability, so those
 * errors are ignored.
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

/** Error codes Windows gives a rename while another process has the target open. */
const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

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
    readonly cause: unknown;
    constructor(attempts: number, cause: unknown) {
        super(
            `Couldn't replace the file after ${attempts} attempts: ${
                (cause as Error)?.message ?? String(cause)
            }`,
        );
        this.name = "RenameRetriesExhaustedError";
        this.attempts = attempts;
        this.cause = cause;
    }
}

const defaultSleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Renames `from` over `to`.
 *
 * On Windows a rename over a file fails with EPERM, EBUSY or EACCES while
 * another process (antivirus, a sync client, the search indexer) has it open
 * without delete sharing. Those failures are retried with a growing delay
 * (10, 20, 30 ms … up to 100 ms) until `budgetMs` runs out, as VS Code and
 * graceful-fs do. Then this throws {@link RenameRetriesExhaustedError} and
 * leaves both files where they were.
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
            const code = (error as NodeJS.ErrnoException).code ?? "";
            if (platform !== "win32" || !RETRYABLE_RENAME_CODES.has(code))
                throw error;
            const delay = Math.min(100, attempts * 10);
            if (now() - start + delay > budgetMs)
                throw new RenameRetriesExhaustedError(attempts, error);
            await sleep(delay);
            if (options.shouldRetry && !(await options.shouldRetry()))
                throw new RenameRetriesExhaustedError(attempts, error);
        }
    }
}

/**
 * Moves a finished temp file over `target`: flush the temp file, rename it
 * over the target, then flush the folder.
 */
export async function replaceFileDurably(
    tempPath: string,
    target: string,
    options: RenameRetryOptions = {},
): Promise<{ attempts: number }> {
    await fsyncFile(tempPath);
    const result = await renameWithRetry(tempPath, target, options);
    await fsyncDirectory(dirname(target), options.platform);
    return result;
}

/** Deletes a file if it exists, ignoring a missing file. */
export async function removeIfPresent(filePath: string): Promise<void> {
    try {
        await fs.promises.unlink(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
}
