// @vitest-environment node
/** No reload while a file converts on open (P9.9). */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    beginPreparing,
    resetConversionQuitForTests,
} from "../convertWorkerHost";
import {
    blockReloadWhileConverting,
    isReloadShortcut,
    reloadUnlessConverting,
    type KeyInput,
} from "../reloadGuard";

const key = (init: Partial<KeyInput>): KeyInput => ({
    type: "keyDown",
    key: "r",
    meta: false,
    control: false,
    alt: false,
    ...init,
});

afterEach(() => resetConversionQuitForTests());

describe("the reload guard", () => {
    it("knows the reload shortcuts", () => {
        expect(isReloadShortcut(key({ meta: true }))).toBe(true);
        expect(isReloadShortcut(key({ control: true, key: "R" }))).toBe(true);
        expect(isReloadShortcut(key({ key: "F5" }))).toBe(true);
        expect(isReloadShortcut(key({}))).toBe(false); // plain R
        expect(isReloadShortcut(key({ meta: true, type: "keyUp" }))).toBe(
            false,
        );
        expect(isReloadShortcut(key({ meta: true, key: "q" }))).toBe(false);
    });

    it("swallows a reload shortcut only while a conversion is in progress", () => {
        const event = { preventDefault: vi.fn() };
        expect(blockReloadWhileConverting(event, key({ meta: true }))).toBe(
            false,
        );
        expect(event.preventDefault).not.toHaveBeenCalled();

        const end = beginPreparing();
        expect(blockReloadWhileConverting(event, key({ meta: true }))).toBe(
            true,
        );
        expect(event.preventDefault).toHaveBeenCalledOnce();
        // Other shortcuts (Quit) pass.
        expect(
            blockReloadWhileConverting(event, key({ meta: true, key: "q" })),
        ).toBe(false);
        end();
    });

    it("View > Reload and Force Reload do nothing while a conversion is in progress", () => {
        const page = { reload: vi.fn(), reloadIgnoringCache: vi.fn() };
        const end = beginPreparing();
        expect(reloadUnlessConverting(page, false)).toBe(false);
        expect(reloadUnlessConverting(page, true)).toBe(false);
        expect(page.reload).not.toHaveBeenCalled();
        expect(page.reloadIgnoringCache).not.toHaveBeenCalled();
        end();

        expect(reloadUnlessConverting(page, false)).toBe(true);
        expect(reloadUnlessConverting(page, true)).toBe(true);
        expect(page.reload).toHaveBeenCalledOnce();
        expect(page.reloadIgnoringCache).toHaveBeenCalledOnce();
        expect(reloadUnlessConverting(undefined, false)).toBe(false);
    });
});
