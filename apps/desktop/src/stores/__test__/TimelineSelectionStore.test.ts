import { beforeEach, describe, expect, it } from "vitest";
import {
    displayedBeat,
    editWindow,
    fieldBeat,
    followingStart,
    isMarcherDimmed,
    lineDragPositions,
    normalizePlayheadBeat,
    resolveStoredTimeline,
    selectedStoredTimeline,
    useTimelineSelectionStore,
    type StoredTimelineMembership,
} from "../TimelineSelectionStore";

const timeline = (
    id: number,
    start: number,
    end: number,
    marcherIds: number[],
): StoredTimelineMembership => ({
    id,
    start,
    end,
    marcherIds: new Set(marcherIds),
});

const store = () => useTimelineSelectionStore.getState();

/** Page boxes for flags at 9, 17 and 25 (page 1's box starts at beat 1) */
const BOXES = [
    { start: 1, end: 9 },
    { start: 9, end: 17 },
    { start: 17, end: 25 },
];

describe("TimelineSelectionStore (UI-9, UI-10)", () => {
    beforeEach(() => {
        store().reset();
        store().setStartStays(true);
        store().setPageBoxes([]);
    });

    it("opens on home with the playhead at beat 0", () => {
        expect(store().selection).toEqual({ kind: "home" });
        expect(store().playheadBeat).toBe(0);
        expect(store().storedTimelines).toBeNull();
    });

    it("selecting a range seeks to its end; home seeks to 0", () => {
        store().selectRange(1, 9);
        expect(store().selection).toEqual({ kind: "range", start: 1, end: 9 });
        expect(store().playheadBeat).toBe(9);
        store().selectHome();
        expect(store().selection).toEqual({ kind: "home" });
        expect(store().playheadBeat).toBe(0);
    });

    it("seeking moves the playhead and the window's end, and bumps the revision even in place", () => {
        store().setPageBoxes(BOXES);
        store().selectRange(1, 9);
        const revision = store().playheadRevision;
        store().seek(4);
        // UI-10: the window ends at the playhead, and the unpinned start flag follows it
        expect(store().selection).toEqual({ kind: "range", start: 1, end: 4 });
        expect(store().playheadBeat).toBe(4);
        store().seek(4);
        expect(store().playheadRevision).toBe(revision + 2);
    });

    it("keeps the selection object when a write leaves the window unchanged", () => {
        store().setPageBoxes(BOXES);
        store().selectRange(1, 9);
        const range = store().selection;
        store().seek(9);
        store().seekKeepingStart(9);
        store().beginScrub();
        store().endScrub();
        expect(store().selection).toBe(range);
        store().seek(5);
        expect(store().selection).not.toBe(range);
        expect(store().selection).toEqual({ kind: "range", start: 1, end: 5 });

        store().selectHome();
        const home = store().selection;
        store().seek(0);
        expect(store().selection).toBe(home);
        store().selectNothing();
        const none = store().selection;
        store().selectNothing();
        expect(store().selection).toBe(none);
    });

    it("writes show time 0 as beat 0", () => {
        store().seek(1);
        expect(store().playheadBeat).toBe(0);
        expect(normalizePlayheadBeat(1)).toBe(0);
        expect(normalizePlayheadBeat(1, false)).toBe(1);
        expect(normalizePlayheadBeat(2.4)).toBe(2);
    });

    it("resolves a range to the stored timeline with exactly that range", () => {
        const timelines = [timeline(5, 1, 9, [1]), timeline(6, 9, 17, [2])];
        expect(
            resolveStoredTimeline(
                { kind: "range", start: 9, end: 17 },
                timelines,
            )?.id,
        ).toBe(6);
        expect(
            resolveStoredTimeline(
                { kind: "range", start: 9, end: 16 },
                timelines,
            ),
        ).toBeNull();
        expect(resolveStoredTimeline({ kind: "home" }, timelines)).toBeNull();
        expect(
            resolveStoredTimeline({ kind: "range", start: 1, end: 9 }, null),
        ).toBeNull();
    });

    it("keeps the selection when its timeline is stored or deleted", () => {
        store().selectRange(1, 9);
        expect(selectedStoredTimeline(store())).toBeNull();
        store().setStoredTimelines([timeline(5, 1, 9, [1])]);
        expect(selectedStoredTimeline(store())?.id).toBe(5);
        store().setStoredTimelines([]);
        expect(store().selection).toEqual({ kind: "range", start: 1, end: 9 });
        expect(selectedStoredTimeline(store())).toBeNull();
    });

    it("dims nobody under UI-10: dragging is what adds", () => {
        store().setStoredTimelines([
            timeline(5, 1, 9, [1]),
            timeline(6, 17, 25, []),
        ]);
        store().selectRange(1, 9);
        expect(isMarcherDimmed(store(), 2)).toBe(false);
        store().selectRange(17, 25);
        expect(isMarcherDimmed(store(), 1)).toBe(false);
    });

    it("dims nobody on a range before the stored timelines load", () => {
        store().selectRange(1, 9);
        expect(store().storedTimelines).toBeNull();
        expect(isMarcherDimmed(store(), 1)).toBe(false);
    });

    it("in Basic the start flag follows navigation to the page box holding the playhead", () => {
        store().setStartStays(false);
        store().setPageBoxes(BOXES);
        store().seek(13);
        expect(store().startBeat).toBe(9);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 13 });
        store().seek(17); // on a flag: the box ending there
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 17 });
        store().seek(30); // past the last flag: the last flag
        expect(store().selection).toEqual({
            kind: "range",
            start: 25,
            end: 30,
        });
        store().seek(0);
        expect(store().selection).toEqual({ kind: "home" });
    });

    it("in Expert the start flag stays through seeks ahead of it (UI-26)", () => {
        store().setPageBoxes(BOXES);
        store().selectRange(9, 17);
        store().seek(22); // past a page: the flag stays
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 22 });
        store().seek(12);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 12 });
        store().selectRange(17, 25); // going to a page moves it
        expect(store().startBeat).toBe(17);
    });

    it("in Expert a seek behind the start flag makes it the start flag, and the old one the playhead (UI-26)", () => {
        store().setPageBoxes(BOXES);
        store().selectRange(17, 25);
        const revision = store().playheadRevision;
        store().seek(12);
        expect(store().startBeat).toBe(12);
        expect(store().playheadBeat).toBe(17);
        expect(store().selection).toEqual({
            kind: "range",
            start: 12,
            end: 17,
        });
        expect(store().playheadRevision).toBe(revision + 1);
        // Across pages too, literally (owner, Q1)
        store().seek(3);
        expect(store().selection).toEqual({ kind: "range", start: 3, end: 12 });
    });

    it("in Expert a seek on the start flag's beat makes the beat after it the window (UI-26)", () => {
        store().setShowEndBeat(25);
        store().setPageBoxes(BOXES);
        store().selectRange(9, 17);
        store().seek(9);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 10 });
        // At the show's end there is no beat after it: the beat before it
        store().selectRange(25, 25);
        store().seek(25);
        expect(store().selection).toEqual({
            kind: "range",
            start: 24,
            end: 25,
        });
    });

    it("in Expert beat 0 is home, wherever the start flag is (UI-26)", () => {
        store().setPageBoxes(BOXES);
        store().selectRange(9, 17);
        store().seek(0);
        expect(store().selection).toEqual({ kind: "home" });
        expect(store().startBeat).toBe(0);
    });

    it("in Expert setLoop sets the window to the loop, and the loop follows the window (UI-26)", () => {
        store().setPageBoxes(BOXES);
        store().selectRange(9, 17);
        expect(store().loop).toBeNull();
        // Ctrl+drag or a loop end's drag: the window goes there
        store().setLoop({ start: 12, end: 16 });
        expect(store().loop).toEqual({ start: 12, end: 16 });
        expect(store().selection).toEqual({
            kind: "range",
            start: 12,
            end: 16,
        });
        // The same region is not a new write
        const loop = store().loop;
        store().setLoop({ start: 12, end: 16 });
        expect(store().loop).toBe(loop);
        // Moving the window moves the loop: a seek, a page, a line drag
        store().seek(20);
        expect(store().loop).toEqual({ start: 12, end: 20 });
        store().selectRange(17, 25);
        expect(store().loop).toEqual({ start: 17, end: 25 });
        store().beginLineDrag("start");
        store().dragLine(20);
        store().endLineDrag();
        expect(store().loop).toEqual({ start: 20, end: 25 });
        // Home leaves it
        store().selectHome();
        expect(store().loop).toEqual({ start: 20, end: 25 });
        // Shorter than one beat is off, including a zero-length one
        store().setLoop({ start: 12, end: 12.5 });
        expect(store().loop).toBeNull();
        store().setLoop({ start: 4, end: 4 });
        expect(store().loop).toBeNull();
    });

    it("while playing, setLoop leaves the window (UI-26)", () => {
        store().setPageBoxes(BOXES);
        store().selectRange(9, 17);
        store().setPlayback({ kind: "on" });
        store().setLoop({ start: 1, end: 9 });
        expect(store().loop).toEqual({ start: 1, end: 9 });
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 17 });
    });

    it("in Basic, setLoop and seeks leave each other alone", () => {
        store().setStartStays(false);
        store().setPageBoxes(BOXES);
        store().setLoop({ start: 1, end: 9 });
        const loop = store().loop;
        store().seek(14);
        store().selectRange(17, 25);
        expect(store().loop).toBe(loop);
    });

    it("page 1's box starts at beat 1, and show time 0 is home", () => {
        store().setStartStays(false);
        store().setPageBoxes(BOXES);
        store().seek(5);
        expect(store().startBeat).toBe(1);
        expect(editWindow(1, 1, BOXES)).toEqual({ kind: "home" });
        expect(followingStart(1, BOXES)).toBe(0);
    });

    it("in Basic the start flag follows to the page boxes when they arrive", () => {
        store().setStartStays(false);
        store().seek(13);
        expect(store().startBeat).toBe(0); // no boxes yet
        store().setPageBoxes(BOXES);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 13 });
    });

    it("in Expert the start flag stays when the page boxes arrive", () => {
        store().selectRange(5, 13);
        store().setPageBoxes(BOXES);
        expect(store().selection).toEqual({ kind: "range", start: 5, end: 13 });
    });

    it("computes the window and the following start as pure functions", () => {
        expect(followingStart(0, BOXES)).toBe(0);
        expect(followingStart(5, BOXES)).toBe(1);
        expect(followingStart(5, [])).toBe(0);
        expect(editWindow(9, 13, BOXES)).toEqual({
            kind: "range",
            start: 9,
            end: 13,
        });
        expect(editWindow(9, 9, BOXES)).toEqual({
            kind: "range",
            start: 1,
            end: 9,
        });
        expect(editWindow(9, 0, BOXES)).toEqual({ kind: "home" });
    });

    it("moves a selection with its timeline's clip move, and no other", () => {
        store().selectRange(1, 9);
        store().followTimelineShift({ start: 9, end: 17 }, 2);
        expect(store().selection).toEqual({ kind: "range", start: 1, end: 9 });
        store().followTimelineShift({ start: 1, end: 9 }, 2);
        expect(store().selection).toEqual({ kind: "range", start: 3, end: 11 });
        // UI-10: the window's end is the playhead, so it moves too
        expect(store().playheadBeat).toBe(11);
    });

    it("moves the loaded stored timeline with the selection, so it still resolves before the reload", () => {
        store().setStoredTimelines([
            timeline(5, 1, 9, [1, 2]),
            timeline(6, 9, 17, [3]),
        ]);
        store().selectRange(1, 9);
        store().followTimelineShift({ start: 1, end: 9 }, 2);
        expect(selectedStoredTimeline(store())?.id).toBe(5);
        expect(isMarcherDimmed(store(), 1)).toBe(false);
        expect(store().storedTimelines!.map((t) => [t.start, t.end])).toEqual([
            [3, 11],
            [9, 17],
        ]);
    });

    describe("isolation (docs/timeline/research/ownership/09-isolation.md)", () => {
        const TIMELINES = [
            timeline(1, 1, 9, [1, 2]),
            timeline(2, 9, 17, [1, 2, 3]),
            timeline(3, 12, 20, [3]),
        ];
        beforeEach(() => {
            store().setPageBoxes(BOXES);
            store().setStoredTimelines(TIMELINES);
        });

        it("sets the window to the timeline and dims and locks only those outside it", () => {
            store().seek(5);
            store().isolate(3);
            expect(store().isolation?.timelineId).toBe(3);
            expect(store().selection).toEqual({
                kind: "range",
                start: 12,
                end: 20,
            });
            expect(isMarcherDimmed(store(), 3)).toBe(false);
            expect(isMarcherDimmed(store(), 1)).toBe(true);
            // Ignored: a timeline that isn't loaded
            store().isolate(99);
            expect(store().isolation?.timelineId).toBe(3);
        });

        it("keeps the playhead inside the timeline and the start flag on its start", () => {
            store().isolate(3);
            store().seek(30);
            expect(store().playheadBeat).toBe(20);
            // Never on the start flag: UI-10 would fall back to the previous page box there
            store().seek(2);
            expect(store().playheadBeat).toBe(13);
            store().seek(15);
            expect(store().startBeat).toBe(12);
            expect(store().selection).toEqual({
                kind: "range",
                start: 12,
                end: 15,
            });
            store().seekKeepingStart(40);
            expect(store().playheadBeat).toBe(20);
        });

        it("Esc (exit) restores the start flag and playhead it saved", () => {
            store().selectRange(3, 9);
            store().isolate(2);
            store().isolate(3);
            store().seek(14);
            store().exitIsolation();
            expect(store().isolation).toBeNull();
            expect(store().startBeat).toBe(3);
            expect(store().playheadBeat).toBe(9);
        });

        it("navigating to a page box, home or a dragged range ends isolation", () => {
            store().isolate(3);
            store().selectRange(1, 9);
            expect(store().isolation).toBeNull();
            store().isolate(3);
            store().selectHome();
            expect(store().isolation).toBeNull();
        });

        it("ends when the timeline goes away, and follows it when its range changes", () => {
            store().isolate(3);
            store().setStoredTimelines([
                TIMELINES[0]!,
                TIMELINES[1]!,
                timeline(3, 14, 22, [3]),
            ]);
            expect(store().isolation).toMatchObject({ start: 14, end: 22 });
            expect(store().selection).toEqual({
                kind: "range",
                start: 14,
                end: 20,
            });
            store().setStoredTimelines(TIMELINES.slice(0, 2));
            expect(store().isolation).toBeNull();
            expect(isMarcherDimmed(store(), 1)).toBe(false);
        });

        it("seeking onto the isolated start keeps the window on the isolated move (code review 1)", () => {
            store().isolate(2);
            store().seek(9);
            expect(store().playheadBeat).toBe(10);
            expect(store().selection).toEqual({
                kind: "range",
                start: 9,
                end: 10,
            });
        });

        it("keeps S on the isolated start when the page boxes change (code review 4)", () => {
            store().isolate(2);
            store().seek(12);
            store().setPageBoxes([
                { start: 1, end: 6 },
                { start: 6, end: 17 },
                { start: 17, end: 25 },
            ]);
            expect(store().selection).toEqual({
                kind: "range",
                start: 9,
                end: 12,
            });
        });

        it("moves S and P with the isolated clip even with P mid-range (code review 5)", () => {
            store().isolate(3);
            store().seek(15);
            store().followTimelineShift({ start: 12, end: 20 }, 2);
            expect(store().isolation).toMatchObject({ start: 14, end: 22 });
            expect(store().selection).toEqual({
                kind: "range",
                start: 14,
                end: 17,
            });
            // The reload then finds the range unchanged
            store().setStoredTimelines([
                TIMELINES[0]!,
                TIMELINES[1]!,
                timeline(3, 14, 22, [3]),
            ]);
            expect(store().selection).toEqual({
                kind: "range",
                start: 14,
                end: 17,
            });
        });

        it("restores the window it was given (the one before a double-click's clicks; code review 3)", () => {
            store().selectRange(3, 9);
            const before = {
                startBeat: store().startBeat,
                playheadBeat: store().playheadBeat,
            };
            // The double-click's single clicks select the page box first
            store().selectRange(9, 17);
            store().isolate(2, before);
            store().exitIsolation();
            expect(store().selection).toEqual({
                kind: "range",
                start: 3,
                end: 9,
            });
        });

        it("selecting nothing ends isolation (code review 10)", () => {
            store().isolate(3);
            store().selectNothing();
            expect(store().isolation).toBeNull();
            expect(isMarcherDimmed(store(), 1)).toBe(false);
        });
    });
});

