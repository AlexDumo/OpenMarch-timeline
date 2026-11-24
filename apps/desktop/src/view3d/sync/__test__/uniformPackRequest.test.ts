import { describe, expect, it, vi } from "vitest";
import { VIEW3D_UNIFORM_PACK_RESULT_CHANNEL } from "../protocol";
import { storeUniformPackRequest } from "../uniformPackRequest";

describe("storeUniformPackRequest", () => {
    it("stores the bytes and answers with the stored value", async () => {
        const store = vi.fn(async () => "library:a@b");
        const publish = vi.fn();
        const bytes = new Uint8Array([7]);
        await storeUniformPackRequest({ id: "r1", bytes }, store, publish);
        expect(store).toHaveBeenCalledWith({
            pack: bytes,
            versionOf: undefined,
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
        let finishFirst: (value: string) => void = () => undefined;
        const store = vi
            .fn<(pack: Uint8Array) => Promise<string>>()
            .mockImplementationOnce(
                () => new Promise((resolve) => (finishFirst = resolve)),
            )
            .mockImplementationOnce(async () => "library:second@b");
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
        finishFirst("library:first@b");
        await first;
        expect(publish.mock.calls.map(([, r]) => r)).toEqual([
            { id: "two", ok: true, value: "library:second@b" },
            { id: "one", ok: true, value: "library:first@b" },
        ]);
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
