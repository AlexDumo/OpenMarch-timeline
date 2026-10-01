/**
 * Starts the convert-on-open worker (P9.8) and turns what it sends into a
 * `ConvertOnOpenResult`. The backup and the conversion run on the worker's
 * own `node:sqlite` connection in a `node:worker_threads` thread, so the main
 * process keeps handling events (and the "Preparing your file…" window keeps
 * painting) while a large show converts.
 *
 * It imports no Electron or renderer module, so tests drive it with a built
 * worker. The caller must not hold a connection to the file with an open
 * transaction while the worker runs: `openShow.ts` closes its connection first
 * and reopens it afterwards.
 */
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import type { ConvertOnOpenResult } from "../database/convertOnOpen";
import {
    conversionMarkerOf,
    readWorkspaceSettingsJson,
} from "../database/convertOnOpenGate";
import {
    readUserVersion,
    TIMELINE_MODEL_USER_VERSION,
} from "../database/fileVersion";
import {
    deserializeError,
    type ConvertProgress,
    type ConvertWorkerMessage,
    type ConvertWorkerRequest,
    type ConvertWorkerTestHooks,
    type SerializedConvertResult,
} from "../database/convertOnOpenProtocol";

/** The worker's file in the built app, next to `dist-electron/main` (see `vite.config.mts`). */
export const CONVERT_WORKER_FILE = "convertOnOpenWorker.js";
export const defaultConvertWorkerPath = (mainDir: string) =>
    path.join(mainDir, "../worker", CONVERT_WORKER_FILE);

export interface ConvertInWorkerOptions {
    /** The built worker script. */
    workerPath: string;
    /** How long the worker's connection waits for another connection's lock. */
    busyTimeoutMs: number;
    onProgress?: (progress: ConvertProgress) => void;
    /** Test hooks, passed to the worker. */
    test?: ConvertWorkerTestHooks;
}

const running = new Set<Worker>();
/** Workers stopped by `terminateConversionWorkers`. */
const stopped = new WeakSet<Worker>();

/** Set by `before-quit`: no conversion starts from then on (P9.9). */
let quitRequested = false;
/** True once a quit stopped a conversion, or kept one from starting. */
let stoppedByQuit = false;
/** Open flows between showing "Preparing your file…" and its end (P9.9). */
let preparing = 0;
let idleWaiters: (() => void)[] = [];
/** Called once, when the app starts quitting (`onQuitRequested`). */
let quitListeners = new Set<() => void>();

/**
 * True once a quit stopped a conversion (a running worker, or one about to
 * start): the open flow then shows no "couldn't convert" dialog for it, and
 * keeps the file as the one to reopen on the next launch. Once the app is
 * quitting it stays quitting (P9.9): the quit handler finishes the quit itself.
 */
export const conversionWorkersStopped = () => stoppedByQuit;

/** True once the app started quitting: a new open or conversion must not start. */
export const appQuitRequested = () => quitRequested;

/**
 * Marks the app as quitting (from `before-quit`, or the main window's `close`
 * handler, which always ends in a quit): no conversion starts from now on,
 * and the open flow's dialogs close as if cancelled (`onQuitRequested`).
 */
export function markQuitRequested(): void {
    if (quitRequested) return;
    quitRequested = true;
    const listeners = [...quitListeners];
    quitListeners = new Set();
    for (const listener of listeners) {
        try {
            listener();
        } catch {
            // A listener never stops the quit.
        }
    }
}

/**
 * Calls `listener` once the app starts quitting, at once if it already has.
 * Returns a function that stops listening.
 */
export function onQuitRequested(listener: () => void): () => void {
    if (quitRequested) {
        listener();
        return () => {};
    }
    quitListeners.add(listener);
    return () => quitListeners.delete(listener);
}

/**
 * True while an open shows "Preparing your file…" or a conversion worker runs:
 * a quit, or closing the main window, then stops the conversion first.
 */
export const conversionInProgress = () => preparing > 0 || running.size > 0;

/**
 * Marks the start of an open's "Preparing your file…" step, which may start a
 * conversion worker. Call the returned function (once is enough) when the
 * step ends, worker included.
 */
export function beginPreparing(): () => void {
    preparing++;
    let ended = false;
    return () => {
        if (ended) return;
        ended = true;
        preparing--;
        wakeIfIdle();
    };
}

function wakeIfIdle() {
    if (conversionInProgress()) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const wake of waiters) wake();
}

/** Resolves once no open is preparing and no conversion worker runs. */
function whenConversionsEnd(): Promise<void> {
    if (!conversionInProgress()) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
}

