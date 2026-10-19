import { describe, expect, it, vi } from "vitest";
import { FieldDimming } from "../fieldDimming";
import {
    FieldFollowing,
    FOLLOWING_LOOK,
    drawnFollowing,
} from "../fieldFollowing";

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
    });

    it("is solid when Set", () => {
        const dimming = new FieldDimming();
        const following = new FieldFollowing();
        following.set(new Set([2]));
        expect(drawnFollowing(dimming, following, 1)).toBe(false);
    });

    it("dashes the edge at least 2 px wide round a 60% fill, solid corners", () => {
        expect(FOLLOWING_LOOK.fillOpacity).toBe(0.6);
        expect(FOLLOWING_LOOK.edgeWidth).toBeGreaterThanOrEqual(1.5);
        expect(FOLLOWING_LOOK.edgeWidth).toBeLessThanOrEqual(2);
        expect(FOLLOWING_LOOK.minEdgePx).toBe(2);
        expect(FOLLOWING_LOOK.circleDashes).toBe(8);
    });
});
