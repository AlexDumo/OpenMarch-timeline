import { describe, expect, it, vi } from "vitest";
import { FieldDimming } from "../fieldDimming";
import {
    FieldFollowing,
    FOLLOWING_OPACITY,
    drawnFollowing,
    marcherOpacity,
} from "../fieldFollowing";
import { DIMMED_OPACITY } from "../fieldDimming";

describe("FieldFollowing", () => {
    it("fades the Following marchers, and nobody without a set", () => {
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

describe("a marcher's drawn opacity", () => {
    it("is isolation's dim when dimmed, whether or not it follows", () => {
        const dimming = new FieldDimming();
        const following = new FieldFollowing();
        dimming.set(new Set([1]));
        following.set(new Set([1, 2, 3]));
        expect(marcherOpacity(dimming, following, 1)).toBe(FOLLOWING_OPACITY);
        expect(marcherOpacity(dimming, following, 2)).toBe(DIMMED_OPACITY);
        expect(drawnFollowing(dimming, following, 1)).toBe(true);
        expect(drawnFollowing(dimming, following, 2)).toBe(false);
    });

    it("is solid when Set", () => {
        const dimming = new FieldDimming();
        const following = new FieldFollowing();
        following.set(new Set([2]));
        expect(marcherOpacity(dimming, following, 1)).toBe(1);
        expect(FOLLOWING_OPACITY).toBeGreaterThan(DIMMED_OPACITY);
    });
});