/**
 * Whether closing the file as the app quits keeps it as the file to reopen
 * (`databasePath`): only when the quit stopped its conversion, so the next
 * launch reopens, and converts, it (P9.8).
 */
export const keepFileToReopen = (isAppQuitting: boolean) =>
    isAppQuitting && stoppedByQuit;

/** The parts of a window `close` event and of `app` that `quitInsteadOfClosing` uses. */
export interface CloseEvent {
    preventDefault(): void;
}

/**
 * For the main window's `close` handler: while a conversion is in progress,
 * closing the window quits instead (P9.9), so the `before-quit` handler stops
 * the conversion and then quits. Returns true when it handled the close.
 */
export function quitInsteadOfClosing(
    event: CloseEvent,
    app: Pick<QuittingApp, "quit">,
): boolean {
    if (!conversionInProgress()) return false;
    event.preventDefault();
    app.quit();
    return true;
}

/** Forgets a quit; for tests only (a quit can't be cancelled once it reached a conversion). */
export function resetConversionQuitForTests() {
    quitRequested = false;
    stoppedByQuit = false;
    preparing = 0;
    idleWaiters = [];
    quitListeners = new Set();
}

/** Number of conversion workers running; for tests. */
export const runningConversionWorkers = () => running.size;

function fromWorker(result: SerializedConvertResult): ConvertOnOpenResult {
    if (result.status === "conversion-failed")
        return { ...result, error: deserializeError(result.error) };
    if (result.status === "converted")
        return {
            ...result,
            report: result.report as Extract<
                ConvertOnOpenResult,
                { status: "converted" }
            >["report"],
        };
    return result;
}

/**
 * True when the file at `filePath` holds this open's committed conversion:
 * version 8 and the marker time this open asked for. Reads only; false when the
 * file can't be read.
 */
export function committedConversion(
    filePath: string,
    convertedAt: string,
): boolean {
    let db: DatabaseSync | undefined;
    try {
        db = new DatabaseSync(filePath, { readOnly: true });
        db.exec("PRAGMA busy_timeout = 5000");
        return (
            readUserVersion(db) === TIMELINE_MODEL_USER_VERSION &&
            conversionMarkerOf(readWorkspaceSettingsJson(db)) === convertedAt
        );
    } catch {
        return false;
    } finally {
        db?.close();
    }
}

/** What an open reports when the worker ended without a result. */
function endedEarly(
    backupPath: string | undefined,
    reason: string,
): ConvertOnOpenResult {
    if (backupPath)
        return {
            status: "conversion-failed",
            backupPath,
            error: new Error(
                `The conversion stopped before it finished (${reason}). It was rolled back.`,
            ),
        };
    return {
        status: "backup-failed",
        backup: {
            ok: false,
            code: "unknown",
            message: `Your file couldn't be backed up: the backup stopped before it finished (${reason}).`,
        },
    };
}

/**
 * Backs up and converts `filePath` in a worker thread. Resolves once the
 * thread has exited, so its connection is closed; never rejects. A worker
 * that crashes, or is stopped by `terminateConversionWorkers`, resolves as a
 * failed conversion (rolled back by SQLite's journal when the thread's
 * connection closes) or, before the backup finished, as a failed backup.
 */
export function convertInWorker(
    filePath: string,
    options: ConvertInWorkerOptions,
): Promise<ConvertOnOpenResult> {
    const convertedAt = options.test?.now ?? new Date().toISOString();
    return new Promise<ConvertOnOpenResult>((resolve) => {
        const request: ConvertWorkerRequest = {
            filePath,
            busyTimeoutMs: options.busyTimeoutMs,
            convertedAt,
            test: options.test,
        };
        if (quitRequested) {
            // The app is quitting: don't start (the file stays as it is, and reopens next launch).
            stoppedByQuit = true;
            resolve(endedEarly(undefined, "the app quit"));
            return;
        }
        let worker: Worker;
        try {
            worker = new Worker(options.workerPath, { workerData: request });
        } catch (error) {
            resolve(
                endedEarly(
                    undefined,
                    `the worker didn't start: ${error instanceof Error ? error.message : String(error)}`,
                ),
            );
            return;
        }
        running.add(worker);

        let backupPath: string | undefined;
        let result: ConvertOnOpenResult | undefined;
        let failure: string | undefined;

        worker.on("message", (message: ConvertWorkerMessage) => {
            switch (message.type) {
                case "progress":
                    try {
                        options.onProgress?.(message.progress);
                    } catch {
                        // Progress is a courtesy; it never stops a conversion.
                    }
                    break;
                case "backup-done":
                    backupPath = message.backupPath;
                    break;
                case "result":
                    result = fromWorker(message.result);
                    break;
                case "failed":
                    failure = message.error.message;
                    break;
            }
        });
        worker.on("error", (error) => {
            failure ??= error.message;
        });
        worker.on("exit", (code) => {
            running.delete(worker);
            wakeIfIdle();
            const outcome =
                result ??
                endedEarly(
                    backupPath,
                    stopped.has(worker)
                        ? "the app quit"
                        : (failure ?? `the worker exited with code ${code}`),
                );
            // The file decides: a thread that died between COMMIT and posting its result (or
            // whose result couldn't be sent) still converted the file.
            if (
                outcome.status === "conversion-failed" &&
                committedConversion(filePath, convertedAt)
            )
                resolve({
                    status: "converted",
                    backupPath: outcome.backupPath,
                    report: undefined,
                });
            else resolve(outcome);
        });
    });
}