describe("the start flag during a gesture in Basic (UI-12 review)", () => {
    beforeEach(() => {
        store().reset();
        store().setStartStays(false);
        store().setPageBoxes(BOXES);
    });

    it("stays put while a scrub moves the playhead", () => {
        store().selectRange(9, 17);
        store().beginScrub();
        store().seek(21);
        expect(store().startBeat).toBe(9);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 21 });
        // Back on or before S: the window falls back to the page box holding P, as after Stop
        store().seek(5);
        expect(store().startBeat).toBe(9);
        expect(store().selection).toEqual({ kind: "range", start: 1, end: 5 });
        store().seek(23);
        expect(store().startBeat).toBe(9);
    });

    it("follows the playhead once when the scrub ends", () => {
        store().selectRange(9, 17);
        store().beginScrub();
        store().seek(23);
        const revision = store().playheadRevision;
        store().endScrub();
        expect(store().scrubbing).toBe(false);
        expect(store().startBeat).toBe(17);
        expect(store().selection).toEqual({
            kind: "range",
            start: 17,
            end: 23,
        });
        // The playhead didn't move, so nothing restarts
        expect(store().playheadRevision).toBe(revision);
        // Not scrubbing: seeking follows at once again
        store().seek(5);
        expect(store().startBeat).toBe(1);
    });

    it("leaves isolation's S where it is", () => {
        store().setStoredTimelines([timeline(1, 5, 17, [1])]);
        store().isolate(1);
        store().beginScrub();
        store().seek(9);
        store().endScrub();
        expect(store().startBeat).toBe(5);
    });

    it("a page box, home or opening a show ends the gesture", () => {
        store().beginScrub();
        store().selectRange(9, 17);
        expect(store().scrubbing).toBe(false);
        store().beginScrub();
        store().selectHome();
        expect(store().scrubbing).toBe(false);
        store().beginScrub();
        store().reset();
        store().setStartStays(true);
        expect(store().scrubbing).toBe(false);
    });
});

