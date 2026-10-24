import { beforeEach, describe, expect, it } from "vitest";
import {
    resolveStoredTimeline,
    selectedStoredTimeline,
    useTimelineSelectionStore,
    windowMove,
    type StoredTimelineMembership,
} from "../TimelineSelectionStore";

/**
 * Several moves over one range (docs/timeline/ui.md UI-25): the page box stands for the oldest,
 * and a clicked clip's move is the window's (`windowTimelineId`) until the window leaves its range.
 */

const timeline = (
    id: number,
    start: number,
    end: number,
    marcherIds: number[],
    name: string | null = null,
): StoredTimelineMembership => ({
    id,
    start,
    end,
    marcherIds: new Set(marcherIds),
    name,
});

const store = () => useTimelineSelectionStore.getState();

const BOXES = [
    { start: 1, end: 9, name: "1" },
    { start: 9, end: 17, name: "2" },
    { start: 17, end: 25, name: "3" },
];

// Page 2's own timeline (3), a move split off it (7) and a move inside page 3 (5)
const PAGE = timeline(3, 9, 17, [1, 2, 3]);
const SPLIT = timeline(7, 9, 17, [4, 5], "Move 2");
const INSIDE = timeline(5, 18, 22, [6], "Move 1");

describe("several moves over one range (UI-25)", () => {
    beforeEach(() => {
        store().reset();
        store().setPageBoxes(BOXES);
        store().setStoredTimelines([PAGE, INSIDE, SPLIT]);
    });

    it("resolves a range to the oldest unless another over it is picked", () => {
        const range = { kind: "range", start: 9, end: 17 } as const;
        expect(resolveStoredTimeline(range, [SPLIT, PAGE])?.id).toBe(3);
        expect(resolveStoredTimeline(range, [SPLIT, PAGE], 7)?.id).toBe(7);
        // A picked id that isn't over the range is ignored
        expect(resolveStoredTimeline(range, [SPLIT, PAGE], 5)?.id).toBe(3);
    });

    it("a page box selects the page's timeline, and its clip selects the split move, which is a move", () => {
        store().selectRange(9, 17);
        expect(selectedStoredTimeline(store())?.id).toBe(3);
        expect(windowMove(store())).toBeNull();
        store().selectRange(9, 17, 7);
        expect(store().windowTimelineId).toBe(7);
        expect(selectedStoredTimeline(store())?.id).toBe(7);
        expect(windowMove(store())?.id).toBe(7);
    });

    it("forgets the picked move when the window leaves its range or the move goes", () => {
        store().selectRange(9, 17, 7);
        store().seek(20);
        expect(store().windowTimelineId).toBeNull();
        store().selectRange(9, 17, 7);
        store().setStoredTimelines([PAGE, INSIDE]);
        expect(store().windowTimelineId).toBeNull();
        expect(selectedStoredTimeline(store())?.id).toBe(3);
    });

    it("isolating the split move keeps it the window's move, and leaving restores the window from before", () => {
        store().selectRange(9, 17, 7);
        store().selectRange(9, 17);
        store().isolate(7);
        expect(windowMove(store())?.id).toBe(7);
        store().exitIsolation();
        expect(store().windowTimelineId).toBeNull();
        expect(selectedStoredTimeline(store())?.id).toBe(3);
        store().selectRange(9, 17, 7);
        store().isolate(7);
        store().exitIsolation();
        expect(store().windowTimelineId).toBe(7);
    });

    it("a resize of the split move moves only it and the window that is on it", () => {
        store().selectRange(9, 17, 7);
        store().followTimelineRange(
            { start: 9, end: 17 },
            { start: 9, end: 15 },
            7,
        );
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 15 });
        const ranges = new Map(
            store().storedTimelines!.map((t) => [t.id, [t.start, t.end]]),
        );
        expect(ranges.get(7)).toEqual([9, 15]);
        expect(ranges.get(3)).toEqual([9, 17]);
        expect(store().windowTimelineId).toBe(7);
    });

    it("a resize of the split move while its page is the window leaves the window alone", () => {
        store().selectRange(9, 17);
        store().followTimelineRange(
            { start: 9, end: 17 },
            { start: 9, end: 15 },
            7,
        );
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 17 });
    });

    it("a paired move goes with any change of the window", () => {
        store().selectRange(9, 17);
        store().pairTimeline(7);
        expect(store().pairedTimelineId).toBe(7);
        store().seek(17);
        expect(store().pairedTimelineId).toBe(7);
        store().selectRange(17, 25);
        expect(store().pairedTimelineId).toBeNull();
    });
});
