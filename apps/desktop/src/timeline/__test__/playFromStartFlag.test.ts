import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import {
    playTimelineOn,
    playTimelinePage,
    toggleTimelinePlayback,
} from "../timelineTransport";

/**
 * Where Play starts (lab test playback-start, project owner 2026-10-13: version B): Alt+Space plays
 * on from the start flag, and Shift+Space (or Shift+click on Play) plays on from the playhead. In
 * Expert, Space plays the window once (UI-26). Looping is unchanged.
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
    store().setStartStays(true);
    store().setPageBoxes([
        { start: 0, end: 4 },
        { start: 4, end: 8 },
        { start: 8, end: 16 },
    ]);
    // Page 2 selected: the start flag on 4, the playhead on 8; then the playhead moves to 6
    store().selectRange(4, 8);
    store().seekKeepingStart(6);
});

describe("where Play starts", () => {
    it("Alt+Space plays on from the start flag", () => {
        expect(store().startBeat).toBe(4);
        playTimelineOn(transport());
        expect(store().cursorBeat).toBe(4);
        expect(store().playback).toEqual({ kind: "on" });
    });

    it("Space plays the window once, from the start flag to the playhead (UI-26)", () => {
        toggleTimelinePlayback(transport());
        expect(store().cursorBeat).toBe(4);
        expect(store().playback).toEqual({
            kind: "preview",
            from: 4,
            to: 6,
            once: true,
        });
    });

    it("Space plays on from the start flag in Basic", () => {
        store().setStartStays(false);
        toggleTimelinePlayback(transport());
        expect(store().cursorBeat).toBe(4);
        expect(store().playback).toEqual({ kind: "on" });
    });

    it("Shift+Space plays on from the playhead", () => {
        playTimelinePage(transport());
        expect(store().cursorBeat).toBe(6);
        expect(store().playback).toEqual({ kind: "on" });
    });

    it("looping is unchanged: Space loops, Shift+Space plays the loop once", () => {
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