describe("an Expert scrub (UI-26)", () => {
    beforeEach(() => {
        store().reset();
        store().setStartStays(true);
        store().setPageBoxes(BOXES);
    });

    it("drags the playhead as its line does: behind the start flag they swap live, and back", () => {
        store().selectRange(9, 17);
        store().beginScrub();
        expect(store().lineDrag).toMatchObject({
            line: "playhead",
            scrub: true,
        });
        store().seek(21);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 21 });
        store().seek(4);
        expect(store().selection).toEqual({ kind: "range", start: 4, end: 9 });
        // The field shows the dragged line, which is the start flag now
        expect(fieldBeat(store())).toBe(4);
        store().seek(12);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 12 });
        store().endScrub();
        expect(store().lineDrag).toBeNull();
        expect(store().scrubbing).toBe(false);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 12 });
        expect(fieldBeat(store())).toBe(12);
    });

    it("released on the start flag's beat, the playhead lands a beat after it, as a click does", () => {
        store().selectRange(9, 17);
        store().beginScrub();
        store().seek(9);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 9 });
        store().endScrub();
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 10 });
    });

    it("in isolation it is a plain scrub", () => {
        store().setStoredTimelines([timeline(1, 5, 17, [1])]);
        store().isolate(1);
        store().beginScrub();
        expect(store().lineDrag).toBeNull();
        store().seek(9);
        store().endScrub();
        expect(store().selection).toEqual({ kind: "range", start: 5, end: 9 });
    });

    it("a page box ends it", () => {
        store().selectRange(9, 17);
        store().beginScrub();
        store().selectRange(17, 25);
        expect(store().lineDrag).toBeNull();
        expect(store().scrubbing).toBe(false);
    });
});

