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
import { Worker } from "node:worker_threads";
import type { ConvertOnOpenResult } from "../database/convertOnOpen";
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

let quitting = false;

/**
 * True once `stopConversionWorkersOnQuit` stopped workers to quit: the open
 * flow then shows no "couldn't convert" dialog for the stopped conversion.
 */
export const conversionWorkersStopped = () => quitting;

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
    return new Promise<ConvertOnOpenResult>((resolve) => {
        const request: ConvertWorkerRequest = {
            filePath,
            busyTimeoutMs: options.busyTimeoutMs,
            test: options.test,
        };
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
            if (result) resolve(result);
            else
                resolve(
                    endedEarly(
                        backupPath,
                        stopped.has(worker)
                            ? "the app quit"
                            : (failure ??
                                  `the worker exited with code ${code}`),
                    ),
                );
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
}

/**
 * On quit, stops the running conversion workers first, then quits again, so
 * no conversion is left half-written by a thread killed with the process.
 */
export function stopConversionWorkersOnQuit(app: QuittingApp): void {
    app.on("before-quit", (event) => {
        if (running.size === 0) return;
        quitting = true;
        event.preventDefault();
        void terminateConversionWorkers().finally(() => app.quit());
    });
}
