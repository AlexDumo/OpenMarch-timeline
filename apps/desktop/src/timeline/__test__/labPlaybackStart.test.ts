import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLabVariantStore } from "@/lab/labVariant";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { playTimelinePage, toggleTimelinePlayback } from "../timelineTransport";

/**
 * Lab test playback-start (fork-only): version B plays on from the start flag with Space and from
 * the playhead with Shift+Space; version A (no lab version) is the app's current behavior.
 */

vi.mock("@/components/timeline/audio/AudioPlayer", () => ({
    restartLivePlaybackAt: () => {},
}));

const store = () => useTimelineSelectionStore.getState();
const transport = () => ({
    isPlaying: false,
    showEndBeat: 16,
    setIsPlaying: vi.fn(),
});

beforeEach(() => {
    store().reset();
    store().setPageBoxes([
        { start: 0, end: 4 },
        { start: 4, end: 8 },
        { start: 8, end: 16 },
    ]);
    // Page 2 selected: the start flag on 4, the playhead on 8; then the playhead moves to 6
    store().selectRange(4, 8);
    store().seekKeepingStart(6);
});
afterEach(() => useLabVariantStore.getState().setVariant(null));

describe("lab playback-start", () => {
    it("version A: Space plays on from the playhead", () => {
        toggleTimelinePlayback(transport());
        expect(store().cursorBeat).toBe(6);
        expect(store().playback).toEqual({ kind: "on" });
    });

    it("version B: Space plays on from the start flag", () => {
        useLabVariantStore.getState().setVariant("from-flag");
        expect(store().startBeat).toBe(4);
        toggleTimelinePlayback(transport());
        expect(store().cursorBeat).toBe(4);
        expect(store().playback).toEqual({ kind: "on" });
    });

    it("version B: Shift+Space plays on from the playhead", () => {
        useLabVariantStore.getState().setVariant("from-flag");
        playTimelinePage(transport());
        expect(store().cursorBeat).toBe(6);
        expect(store().playback).toEqual({ kind: "on" });
    });

    it("version B: looping is unchanged", () => {
        useLabVariantStore.getState().setVariant("from-flag");
        store().setLoop({ start: 4, end: 8 });
        toggleTimelinePlayback(transport());
        expect(store().playback).toMatchObject({
            kind: "preview",
            from: 4,
            to: 8,
        });
        expect(store().playback).not.toHaveProperty("once");
        playTimelinePage(transport());
        expect(store().playback).toMatchObject({
            kind: "preview",
            from: 4,
            to: 8,
            once: true,
        });
    });
});