describe("the field's beat while a flag moves (UI-26)", () => {
    beforeEach(() => {
        store().reset();
        store().setStartStays(true);
        store().setPageBoxes(BOXES);
    });

    it("shows the dragged start flag, and the playhead again on release", () => {
        store().selectRange(9, 17);
        store().beginLineDrag("start");
        expect(fieldBeat(store())).toBe(9);
        store().dragLine(12);
        expect(fieldBeat(store())).toBe(12);
        // Swapped, the dragged line is the playhead now
        store().dragLine(20);
        expect(fieldBeat(store())).toBe(20);
        store().endLineDrag();
        expect(fieldBeat(store())).toBe(20);
        store().beginLineDrag("start");
        store().dragLine(14);
        store().endLineDrag();
        expect(fieldBeat(store())).toBe(20);
    });

    it("shows the start flag while peeked", () => {
        store().selectRange(9, 17);
        store().peekStart(true);
        expect(fieldBeat(store())).toBe(9);
        store().peekStart(false);
        expect(fieldBeat(store())).toBe(17);
    });
});

describe("dragging the start flag or the playhead by its line (UI-21)", () => {
    beforeEach(() => {
        store().reset();
        store().setStartStays(true);
        store().setPageBoxes(BOXES);
    });

    it("keeps the left line the start flag and the right one the playhead", () => {
        const drag = {
            line: "start" as const,
            startBeat: 5,
            playheadBeat: 12,
            beat: 5,
        };
        expect(lineDragPositions(drag, 8)).toEqual({
            startBeat: 8,
            playheadBeat: 12,
            swapped: false,
        });
        expect(lineDragPositions(drag, 20)).toEqual({
            startBeat: 12,
            playheadBeat: 20,
            swapped: true,
        });
        const playhead = { ...drag, line: "playhead" as const };
        expect(lineDragPositions(playhead, 9)).toEqual({
            startBeat: 5,
            playheadBeat: 9,
            swapped: false,
        });
        expect(lineDragPositions(playhead, 2)).toEqual({
            startBeat: 2,
            playheadBeat: 5,
            swapped: true,
        });
    });

    it("a start flag dragged past the playhead becomes the playhead, and the playhead the start flag", () => {
        store().selectRange(5, 12);
        store().beginLineDrag("start");
        store().dragLine(8);
        expect(store().selection).toEqual({ kind: "range", start: 8, end: 12 });
        const revision = store().playheadRevision;
        store().dragLine(20);
        expect(store().startBeat).toBe(12);
        expect(store().playheadBeat).toBe(20);
        expect(store().selection).toEqual({
            kind: "range",
            start: 12,
            end: 20,
        });
        expect(store().playheadRevision).toBe(revision + 1);
        // Back across, live: they trade back
        store().dragLine(7);
        expect(store().selection).toEqual({ kind: "range", start: 7, end: 12 });
        store().dragLine(20);
        store().endLineDrag();
        expect(store().lineDrag).toBeNull();
        expect(store().selection).toEqual({
            kind: "range",
            start: 12,
            end: 20,
        });
    });

    it("a playhead dragged behind the start flag becomes the start flag, and the start flag the playhead", () => {
        store().selectRange(5, 12);
        store().beginLineDrag("playhead");
        store().dragLine(3);
        expect(store().startBeat).toBe(3);
        expect(store().playheadBeat).toBe(5);
        store().endLineDrag();
        expect(store().selection).toEqual({ kind: "range", start: 3, end: 5 });
    });

    it("in Expert a playhead that never crosses leaves the start flag", () => {
        store().selectRange(9, 17);
        store().beginLineDrag("playhead");
        store().dragLine(23);
        store().endLineDrag();
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 23 });
    });

    it("in Basic a playhead that never crosses ends as a scrub: the start flag follows it", () => {
        store().setStartStays(false);
        store().selectRange(9, 17);
        store().beginLineDrag("playhead");
        store().dragLine(23);
        expect(store().startBeat).toBe(9);
        store().endLineDrag();
        expect(store().startBeat).toBe(17);
    });

    it("a swapped playhead stays swapped", () => {
        store().selectRange(9, 17);
        store().beginLineDrag("playhead");
        store().dragLine(4);
        store().endLineDrag();
        expect(store().selection).toEqual({ kind: "range", start: 4, end: 9 });
    });

    it("on one page flag, neither page shows selected until release (owner 2026-10-14)", () => {
        store().selectRange(9, 17);
        store().beginLineDrag("start");
        store().dragLine(17);
        expect(store().startBeat).toBe(17);
        expect(store().playheadBeat).toBe(17);
        expect(store().selection).toEqual({
            kind: "range",
            start: 17,
            end: 17,
        });
    });

    it("in the middle of a page, neither part shows selected", () => {
        store().selectRange(9, 13);
        store().beginLineDrag("playhead");
        store().dragLine(9);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 9 });
        // Moving off again shows the window
        store().dragLine(11);
        expect(store().selection).toEqual({
            kind: "range",
            start: 9,
            end: 11,
        });
    });

    it("a start flag released on the playhead pushes the playhead a beat later", () => {
        store().selectRange(9, 13);
        store().beginLineDrag("start");
        store().dragLine(13);
        const revision = store().playheadRevision;
        store().endLineDrag();
        expect(store().lineDrag).toBeNull();
        expect(store().selection).toEqual({
            kind: "range",
            start: 13,
            end: 14,
        });
        expect(store().playheadRevision).toBe(revision + 1);
    });

    it("a start flag released on the playhead at the show's end pushes nothing past it", () => {
        store().setShowEndBeat(25);
        store().selectRange(17, 25);
        store().beginLineDrag("start");
        store().dragLine(25);
        store().endLineDrag();
        expect(store().selection).toEqual({
            kind: "range",
            start: 24,
            end: 25,
        });
    });

    it("a playhead released on the start flag pushes the start flag a beat earlier", () => {
        store().selectRange(9, 17);
        store().beginLineDrag("playhead");
        store().dragLine(9);
        const revision = store().playheadRevision;
        store().endLineDrag();
        expect(store().selection).toEqual({ kind: "range", start: 8, end: 9 });
        expect(store().playheadRevision).toBe(revision);
    });

    it("a start flag mid-page and a playhead released on it", () => {
        store().selectRange(12, 17);
        store().beginLineDrag("playhead");
        store().dragLine(12);
        store().endLineDrag();
        expect(store().selection).toEqual({
            kind: "range",
            start: 11,
            end: 12,
        });
    });

    it("both lines released home stay home", () => {
        store().selectRange(1, 9);
        store().beginLineDrag("playhead");
        store().dragLine(0);
        expect(store().selection).toEqual({ kind: "home" });
        store().endLineDrag();
        expect(store().selection).toEqual({ kind: "home" });
    });

    it("cancelling puts both lines back", () => {
        store().selectRange(5, 12);
        store().beginLineDrag("start");
        store().dragLine(20);
        store().cancelLineDrag();
        expect(store().startBeat).toBe(5);
        expect(store().playheadBeat).toBe(12);
        expect(store().lineDrag).toBeNull();
    });

    it("does nothing in isolation", () => {
        store().setStoredTimelines([timeline(1, 5, 17, [1])]);
        store().isolate(1);
        store().beginLineDrag("start");
        expect(store().lineDrag).toBeNull();
        store().dragLine(20);
        expect(store().playheadBeat).toBe(17);
    });

    it("playing or isolating ends a line drag where it is", () => {
        store().selectRange(5, 12);
        store().beginLineDrag("start");
        store().dragLine(20);
        store().setPlayback({ kind: "preview", from: 12, to: 20 });
        expect(store().lineDrag).toBeNull();
        expect(store().selection).toEqual({
            kind: "range",
            start: 12,
            end: 20,
        });
        store().setPlayback(null);
        store().setStoredTimelines([timeline(1, 5, 17, [1])]);
        store().beginLineDrag("playhead");
        store().isolate(1);
        expect(store().lineDrag).toBeNull();
    });
});

