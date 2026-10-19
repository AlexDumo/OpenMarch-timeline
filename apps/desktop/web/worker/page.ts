/**
 * Asking the page for what only it can do, the other way from `invoke`: the worker has no DOM,
 * so it can't draw an SVG or a PDF (`PAGE_CHANNELS`). Answers are taken as they arrive, not in
 * the worker's serial message queue, since the handler waiting for one holds that queue.
 */
import type { FromWorker, ToWorker } from "../protocol";

const scope = globalThis as unknown as {
    postMessage(message: FromWorker): void;
    addEventListener(
        type: "message",
        listener: (event: MessageEvent<ToWorker>) => void,
    ): void;
};

const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let nextId = 1;

function takeAnswer(event: MessageEvent<ToWorker>) {
    const message = event.data;
    if (message.type !== "answer") return;
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (!call) return;
    if (message.ok) call.resolve(message.value);
    else call.reject(new Error(message.error));
}

// Only a worker has a global `addEventListener` (not Node, where tests import this)
if (typeof scope.addEventListener === "function")
    scope.addEventListener("message", takeAnswer);

/** Runs `channel`'s page handler with `args` and resolves with what it returns. */
export function askPage<T>(channel: string, ...args: unknown[]): Promise<T> {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
        pending.set(id, {
            resolve: resolve as (value: unknown) => void,
            reject,
        });
        scope.postMessage({ type: "ask", id, channel, args });
    });
}
