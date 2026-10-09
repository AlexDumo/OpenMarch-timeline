import { describe, expect, it } from "vitest";
import {
    classifyWheel,
    damp,
    groundHit,
    wheelPixels,
    zoomTargetTowards,
} from "../inputMath";

describe("classifyWheel", () => {
    it("reads a ctrl wheel as a pinch (how macOS reports a trackpad pinch)", () => {
        expect(
            classifyWheel({
                deltaX: 0,
                deltaY: -3.2,
                deltaMode: 0,
                ctrlKey: true,
            }),
        ).toBe("pinch");
    });

    it("reads a notched wheel as a mouse", () => {
        // Chromium: a notch is deltaY 100 and wheelDeltaY -120
        expect(
            classifyWheel({
                deltaX: 0,
                deltaY: 100,
                deltaMode: 0,
                ctrlKey: false,
                wheelDeltaY: -120,
            }),
        ).toBe("mouse");
        expect(
            classifyWheel({
                deltaX: 0,
                deltaY: 3,
                deltaMode: 1,
                ctrlKey: false,
            }),
        ).toBe("mouse");
    });

    it("reads fine-grained two-finger scrolls as a trackpad", () => {
        expect(
            classifyWheel({
                deltaX: 0,
                deltaY: 4,
                deltaMode: 0,
                ctrlKey: false,
                wheelDeltaY: -12,
            }),
        ).toBe("trackpad");
        expect(
            classifyWheel({
                deltaX: 6,
                deltaY: 0,
                deltaMode: 0,
                ctrlKey: false,
            }),
        ).toBe("trackpad");
        expect(
            classifyWheel({
                deltaX: 0,
                deltaY: 2.5,
                deltaMode: 0,
                ctrlKey: false,
            }),
        ).toBe("trackpad");
    });
});

describe("wheelPixels", () => {
    it("converts lines and pages to pixels", () => {
        expect(wheelPixels(3, 1)).toBe(48);
        expect(wheelPixels(1, 2)).toBe(400);
        expect(wheelPixels(-7, 0)).toBe(-7);
    });
});

describe("groundHit", () => {
    it("finds where a downward ray meets the ground", () => {
        const hit = groundHit([0, 10, 10], [0, -1, -1]);
        expect(hit).not.toBeNull();
        expect(hit![0]).toBeCloseTo(0, 9);
        expect(hit![1]).toBeCloseTo(0, 9);
        expect(hit![2]).toBeCloseTo(0, 9);
    });

    it("misses a ray at or above the horizon, and one that lands absurdly far", () => {
        expect(groundHit([0, 10, 0], [0, 0.1, -1])).toBeNull();
        expect(groundHit([0, 10, 0], [0, 0, -1])).toBeNull();
        expect(groundHit([0, 10, 0], [0, -0.0001, -1])).toBeNull(); // 100 km away
    });
});

describe("zoomTargetTowards", () => {
    it("moves the target toward the point by the share the radius shrinks", () => {
        const t = zoomTargetTowards([0, 0, 0], [10, 0, 20], 100, 50);
        expect(t).toEqual([5, 0, 10]);
    });

    it("moves it away when zooming out, and keeps the target's height", () => {
        const t = zoomTargetTowards([0, 2, 0], [10, 0, 0], 100, 200);
        expect(t[0]).toBeCloseTo(-10, 9);
        expect(t[1]).toBe(2);
    });
});

describe("damp", () => {
    it("halves over one half-life whatever the frame rate", () => {
        expect(damp(8, 100, 100)).toBeCloseTo(4, 9);
        let v = 8;
        for (let i = 0; i < 10; i++) v = damp(v, 10, 100);
        expect(v).toBeCloseTo(4, 9);
    });
});
