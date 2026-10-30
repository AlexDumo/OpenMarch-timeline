import { describe, expect, it } from "vitest";
import { isWindowTooSmall } from "../windowTooSmall";

describe("isWindowTooSmall", () => {
    it("fits an iPad mini in portrait and the desktop app's smallest window", () => {
        expect(isWindowTooSmall(744, 1000)).toBe(false);
        expect(isWindowTooSmall(768, 600)).toBe(false);
        expect(isWindowTooSmall(744, 500)).toBe(false);
    });

    it("is too small for a phone, or a window too narrow or too short", () => {
        expect(isWindowTooSmall(390, 844)).toBe(true);
        expect(isWindowTooSmall(743, 900)).toBe(true);
        expect(isWindowTooSmall(1400, 499)).toBe(true);
    });
});
