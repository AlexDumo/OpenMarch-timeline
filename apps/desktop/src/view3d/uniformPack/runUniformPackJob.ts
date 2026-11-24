/**
 * Runs one job in a fresh uniform pack worker (`uniformPack.worker.ts`) and ends the worker when
 * it answers, fails or runs out of time, as the model import does (ADR 0010 amendment
 * 2026-11-15, "crash isolation and cancel"). A hang or a slow file costs at most the timeout and
 * never blocks the caller's main thread; the worker shares the renderer's process, so it doesn't
 * contain a decoder crash. It is a URL worker, never `blob:`, so it takes its own CSP from its
 * response (`src/security/appCsp.ts`). Used by the 3D View window and the editor.
 */
import UniformPackWorker from "./uniformPack.worker.ts?worker";
import {
    UNIFORM_PACK_JOB_TIMEOUT_MS,
    type UniformPackRefusal,
    type UniformPackRequest,
    type UniformPackResponse,
} from "./protocol";

export { UNIFORM_PACK_JOB_TIMEOUT_MS } from "./protocol";

/** A job the worker refused, or that failed or ran out of time */
export class UniformPackJobError extends Error {
    constructor(
        readonly code: UniformPackRefusal | "timedOut",
        message: string,
    ) {
        super(message);
        this.name = "UniformPackJobError";
    }
}

export type UniformPackResult = Exclude<
    UniformPackResponse,
    { type: "refused" }
>;

/**
 * Sends `request` to a fresh worker. `transfer` hands buffers over instead of copying them, so
 * pass only arrays nobody else uses.
 */
export function runUniformPackJob(
    request: UniformPackRequest,
    transfer: Transferable[] = [],
    timeoutMs = UNIFORM_PACK_JOB_TIMEOUT_MS,
): Promise<UniformPackResult> {
    const worker = new UniformPackWorker();
    return new Promise<UniformPackResult>((resolve, reject) => {
        const finish = (settle: () => void) => {
            clearTimeout(timer);
            worker.terminate();
            settle();
        };
        const timer = setTimeout(
            () =>
                finish(() =>
                    reject(
                        new UniformPackJobError(
                            "timedOut",
                            `no answer in ${timeoutMs} ms`,
                        ),
                    ),
                ),
            timeoutMs,
        );
        worker.onmessage = (event: MessageEvent<UniformPackResponse>) => {
            const message = event.data;
            if (message.type === "refused")
                finish(() =>
                    reject(
                        new UniformPackJobError(message.code, message.message),
                    ),
                );
            else finish(() => resolve(message));
        };
        worker.onerror = (event) =>
            finish(() =>
                reject(
                    new UniformPackJobError(
                        "unreadable",
                        event.message || "the worker failed",
                    ),
                ),
            );
        worker.postMessage(request, transfer);
    });
}
