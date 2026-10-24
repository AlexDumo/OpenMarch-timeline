import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useTempoModeStore } from "@/tempo/tempoModeStore";
import {
    consumeEndRequest,
    stopTimelinePlayback,
    toggleTimelinePlayback,
} from "../timelineTransport";

/**
 * PROTOTYPE (tempo mode, owner 2026-10-21): while tempo mode is on, Play plays on from the
 * playhead, as a DAW does, and Stop stays where playback stopped; outside it the editor's rules
 * stand.
 */

vi.mock("@/components/timeline/audio/AudioPlayer", () => ({
    restartLivePlaybackAt: () => {},
}));

const store = () => useTimelineSelectionStore.getState();
const transport = () => ({ isPlaying: false, setIsPlaying: vi.fn() });

beforeEach(() => {
    store().reset();
    store().setShowEndBeat(16);
    store().setStartStays(true);
    store().setPageBoxes([
        { start: 0, end: 4 },
        { start: 4, end: 8 },
        { start: 8, end: 16 },
    ]);
    // Page 2 selected: the start flag on 4, the playhead moved to 6
    store().selectRange(4, 8);
    store().seekKeepingStart(6);
});

afterEach(() => {
    useTempoModeStore.setState({ on: false });
    consumeEndRequest();
});

describe("Play in tempo mode", () => {
    it("plays on from the playhead, not the window from the start flag", () => {
        useTempoModeStore.setState({ on: true });
        toggleTimelinePlayback(transport());
        expect(store().cursorBeat).toBe(6);
        expect(store().playback).toEqual({ kind: "on" });
    });

    it("loops the loop with looping on", () => {
        useTempoModeStore.setState({ on: true });
        store().setLoop({ start: 4, end: 8 });
        toggleTimelinePlayback(transport());
        expect(store().cursorBeat).toBe(4);
        expect(store().playback).toEqual({ kind: "preview", from: 4, to: 8 });
    });

    it("stops where it is", () => {
        useTempoModeStore.setState({ on: true });
        toggleTimelinePlayback(transport());
        stopTimelinePlayback(vi.fn());
        expect(consumeEndRequest()).toBe("pause");
    });

    it("goes back when the caller asks (a tap pass)", () => {
        useTempoModeStore.setState({ on: true });
        toggleTimelinePlayback(transport());
        stopTimelinePlayback(vi.fn(), "stop");
        expect(consumeEndRequest()).toBe("stop");
    });

    it("leaves the editor's rule alone outside tempo mode", () => {
        toggleTimelinePlayback(transport());
        expect(store().cursorBeat).toBe(4);
        expect(store().playback).toMatchObject({ kind: "preview", once: true });
        stopTimelinePlayback(vi.fn());
        expect(consumeEndRequest()).toBe("stop");
    });
});
