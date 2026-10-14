import { beforeEach, describe, expect, it } from "vitest";
import { clientXToBeat } from "@/components/timeline/TimelineGeometry";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { seekTimeline } from "../timelineTransport";

/**
 * Scrubbing while paused (ui.md UI-12 review): one seek per whole beat the scrub passes, and the
 * pointer reaches the end of the show, where the playhead may rest (UI-11).
 */

/** Beats 0..16 of 0.5 s; the end of the show is beat 17 */
const BEATS = Array.from({ length: 17 }, (_, i) => ({
    timestamp: i * 0.5,
    duration: 0.5,
}));
const store = () => useTimelineSelectionStore.getState();
const paused = { isPlaying: false, setIsPlaying: () => {} };

beforeEach(() => {
    store().reset();
    store().setShowEndBeat(17);
    store().setPageBoxes([
        { start: 1, end: 9 },
        { start: 9, end: 17 },
    ]);
});

describe("scrubbing while paused", () => {
    it("seeks once per whole beat, skipping moves within the beat it is on", () => {
        // Flags over the whole show, so the scrub stays inside them
        store().selectRange(1, 17);
        const revision = store().playheadRevision;
        seekTimeline(BEATS, 5, "press", paused);
        seekTimeline(BEATS, 5.2, "drag", paused);
        seekTimeline(BEATS, 4.6, "drag", paused);
        expect(store().playheadRevision).toBe(revision + 1);
        seekTimeline(BEATS, 6, "drag", paused);
        expect(store().playheadBeat).toBe(6);
        expect(store().playheadRevision).toBe(revision + 2);
        // The release always lands, even on the beat the scrub is on
        seekTimeline(BEATS, 6, "end", paused);
        expect(store().playheadRevision).toBe(revision + 3);
        // A new gesture starts afresh
        seekTimeline(BEATS, 6, "press", paused);
        expect(store().playheadRevision).toBe(revision + 4);
        seekTimeline(BEATS, 6, "end", paused);
    });

    it("a drag released outside the flags goes back to the end flag; a click brings the flags (UI-22)", () => {
        store().selectRange(1, 9);
        seekTimeline(BEATS, 9, "press", paused);
        seekTimeline(BEATS, 12, "drag", paused);
        seekTimeline(BEATS, 15, "drag", paused);
        expect(store().playheadBeat).toBe(15);
        expect(store().startBeat).toBe(1);
        expect(store().endBeat).toBe(9);
        seekTimeline(BEATS, 15, "end", paused);
        expect(store().playheadBeat).toBe(9);
        expect(store().startBeat).toBe(1);
        expect(store().scrubbing).toBe(false);
        // A click (press and release on one beat) outside the flags brings them to it
        seekTimeline(BEATS, 12, "press", paused);
        seekTimeline(BEATS, 12, "end", paused);
        expect(store().startBeat).toBe(9);
        expect(store().endBeat).toBe(17);
        expect(store().playheadBeat).toBe(12);
        // So does a seek without a gesture (the go-to box)
        seekTimeline(BEATS, 4, undefined, paused);
        expect(store().startBeat).toBe(1);
        expect(store().endBeat).toBe(9);
        // Arrow-key steps past the flags count as a click, not a drag
        const keys = { ...paused, keys: true };
        seekTimeline(BEATS, 9, "press", keys);
        seekTimeline(BEATS, 10, "drag", keys);
        seekTimeline(BEATS, 10, "end", keys);
        expect(store().startBeat).toBe(9);
        expect(store().playheadBeat).toBe(10);
    });

    it("a drag released inside the flags stays there (UI-22)", () => {
        store().selectRange(1, 9);
        seekTimeline(BEATS, 9, "press", paused);
        seekTimeline(BEATS, 14, "drag", paused);
        seekTimeline(BEATS, 5, "drag", paused);
        seekTimeline(BEATS, 5, "end", paused);
        expect(store().playheadBeat).toBe(5);
        expect(store().endBeat).toBe(9);
    });

    it("seeks without a gesture every time", () => {
        store().selectRange(1, 9);
        const revision = store().playheadRevision;
        seekTimeline(BEATS, 5, undefined, paused);
        seekTimeline(BEATS, 5, undefined, paused);
        expect(store().playheadRevision).toBe(revision + 2);
    });

    it("says where each scrub seek landed: the beat sent, or the held playhead", () => {
        store().selectRange(1, 9);
        // Inside a seeked beat too, so a move that doesn't seek still knows
        expect(seekTimeline(BEATS, 5, "press", paused)).toBe(5);
        expect(seekTimeline(BEATS, 5, "drag", paused)).toBe(5);
        expect(seekTimeline(BEATS, 7, "drag", paused)).toBe(7);
        // Not for the release or a seek outside a scrub
        expect(seekTimeline(BEATS, 7, "end", paused)).toBeNull();
        expect(seekTimeline(BEATS, 3, undefined, paused)).toBeNull();
        // Isolation holds the playhead inside [9, 13], after its start
        store().setStoredTimelines([
            { id: 1, start: 9, end: 13, marcherIds: new Set([1]) },
        ]);
        store().isolate(1);
        expect(seekTimeline(BEATS, 11, "press", paused)).toBe(11);
        expect(seekTimeline(BEATS, 15, "drag", paused)).toBe(13);
        expect(seekTimeline(BEATS, 16, "drag", paused)).toBe(13);
        expect(seekTimeline(BEATS, 4, "drag", paused)).toBe(10);
        seekTimeline(BEATS, 4, "end", paused);
    });

    it("reaches the end of the show from the timeline surface", () => {
        expect(
            clientXToBeat({
                clientX: 1000,
                surfaceLeft: 0,
                pixelsPerBeat: 10,
                startBeat: 0,
                beatCount: 17,
            }),
        ).toBe(17);
    });
});

