import { beforeEach, describe, expect, it, vi } from "vitest";

/** The angle lines' setting (#634): shown until hidden, and remembered */
describe("angle lines", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    it("are shown until hidden, and stay as set", async () => {
        const { useAngleLinesStore, ANGLE_LINES_STORAGE_KEY } =
            await import("../angleLines");
        expect(useAngleLinesStore.getState().shown).toBe(true);
        useAngleLinesStore.getState().toggle();
        expect(useAngleLinesStore.getState().shown).toBe(false);
        expect(localStorage.getItem(ANGLE_LINES_STORAGE_KEY)).toBe("[false]");
        vi.resetModules();
        const again = await import("../angleLines");
        expect(again.useAngleLinesStore.getState().shown).toBe(false);
    });
});
