/**
 * The window's side of the flats bleed worker (`flatsBleed.worker.ts`): sends
 * composed pixels, plus the region mask the first time a layout is seen, and
 * resolves with the bled bitmap.
 *
 * The worker keeps one bleed plan per key. If it has none (it failed to work
 * one out, or it was restarted), it answers `needsMask` and hands the pixels
 * back; the request is then sent again once with the mask.
 */
import type {
    FlatsBleedRequest,
    FlatsBleedResponse,
} from "./flatsBleed.worker";

/** What a bleed client needs from a worker. */
export interface BleedWorkerLike {
    postMessage(message: FlatsBleedRequest, transfer: Transferable[]): void;
    onmessage: ((e: MessageEvent<FlatsBleedResponse>) => void) | null;
    onerror: ((e: ErrorEvent) => void) | null;
    terminate(): void;
}

export interface BleedJob {
    /** Identifies the plan: layout, atlas size and resolution. */
    key: string;
    W: number;
    H: number;
    /** How far to bleed, pixels. */
    steps: number;
    /** The composed atlas, RGBA; transferred to the worker. */
    pixels: ArrayBuffer;
    /** Draws the region mask; called only when the worker needs it. */
    mask: () => Uint8Array;
}

interface Pending {
    key: string;
    resolve: (b: ImageBitmap) => void;
    reject: (e: Error) => void;
    /** Sends the job again with its mask; absent once it has been retried. */
    retry?: (pixels: ArrayBuffer) => void;
}

export function createBleedClient(createWorker: () => BleedWorkerLike) {
    let worker: BleedWorkerLike | null = null;
    let nextId = 1;
    const pending = new Map<number, Pending>();
    /** Plan keys the worker has been sent a mask for. */
    const planned = new Set<string>();

    function bleedWorker(): BleedWorkerLike {
        if (worker) return worker;
        const w = createWorker();
        w.onmessage = (e) => {
            const p = pending.get(e.data.id);
            if (!p) return;
            pending.delete(e.data.id);
            if ("bitmap" in e.data) {
                p.resolve(e.data.bitmap);
                return;
            }
            // whatever went wrong, the next request for this key sends its mask
            planned.delete(p.key);
            if (e.data.needsMask && e.data.pixels && p.retry) {
                p.retry(e.data.pixels);
                return;
            }
            p.reject(new Error(`3D View: flats bleed: ${e.data.error}`));
        };
        w.onerror = (e) => {
            for (const p of pending.values())
                p.reject(
                    new Error(`3D View: flats bleed worker: ${e.message}`),
                );
            pending.clear();
            planned.clear();
            w.terminate();
            worker = null;
        };
        worker = w;
        return w;
    }

    /** Bleeds `job`'s pixels and resolves with a premultiplied bitmap. */
    function bleed(job: BleedJob): Promise<ImageBitmap> {
        return new Promise<ImageBitmap>((resolve, reject) => {
            const send = (
                pixels: ArrayBuffer,
                withMask: boolean,
                retried: boolean,
            ) => {
                try {
                    const mask = withMask ? job.mask() : null;
                    const w = bleedWorker();
                    planned.add(job.key);
                    const id = nextId++;
                    pending.set(id, {
                        key: job.key,
                        resolve,
                        reject,
                        retry: retried
                            ? undefined
                            : (back) => send(back, true, true),
                    });
                    const request: FlatsBleedRequest = {
                        id,
                        key: job.key,
                        W: job.W,
                        H: job.H,
                        steps: job.steps,
                        mask,
                        pixels,
                    };
                    w.postMessage(request, [
                        pixels,
                        ...(mask ? [mask.buffer] : []),
                    ]);
                } catch (error) {
                    reject(
                        error instanceof Error
                            ? error
                            : new Error(String(error)),
                    );
                }
            };
            send(job.pixels, !planned.has(job.key), false);
        });
    }

    return { bleed };
}