describe("dragging a line by itself while paused (UI-21, UI-22)", () => {
    const playhead = { ...paused, line: "playhead" as const };
    const startFlag = { ...paused, line: "start" as const };
    const endFlag = { ...paused, line: "end" as const };

    it("a playhead dragged by its line is a scrub: it never moves or swaps a flag", () => {
        store().selectRange(5, 12);
        expect(seekTimeline(BEATS, 8, "press", playhead)).toBe(8);
        expect(seekTimeline(BEATS, 3, "drag", playhead)).toBe(3);
        expect(store().startBeat).toBe(5);
        seekTimeline(BEATS, 3, "end", playhead);
        // Released outside the flags: back to the end flag
        expect(store().playheadBeat).toBe(12);
        expect(store().selection).toEqual({ kind: "range", start: 5, end: 12 });
        expect(store().lineDrag).toBeNull();
    });

    it("a start flag dragged past the end flag swaps with it; a cancel puts both back", () => {
        store().selectRange(5, 12);
        seekTimeline(BEATS, 15, "drag", startFlag);
        expect(store().startBeat).toBe(12);
        expect(store().endBeat).toBe(15);
        expect(store().playheadBeat).toBe(12);
        seekTimeline(BEATS, 5, "cancel", startFlag);
        expect(store().selection).toEqual({ kind: "range", start: 5, end: 12 });
        // An arrow step is a whole drag: one end. Onto the end flag, it pushes it on
        seekTimeline(BEATS, 12, "end", startFlag);
        expect(store().startBeat).toBe(12);
        expect(store().endBeat).toBe(13);
    });

    it("an end flag dragged and released moves it; the playhead stays inside the flags", () => {
        store().selectRange(5, 12);
        seekTimeline(BEATS, 14, "drag", endFlag);
        expect(store().playheadBeat).toBe(12);
        seekTimeline(BEATS, 15, "end", endFlag);
        expect(store().endBeat).toBe(15);
        expect(store().playheadBeat).toBe(12);
        expect(store().lineDrag).toBeNull();
    });

    it("a press starts a flag drag afresh, even over one whose release never came", () => {
        store().selectRange(5, 12);
        // An end flag drag that dies with the flags on one beat: no end, no cancel
        seekTimeline(BEATS, 5, "press", endFlag);
        expect(store().startBeat).toBe(5);
        expect(store().endBeat).toBe(5);
        // The next drag, of the start flag, moves the start flag
        seekTimeline(BEATS, 3, "press", startFlag);
        seekTimeline(BEATS, 2, "drag", startFlag);
        expect(store().lineDrag?.line).toBe("start");
        expect(store().startBeat).toBe(2);
        expect(store().endBeat).toBe(5);
    });

    it("an end flag dragged through the start flag swaps on the way, beat by beat", () => {
        store().selectRange(9, 17);
        for (const [beat, start, end] of [
            [12, 9, 12],
            [9, 9, 9],
            [7, 7, 9],
            [4, 4, 9],
        ] as const) {
            seekTimeline(BEATS, beat, beat === 12 ? "press" : "drag", endFlag);
            expect([store().startBeat, store().endBeat]).toEqual([start, end]);
        }
        seekTimeline(BEATS, 4, "end", endFlag);
        expect([store().startBeat, store().endBeat]).toEqual([4, 9]);
        expect(store().lineDrag).toBeNull();
    });

    it("page navigation ends a flag drag", () => {
        store().selectRange(5, 12);
        seekTimeline(BEATS, 14, "press", endFlag);
        store().selectRange(9, 17);
        expect(store().lineDrag).toBeNull();
        seekTimeline(BEATS, 3, "press", { ...paused, line: "start" });
        store().selectHome();
        expect(store().lineDrag).toBeNull();
    });

    it("while playing, a flag drag does nothing", () => {
        store().selectRange(5, 12);
        seekTimeline(BEATS, 15, "drag", { ...startFlag, isPlaying: true });
        seekTimeline(BEATS, 15, "drag", { ...endFlag, isPlaying: true });
        expect(store().selection).toEqual({ kind: "range", start: 5, end: 12 });
        expect(store().endBeat).toBe(12);
    });
});