describe("the playback cursor (UI-11)", () => {
    beforeEach(() => {
        store().reset();
        store().setStartStays(true);
        store().setPageBoxes(BOXES);
        store().setShowEndBeat(25);
        store().selectRange(9, 17);
    });

    it("shows the held frame, or else the playhead", () => {
        expect(displayedBeat(store())).toBe(17);
        store().cue(11);
        expect(displayedBeat(store())).toBe(11);
    });

    it("cueing moves the cursor without moving the window, and restarts playback", () => {
        const revision = store().playheadRevision;
        store().cue(11);
        expect(store().cursorBeat).toBe(11);
        expect(store().playheadBeat).toBe(17);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 17 });
        expect(store().playheadRevision).toBe(revision + 1);
        store().cue(40);
        expect(store().cursorBeat).toBe(25);
    });

    it("every write of the window puts the cursor back on the playhead", () => {
        store().cue(11);
        store().seek(13);
        expect(store().cursorBeat).toBeNull();
        store().cue(11);
        store().selectRange(1, 9);
        expect(store().cursorBeat).toBeNull();
        store().cue(3);
        store().selectHome();
        expect(store().cursorBeat).toBeNull();
        store().cue(3);
        store().selectNothing();
        expect(store().cursorBeat).toBeNull();
    });

    it("reloads keep the cursor while playing, so the audio isn't restarted at the playhead", () => {
        store().setPlayback({ kind: "preview", from: 7, to: 19 });
        store().cue(11);
        store().setPageBoxes([...BOXES, { start: 25, end: 33 }]);
        expect(store().cursorBeat).toBe(11);
        store().setPlayback(null);
        store().setPageBoxes(BOXES);
        expect(store().cursorBeat).toBeNull();
    });

    it("a reload while playing doesn't restart the audio (code review)", () => {
        store().setStoredTimelines([timeline(1, 9, 17, [1])]);
        store().isolate(1);
        store().setPlayback({ kind: "preview", from: 9, to: 17 });
        store().cue(11);
        const revision = store().playheadRevision;
        store().setStoredTimelines([timeline(1, 9, 19, [1])]);
        expect(store().isolation?.end).toBe(19);
        expect(store().playheadRevision).toBe(revision);
        expect(store().cursorBeat).toBe(11);
    });

    it("a reload after an edit drops a held frame, so the canvas shows the edit at P (code review)", () => {
        store().cue(11);
        store().setStoredTimelines([timeline(1, 9, 17, [1])]);
        expect(store().cursorBeat).toBeNull();
        expect(store().playheadBeat).toBe(17);
    });

    it("reset clears the loop (UI-17)", () => {
        store().setPageBoxes(BOXES);
        store().selectRange(12, 17);
        store().setLoop({ start: 9, end: 17 });
        expect(store().loop).toEqual({ start: 9, end: 17 });
        store().reset();
        store().setStartStays(true);
        expect(store().loop).toBeNull();
        expect(store().startBeat).toBe(0);
        expect(store().playheadBeat).toBe(0);
        expect(store().playback).toBeNull();
    });
});
