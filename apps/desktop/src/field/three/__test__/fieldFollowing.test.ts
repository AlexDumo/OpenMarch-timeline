import { describe, expect, it, vi } from "vitest";
import { FieldDimming } from "../fieldDimming";
import {
    FieldFollowing,
    FOLLOWING_EASE_MS,
    FOLLOWING_OPACITY,
    type FadeClock,
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

/** A clock the test steps by hand: frames run only when `frame` is called. */
function manualClock() {
    let now = 0;
    let pending: (() => void) | null = null;
    const clock: FadeClock = {
        now: () => now,
        requestFrame: (callback) => {
            pending = callback;
            return 1;
        },
        cancelFrame: () => {
            pending = null;
        },
    };
    return {
        clock,
        /** Moves time on by `ms` and runs the frame asked for, if any. */
        frame(ms: number) {
            now += ms;
            const run = pending;
            pending = null;
            run?.();
        },
        get waiting() {
            return pending !== null;
        },
    };
}

describe("easing into the fade on Stop", () => {
    it("ends faded, and stops asking for frames once it gets there", () => {
        const time = manualClock();
        const dimming = new FieldDimming();
        const following = new FieldFollowing(time.clock);
        following.set(new Set([1]), { ease: true });
        // Who's Following is known straight away: selecting doesn't wait
        expect(following.isFollowing(1)).toBe(true);
        for (let t = 0; t < FOLLOWING_EASE_MS; t += 16) time.frame(16);
        time.frame(16);
        expect(marcherOpacity(dimming, following, 1)).toBe(FOLLOWING_OPACITY);
        expect(time.waiting).toBe(false);
    });

    it("redraws the layers on each frame of the ease", () => {
        const time = manualClock();
        const following = new FieldFollowing(time.clock);
        const listener = vi.fn();
        following.subscribe(listener);
        following.set(new Set([1]), { ease: true });
        const version = following.version;
        time.frame(16);
        expect(following.version).toBeGreaterThan(version);
        expect(listener.mock.calls.length).toBeGreaterThan(1);
    });

    it("goes solid at once when playback starts again mid-ease", () => {
        const time = manualClock();
        const dimming = new FieldDimming();
        const following = new FieldFollowing(time.clock);
        following.set(new Set([1]), { ease: true });
        time.frame(16);
        following.set(null);
        expect(marcherOpacity(dimming, following, 1)).toBe(1);
        expect(time.waiting).toBe(false);
    });

    it("fades straight away without an ease", () => {
        const time = manualClock();
        const dimming = new FieldDimming();
        const following = new FieldFollowing(time.clock);
        following.set(new Set([1]));
        expect(marcherOpacity(dimming, following, 1)).toBe(FOLLOWING_OPACITY);
        expect(time.waiting).toBe(false);
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
