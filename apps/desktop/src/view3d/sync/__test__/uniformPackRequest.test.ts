import { describe, expect, it, vi } from "vitest";
import { VIEW3D_UNIFORM_PACK_RESULT_CHANNEL } from "../protocol";
import { storeUniformPackRequest } from "../uniformPackRequest";

describe("storeUniformPackRequest", () => {
    it("stores the bytes and answers with the stored value", async () => {
        const store = vi.fn(async () => ({ value: "library:a@b" }));
        const publish = vi.fn();
        const bytes = new Uint8Array([7]);
        await storeUniformPackRequest({ id: "r1", bytes }, store, publish);
        expect(store).toHaveBeenCalledWith({
            pack: bytes,
            versionOf: undefined,
            expect: undefined,
            amend: undefined,
        });
        expect(publish).toHaveBeenCalledWith(
            VIEW3D_UNIFORM_PACK_RESULT_CHANNEL,
            { id: "r1", ok: true, value: "library:a@b" },
        );
    });

    it("answers ok: false when storing fails", async () => {
        const publish = vi.fn();
        await storeUniformPackRequest(
            { id: "r2", bytes: new Uint8Array([1]) },
            async () => {
                throw new Error("not a pack");
            },
            publish,
        );
        expect(publish).toHaveBeenCalledWith(
            VIEW3D_UNIFORM_PACK_RESULT_CHANNEL,
            { id: "r2", ok: false },
        );
    });

    it("answers each of two overlapping requests", async () => {
        const publish = vi.fn();
        let finishFirst: (value: { value: string }) => void = () => undefined;
        const store = vi
            .fn<() => Promise<{ value: string }>>()
            .mockImplementationOnce(
                () => new Promise((resolve) => (finishFirst = resolve)),
            )
            .mockImplementationOnce(async () => ({
                value: "library:second@b",
            }));
        const first = storeUniformPackRequest(
            { id: "one", bytes: new Uint8Array([1]) },
            store,
            publish,
        );
        await storeUniformPackRequest(
            { id: "two", bytes: new Uint8Array([2]) },
            store,
            publish,
        );
        finishFirst({ value: "library:first@b" });
        await first;
        expect(publish.mock.calls.map(([, r]) => r)).toEqual([
            { id: "two", ok: true, value: "library:second@b" },
            { id: "one", ok: true, value: "library:first@b" },
        ]);
    });

    it("passes an item edit's fields, answers with its token, and says when it was superseded (#1258)", async () => {
        const publish = vi.fn();
        const versionOf = "0f0e0d0c-0b0a-4908-8706-050403020100";
        const store = vi.fn(async () => ({
            value: "library:x@y",
            token: "7\n12\n…",
        }));
        await storeUniformPackRequest(
            {
                id: "e1",
                bytes: new Uint8Array([1]),
                versionOf,
                expect: "library:x@w",
                amend: "7\n12\n…",
            },
            store,
            publish,
        );
        expect(store).toHaveBeenCalledWith({
            pack: new Uint8Array([1]),
            versionOf,
            expect: "library:x@w",
            amend: "7\n12\n…",
        });
        expect(publish).toHaveBeenLastCalledWith(
            VIEW3D_UNIFORM_PACK_RESULT_CHANNEL,
            { id: "e1", ok: true, value: "library:x@y", token: "7\n12\n…" },
        );
        const superseded = new Error("moved on");
        superseded.name = "UniformPackSupersededError";
        await storeUniformPackRequest(
            { id: "e2", bytes: new Uint8Array([1]), expect: "library:x@w" },
            async () => {
                throw superseded;
            },
            publish,
        );
        expect(publish).toHaveBeenLastCalledWith(
            VIEW3D_UNIFORM_PACK_RESULT_CHANNEL,
            { id: "e2", ok: false, superseded: true },
        );
    });

    it("ignores a request that isn't { id, bytes }", async () => {
        const store = vi.fn();
        const publish = vi.fn();
        await storeUniformPackRequest(new Uint8Array([1]), store, publish);
        await storeUniformPackRequest({ id: "", bytes: [] }, store, publish);
        expect(store).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
    });
});
