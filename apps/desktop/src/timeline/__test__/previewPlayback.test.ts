import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { usePreviewModeStore } from "@/stores/PreviewModeStore";
import {
    consumeEndRequest,
    playTimelineOn,
    playTimelinePage,
    stopTimelinePlayback,
    toggleTimelineLoop,
    toggleTimelinePlayback,
} from "../timelineTransport";

/**
 * Preview always plays on (no loop, no window): from the beat on show, or from the start once it
 * has played to the end, and stopping pauses where it is, as a video does.
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
    usePreviewModeStore.setState({ isPreview: true });
});

afterEach(() => {
    usePreviewModeStore.setState({ isPreview: false });
    consumeEndRequest();
});

describe("Preview's playback", () => {
    it("Space plays on from the playhead, not the window once", () => {
        toggleTimelinePlayback(transport());
        expect(store().cursorBeat).toBe(6);
        expect(store().playback).toEqual({ kind: "on" });
    });

    it("plays on even with looping on, and C doesn't change the loop", () => {
        store().setLoop({ start: 4, end: 8 });
        toggleTimelinePlayback(transport());
        expect(store().playback).toEqual({ kind: "on" });
        toggleTimelineLoop();
        expect(store().loop).toEqual({ start: 4, end: 8 });
    });

    it("Alt+Space and Shift+Space play on from the playhead too", () => {
        playTimelineOn(transport());
        expect(store().cursorBeat).toBe(6);
        expect(store().playback).toEqual({ kind: "on" });
        store().setPlayback(null);
        store().clearCursor();
        playTimelinePage(transport());
        expect(store().cursorBeat).toBe(6);
        expect(store().playback).toEqual({ kind: "on" });
    });

    it("plays from the start once the playhead is at the end of the show", () => {
        store().seekKeepingStart(16);
        const t = transport();
        toggleTimelinePlayback(t);
        expect(store().cursorBeat).toBe(0);
        expect(store().playback).toEqual({ kind: "on" });
        expect(t.setIsPlaying).toHaveBeenCalledWith(true);
    });

    it("stopping pauses where it is instead of going back", () => {
        store().setPlayback({ kind: "on" });
        stopTimelinePlayback(vi.fn());
        expect(consumeEndRequest()).toBe("pause");

        usePreviewModeStore.setState({ isPreview: false });
        stopTimelinePlayback(vi.fn());
        expect(consumeEndRequest()).toBe("stop");
    });
});
