import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import {
    navigateTimeline,
    playRange,
    playTimeline,
    pressTimelinePlayKey,
    seekTimeline,
    stopTimelinePlayback,
    toggleTimelineLoop,
} from "../timelineTransport";

/**
 * Play between the flags (docs/timeline/ui.md UI-22, project owner 2026-10-14): Play always goes to
 * the start flag and plays to the end flag, looping there with looping on.
 */

vi.mock("@/components/timeline/audio/AudioPlayer", () => ({
    restartLivePlaybackAt: () => {},
    getLivePlaybackPosition: () => 0,
    playbackStartInfoRef: { current: null },
}));

const store = () => useTimelineSelectionStore.getState();
const BEATS = Array.from({ length: 17 }, (_, i) => ({
    timestamp: i * 0.5,
    duration: 0.5,
}));
const PAGES = [
    { start: 0, end: 4 },
    { start: 4, end: 8 },
    { start: 8, end: 16 },
];

beforeEach(() => {
    store().reset();
    store().setShowEndBeat(16);
    store().setPageBoxes(PAGES);
    // Page 2 selected: the start flag on 4, the playhead and end flag on 8
    store().selectRange(4, 8);
});

describe("Play (UI-22)", () => {
    it("plays from the start flag to the end flag, wherever the playhead is in them", () => {
        store().seek(6);
        const setIsPlaying = vi.fn();
        expect(playTimeline(setIsPlaying)).toBe(true);
        expect(setIsPlaying).toHaveBeenCalledWith(true);
        expect(store().cursorBeat).toBe(4);
        expect(store().playheadBeat).toBe(6);
        expect(store().playback).toEqual({
            kind: "preview",
            from: 4,
            to: 8,
            once: true,
        });
    });

    it("loops with looping on; C turns it on and off, isolated too", () => {
        toggleTimelineLoop();
        expect(store().looping).toBe(true);
        playTimeline(vi.fn());
        expect(store().playback).toMatchObject({ once: false });
        toggleTimelineLoop();
        expect(store().looping).toBe(false);
        expect(store().playback).toMatchObject({ once: true });
        store().setPlayback(null);
        store().setStoredTimelines([
            { id: 1, start: 4, end: 8, marcherIds: new Set([1]) },
        ]);
        store().isolate(1);
        toggleTimelineLoop();
        expect(store().looping).toBe(true);
    });

    it("at home goes to the first page and plays it", () => {
        store().selectHome();
        expect(playRange(store())).toBeNull();
        expect(playTimeline(vi.fn())).toBe(true);
        expect(store().playheadBeat).toBe(4);
        expect(store().playback).toMatchObject({ from: 0, to: 4 });
    });

    it("pressed during a drag outside the flags, plays from the dragged beat", () => {
        const paused = { isPlaying: false, setIsPlaying: () => {} };
        // Before the start flag: to the end flag
        seekTimeline(BEATS, 6, "press", paused);
        seekTimeline(BEATS, 2, "drag", paused);
        const setIsPlaying = vi.fn();
        playTimeline(setIsPlaying);
        expect(setIsPlaying).toHaveBeenCalledWith(true);
        expect(store().cursorBeat).toBe(2);
        expect(store().playback).toMatchObject({ kind: "preview", to: 8 });
        expect(store().scrubbing).toBe(false);
        // The rest of the gesture does nothing
        seekTimeline(BEATS, 12, "drag", { ...paused, isPlaying: true });
        seekTimeline(BEATS, 12, "end", { ...paused, isPlaying: true });
        expect(store().playheadBeat).toBe(2);
        // Past the end flag: on to the end of the show
        store().setPlayback(null);
        store().selectRange(4, 8);
        seekTimeline(BEATS, 8, "press", paused);
        seekTimeline(BEATS, 12, "drag", paused);
        playTimeline(vi.fn());
        expect(store().cursorBeat).toBe(12);
        expect(store().playback).toEqual({ kind: "on" });
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
        store().seek(6);
        stopTimelinePlayback(false, vi.fn());
        expect(store().playheadBeat).toBe(8);
    });

    it("Q/E while playing stop and go to that page, paused", () => {
        store().setPlayback({ kind: "preview", from: 4, to: 8, once: true });
        const setIsPlaying = vi.fn();
        // No live position: from the beat the timeline shows (the playhead on 8)
        navigateTimeline(BEATS, [], true, "next-beat", setIsPlaying);
        expect(setIsPlaying).toHaveBeenCalledWith(false);
        // A beat on from 8 is outside the flags: they come to it
        expect(store().playheadBeat).toBe(9);
        expect(store().startBeat).toBe(8);
        expect(store().endBeat).toBe(16);
    });
});
