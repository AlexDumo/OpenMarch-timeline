import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const toastError = vi.fn();
vi.mock("@/utilities/utils", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    conToastError: (...args: unknown[]) => toastError(...args),
}));

const { applyPreviousDotsFieldImage } = await import("../newShowCompletion");

const form = (fieldImage: Uint8Array | null) =>
    ({ previousDotsImport: { fieldImage } }) as never;

describe("applyPreviousDotsFieldImage (D-23)", () => {
    afterEach(() => vi.clearAllMocks());

    it("asks main to make the floor from the previous show's image", async () => {
        const setFloor = vi.fn().mockResolvedValue(undefined);
        window.electron = { setNewShowFloorFromImage: setFloor } as never;
        const image = new Uint8Array([1, 2, 3]);

        await applyPreviousDotsFieldImage(form(image), new QueryClient());

        expect(setFloor).toHaveBeenCalledWith(image);
        expect(toastError).not.toHaveBeenCalled();
    });

    it("says so, without failing the new show, when the floor can't be made", async () => {
        window.electron = {
            setNewShowFloorFromImage: vi
                .fn()
                .mockRejectedValue(new Error("not an image")),
        } as never;

        await expect(
            applyPreviousDotsFieldImage(
                form(new Uint8Array([9])),
                new QueryClient(),
            ),
        ).resolves.toBeUndefined();
        expect(toastError).toHaveBeenCalledWith(
            "Couldn't copy the previous show's field image",
            expect.any(Error),
        );
    });

    it("does nothing without an image", async () => {
        const setFloor = vi.fn();
        window.electron = { setNewShowFloorFromImage: setFloor } as never;
        await applyPreviousDotsFieldImage(form(null), new QueryClient());
        expect(setFloor).not.toHaveBeenCalled();
    });
});
