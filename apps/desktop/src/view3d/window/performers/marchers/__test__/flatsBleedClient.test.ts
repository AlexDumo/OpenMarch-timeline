/**
 * The window's side of the flats bleed worker: a worker with no plan for a
 * layout answers `needsMask`, and the request goes again once with the mask,
 * so a failed first plan doesn't leave that layout failing until reload.
 */
import { describe, expect, it } from "vitest";
import {
    createBleedClient,
    type BleedJob,
    type BleedWorkerLike,
} from "../flatsBleedClient";
import type {
    FlatsBleedRequest,
    FlatsBleedResponse,
} from "../flatsBleed.worker";

/** A worker that keeps plans like the real one, and can fail to work one out. */
function fakeWorker(opts: { failPlans?: number } = {}) {
    let failPlans = opts.failPlans ?? 0;
    const plans = new Set<string>();
    const seen: { key: string; withMask: boolean }[] = [];
    let created = 0;
    const create = (): BleedWorkerLike => {
        created++;
        const w: BleedWorkerLike = {
            onmessage: null,
            onerror: null,
            terminate: () => undefined,
            postMessage(req: FlatsBleedRequest) {
                seen.push({ key: req.key, withMask: req.mask !== null });
                let reply: FlatsBleedResponse;
                if (!plans.has(req.key) && !req.mask)
                    reply = {
                        id: req.id,
                        error: "no plan",
                        needsMask: true,
                        pixels: req.pixels,
                    };
                else if (!plans.has(req.key) && failPlans > 0) {
                    failPlans--;
                    reply = { id: req.id, error: "plan failed" };
                } else {
                    plans.add(req.key);
                    reply = {
                        id: req.id,
                        bitmap: { width: req.W } as unknown as ImageBitmap,
                    };
                }
                queueMicrotask(() =>
                    w.onmessage?.({ data: reply } as MessageEvent),
                );
            },
        };
        return w;
    };
    return {
        create,
        seen,
        created: () => created,
        forget: () => plans.clear(),
    };
}

const job = (key = "a"): BleedJob & { masks: number } => {
    const j = {
        key,
        W: 4,
        H: 2,
        steps: 1,
        pixels: new ArrayBuffer(4 * 2 * 4),
        masks: 0,
        mask: () => {
            j.masks++;
            return new Uint8Array(8);
        },
    };
    return j;
};

describe("flats bleed client", () => {
    it("sends the mask only the first time it sees a layout", async () => {
        const w = fakeWorker();
        const client = createBleedClient(w.create);
        await client.bleed(job());
        await client.bleed(job());
        expect(w.seen).toEqual([
            { key: "a", withMask: true },
            { key: "a", withMask: false },
        ]);
    });

    it("after a plan fails, the next request sends the mask again and succeeds", async () => {
        const w = fakeWorker({ failPlans: 1 });
        const client = createBleedClient(w.create);
        await expect(client.bleed(job())).rejects.toThrow(/plan failed/);
        const second = job();
        await expect(client.bleed(second)).resolves.toBeDefined();
        expect(second.masks).toBe(1);
    });

    it("answers needsMask by retrying once with the mask", async () => {
        const w = fakeWorker();
        const client = createBleedClient(w.create);
        await client.bleed(job());
        // the worker lost its plan (restarted, say) while the window thinks it has one
        w.forget();
        const again = job();
        await expect(client.bleed(again)).resolves.toBeDefined();
        expect(again.masks).toBe(1);
        expect(w.seen.slice(1)).toEqual([
            { key: "a", withMask: false },
            { key: "a", withMask: true },
        ]);
    });

    it("rejects rather than retrying forever", async () => {
        // a worker that never keeps a plan
        const seen: boolean[] = [];
        const client = createBleedClient(() => {
            const w: BleedWorkerLike = {
                onmessage: null,
                onerror: null,
                terminate: () => undefined,
                postMessage(req: FlatsBleedRequest) {
                    seen.push(req.mask !== null);
                    queueMicrotask(() =>
                        w.onmessage?.({
                            data: {
                                id: req.id,
                                error: "no plan",
                                needsMask: true,
                                pixels: req.pixels,
                            },
                        } as MessageEvent),
                    );
                },
            };
            return w;
        });
        await expect(client.bleed(job())).rejects.toThrow(/no plan/);
        expect(seen).toEqual([true, true]);
    });
});
