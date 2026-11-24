import { afterEach, describe, expect, it, vi } from "vitest";
import {
    VIEW3D_UNIFORM_PACK_RESULT_CHANNEL,
    type View3dUniformPackResult,
} from "@/view3d/sync/protocol";
import { UniformPackStoreError, storeUniformPack } from "../storeUniformPack";

/** A window API whose editor answers each request with `answer` */
function fakeApi(answer: (id: string) => View3dUniformPackResult | null) {
    const listeners = new Set<(result: View3dUniformPackResult) => void>();
    const sent: { id: string; bytes: Uint8Array }[] = [];
    return {
        sent,
        listeners,
        api: {
            on: ((
                channel: string,
                cb: (r: View3dUniformPackResult) => void,
            ) => {
                expect(channel).toBe(VIEW3D_UNIFORM_PACK_RESULT_CHANNEL);
                listeners.add(cb);
                return () => listeners.delete(cb);
            }) as never,
            requestUniformPack: (request: unknown) => {
                const r = request as { id: string; bytes: Uint8Array };
                sent.push(r);
                const result = answer(r.id);
                if (result)
                    queueMicrotask(() =>
                        [...listeners].forEach((cb) => cb(result)),
                    );
            },
        },
    };
}

afterEach(() => vi.useRealTimers());

describe("storeUniformPack", () => {
    it("resolves with the stored value once the editor answers its id", async () => {
        const { api, sent, listeners } = fakeApi((id) => ({
            id,
            ok: true,
            value: "library:a@b",
        }));
        await expect(
            storeUniformPack(new Uint8Array([1, 2]), { api }),
        ).resolves.toBe("library:a@b");
        expect(Array.from(sent[0].bytes)).toEqual([1, 2]);
        expect(listeners.size).toBe(0);
    });

    it("ignores answers to other requests", async () => {
        vi.useFakeTimers();
        const { api, listeners } = fakeApi(() => ({
            id: "someone-else",
            ok: true,
            value: "library:x@y",
        }));
        const stored = storeUniformPack(new Uint8Array([1]), {
            api,
            timeoutMs: 1000,
        });
        const settled = vi.fn();
        stored.then(settled, settled);
        await vi.advanceTimersByTimeAsync(500);
        expect(settled).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(600);
        await expect(stored).rejects.toMatchObject({ reason: "timedOut" });
        expect(listeners.size).toBe(0);
    });

    it("rejects when the editor couldn't store it", async () => {
        const { api } = fakeApi((id) => ({ id, ok: false }));
        const stored = storeUniformPack(new Uint8Array([1]), { api });
        await expect(stored).rejects.toBeInstanceOf(UniformPackStoreError);
        await expect(stored).rejects.toMatchObject({ reason: "refused" });
    });

    it("rejects when the editor never answers", async () => {
        vi.useFakeTimers();
        const { api, listeners } = fakeApi(() => null);
        const stored = storeUniformPack(new Uint8Array([1]), {
            api,
            timeoutMs: 2000,
        });
        const check = expect(stored).rejects.toMatchObject({
            reason: "timedOut",
        });
        await vi.advanceTimersByTimeAsync(2001);
        await check;
        expect(listeners.size).toBe(0);
    });
});