/**
 * Stops every running conversion worker, and resolves once they have exited.
 * Each one's connection is closed as its thread ends, so SQLite rolls back its
 * open transaction; its open then resolves as a failed conversion.
 */
export async function terminateConversionWorkers(): Promise<void> {
    await Promise.all(
        [...running].map((worker) => {
            stopped.add(worker);
            return worker.terminate();
        }),
    );
}

/** The part of Electron's `app` that `stopConversionWorkersOnQuit` uses. */
export interface QuittingApp {
    on(
        event: "before-quit",
        listener: (event: { preventDefault(): void }) => void,
    ): unknown;
    quit(): void;
    /** Ends the process at once, without `before-quit` or closing windows. */
    exit(exitCode?: number): void;
}

/** How long a held quit waits for the conversion to stop and the file to close. */
export const QUIT_STOP_TIMEOUT_MS = 15_000;

export interface QuitDuringConversionOptions {
    /**
     * Runs once the conversion has stopped and its open has ended, right
     * before quitting again: the app lets its windows close without asking.
     */
    beforeQuitting?: () => void | Promise<void>;
    log?: (message: string) => void;
    /** How long to wait before ending the process anyway (default `QUIT_STOP_TIMEOUT_MS`). */
    timeoutMs?: number;
}

/**
 * Quitting while an open prepares or converts a file (P9.8, P9.9). The
 * `before-quit` handler holds the quit, so no window is asked to close while
 * the conversion runs, then:
 *
 * 1. stops the conversion worker (SQLite rolls its transaction back, so the
 *    file keeps version 7), or keeps one from starting;
 * 2. waits until the open has ended: it removes "Preparing your file…" and
 *    keeps the file as the one to reopen, and convert, on the next launch;
 * 3. runs `beforeQuitting`, then quits again, so no second Quit is needed.
 *
 * If that takes longer than `timeoutMs` (a native SQLite call such as the
 * backup's `VACUUM INTO` can't be interrupted, or a dialog blocks), it ends
 * the process with `app.exit()`: SQLite's journal rolls the conversion back
 * when the file is next opened. Further Quits meanwhile are held too.
 *
 * A quit with no conversion in progress isn't held up. Every quit stops any
 * later conversion from starting.
 */
export function stopConversionWorkersOnQuit(
    app: QuittingApp,
    options: QuitDuringConversionOptions = {},
): void {
    // eslint-disable-next-line no-console
    const log = options.log ?? ((message: string) => console.log(message));
    let stopping = false;
    const timeoutMs = options.timeoutMs ?? QUIT_STOP_TIMEOUT_MS;
    app.on("before-quit", (event) => {
        const converting = conversionInProgress();
        log(
            `before-quit: ${stopping ? "still stopping the conversion" : converting ? "stopping the conversion first" : "no conversion in progress"}`,
        );
        markQuitRequested();
        if (stopping) {
            event.preventDefault();
            return;
        }
        if (!converting) return;
        event.preventDefault();
        stopping = true;
        if (running.size > 0) stoppedByQuit = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<"timeout">((resolve) => {
            timer = setTimeout(() => resolve("timeout"), timeoutMs);
        });
        const stop = (async () => {
            try {
                await terminateConversionWorkers();
                await whenConversionsEnd();
                await options.beforeQuitting?.();
            } catch (error) {
                log(
                    `before-quit: stopping the conversion failed: ${String(error)}`,
                );
            }
            return "stopped" as const;
        })();
        void Promise.race([stop, timedOut]).then((outcome) => {
            clearTimeout(timer);
            if (outcome === "timeout") {
                log(
                    `before-quit: the conversion didn't stop within ${timeoutMs} ms; exiting (SQLite rolls it back on the next open)`,
                );
                app.exit(0);
                return;
            }
            stopping = false;
            app.quit();
        });
    });
}
