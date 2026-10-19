import { describe, expect, it, vi } from "vitest";
import { FieldDimming } from "../fieldDimming";
import {
    FieldFollowing,
    FOLLOWING_LABEL_OPACITY,
    HOLLOW_FILL_OPACITY,
    drawnFollowing,
    labelOpacity,
} from "../fieldFollowing";
import { DIMMED_OPACITY } from "../fieldDimming";

describe("FieldFollowing", () => {
    it("marks the Following marchers, and nobody without a set", () => {
        const following = new FieldFollowing();
        expect(following.isFollowing(1)).toBe(false);
        following.set(new Set([2]));
        expect([1, 2].map((id) => following.isFollowing(id))).toEqual([
            false,
            true,
        ]);
        following.set(null);
        expect(following.isFollowing(2)).toBe(false);
    });

    it("changes nothing, and asks for no frame, when the same marchers follow", () => {
        const following = new FieldFollowing();
        const listener = vi.fn();
        following.subscribe(listener);
        following.set(new Set([1, 2]));
        const version = following.version;
        // The playhead moves to another count with the same Set marchers
        following.set(new Set([2, 1]));
        expect(listener).toHaveBeenCalledTimes(1);
        expect(following.version).toBe(version);
    });
});

describe("a marcher's drawn look", () => {
    it("is isolation's dim when dimmed, whether or not it follows", () => {
        const dimming = new FieldDimming();
        const following = new FieldFollowing();
        dimming.set(new Set([1]));
        following.set(new Set([1, 2, 3]));
        expect(drawnFollowing(dimming, following, 1)).toBe(true);
        expect(drawnFollowing(dimming, following, 2)).toBe(false);
        expect(labelOpacity(dimming, following, 1)).toBe(
            FOLLOWING_LABEL_OPACITY,
        );
        expect(labelOpacity(dimming, following, 2)).toBe(DIMMED_OPACITY);
    });

    it("is solid when Set", () => {
        const dimming = new FieldDimming();
        const following = new FieldFollowing();
        following.set(new Set([2]));
        expect(drawnFollowing(dimming, following, 1)).toBe(false);
        expect(labelOpacity(dimming, following, 1)).toBe(1);
    });

    it("keeps a Following label readable: under Set, over dimmed", () => {
        expect(FOLLOWING_LABEL_OPACITY).toBeLessThan(1);
        expect(FOLLOWING_LABEL_OPACITY).toBeGreaterThanOrEqual(0.75);
        expect(HOLLOW_FILL_OPACITY).toBeLessThan(0.5);
    });
});
