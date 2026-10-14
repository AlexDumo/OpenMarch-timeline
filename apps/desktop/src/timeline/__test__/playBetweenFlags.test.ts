import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import {
    playRange,
    playTimeline,
    pressTimelinePlayKey,
    stopTimelinePlayback,
    toggleTimelineLoop,
} from "../timelineTransport";

/**
 * Play between the flags (docs/timeline/ui.md UI-22, project owner 2026-10-14): Play always goes to
 * the start flag and plays to the end flag, looping there with looping on.
 */

vi.mock("@/components/timeline/audio/AudioPlayer", () => ({
    restartLivePlaybackAt: () => {},
}));

const store = () => useTimelineSelectionStore.getState();

beforeEach(() => {
    store().reset();
    store().setPageBoxes([
        { start: 0, end: 4 },
        { start: 4, end: 8 },
        { start: 8, end: 16 },
    ]);
    // Page 2 selected: the start flag on 4, the playhead and end flag on 8
    store().selectRange(4, 8);
});

describe("Play (UI-22)", () => {
    it("plays from the start flag to the end flag, wherever the playhead is", () => {
        // Pinned flags, and the playhead dragged past them
        store().selectRange(5, 8);
        store().setEnd(12);
        store().seek(14);
        const setIsPlaying = vi.fn();
        expect(playTimeline(setIsPlaying)).toBe(true);
        expect(setIsPlaying).toHaveBeenCalledWith(true);
        expect(store().cursorBeat).toBe(5);
        expect(store().playheadBeat).toBe(14);
        expect(store().playback).toEqual({
            kind: "preview",
            from: 5,
            to: 12,
            once: true,
        });
    });

    it("an unpinned start flag follows the playhead to its page, as it always has (UI-10)", () => {
        store().setEnd(12);
        store().seek(14);
        expect(store().startBeat).toBe(8);
        expect(playRange(store())).toEqual({ from: 8, to: 12 });
    });

    it("loops with looping on; C turns it on and off, and not in isolation", () => {
        toggleTimelineLoop();
        expect(store().looping).toBe(true);
        playTimeline(vi.fn());
        expect(store().playback).toMatchObject({ once: false });
        toggleTimelineLoop();
        expect(store().looping).toBe(false);
        expect(store().playback).toMatchObject({ once: true });
    });

    it("at home goes to the first page and plays it", () => {
        store().selectHome();
        expect(playRange(store())).toBeNull();
        expect(playTimeline(vi.fn())).toBe(true);
        expect(store().playheadBeat).toBe(4);
        expect(store().playback).toMatchObject({ from: 0, to: 4 });
    });

    it("with the end flag before a pinned start flag, plays the end flag's page box", () => {
        store().selectRange(6, 8); // a pinned start flag on 6
        expect(store().startPinned).toBe(true);
        store().seek(5);
        expect(playRange(store())).toEqual({ from: 4, to: 5 });
    });

    it("a play key plays when paused, and stops or pauses while playing", () => {
        const setIsPlaying = vi.fn();
        pressTimelinePlayKey("pause", false, setIsPlaying);
        expect(setIsPlaying).toHaveBeenLastCalledWith(true);
        pressTimelinePlayKey("pause", true, setIsPlaying);
        expect(setIsPlaying).toHaveBeenLastCalledWith(false);
        store().setPlayback({ kind: "preview", from: 4, to: 8 });
        pressTimelinePlayKey("stop", true, setIsPlaying);
        expect(setIsPlaying).toHaveBeenLastCalledWith(false);
    });

    it("Stop, paused, puts the playhead on the end flag", () => {
        store().pauseAt(6, 4);
        expect(store().playheadBeat).toBe(6);
        stopTimelinePlayback(false, vi.fn());
        expect(store().playheadBeat).toBe(8);
    });
});
