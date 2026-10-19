import { describe, expect, it } from "vitest";
import {
    droppedClips,
    initialClipDrops,
    landClip,
    nextClipDrops,
    pageBoxKeys,
} from "../clipDrops";
import type { TimelinePageMarker, TimelineTrack } from "../TimelineViewModel";

/**
 * Which clips drop out of a page box (UI-9 **+**): a track new to the rows whose range was a page
 * box's range the last time the rows changed. The page's own move was hidden behind its box; the
 * split box no longer fits it, so it shows as a clip, sliding down from the page row.
 */

const track = (id: string, start: number, end: number): TimelineTrack => ({
    id,
    targetId: id,
    targetType: "timeline",
    label: id,
    color: "#2fc4b2",
    legs: [
        { id: `${id}-leg`, startBeat: start, endBeat: end, texture: "move" },
    ],
    activitySpans: [{ startBeatIndex: start, endBeatIndex: end, active: true }],
});

const page = (
    id: number,
    atBeat: number,
    isInitial = false,
): TimelinePageMarker => ({
    id,
    label: String(id),
    atBeat,
    isInitial,
});

describe("pageBoxKeys", () => {
    it("is each page box's range, home left out", () => {
        expect([
            ...pageBoxKeys([page(1, 0, true), page(3, 9), page(2, 1)], 17),
        ]).toEqual(["1:9", "9:17"]);
        expect(pageBoxKeys([], 17).size).toBe(0);
    });
});

describe("droppedClips", () => {
    const boxes = pageBoxKeys([page(1, 0, true), page(2, 1), page(3, 9)], 17);

    it("a new clip with a former page box's range drops", () => {
        expect([...droppedClips([], boxes, [track("page-2", 1, 9)])]).toEqual([
            "page-2",
        ]);
    });

    it("a new clip with any other range, and a clip already shown, don't", () => {
        expect(
            droppedClips([], boxes, [
                track("window", 3, 7),
                track("long", 1, 17),
            ]).size,
        ).toBe(0);
        expect(
            droppedClips([track("page-2", 1, 9)], boxes, [
                track("page-2", 1, 9),
            ]).size,
        ).toBe(0);
    });

    it("only the new clips drop, each by its own range", () => {
        const drops = droppedClips([track("old", 3, 7)], boxes, [
            track("old", 3, 7),
            track("a", 1, 9),
            track("b", 9, 17),
            track("c", 2, 9),
        ]);
        expect([...drops].sort()).toEqual(["a", "b"]);
    });

    it("a clip without a range never drops", () => {
        const empty: TimelineTrack = {
            ...track("empty", 1, 9),
            legs: [],
            activitySpans: [],
        };
        expect(droppedClips([], boxes, [empty]).size).toBe(0);
    });
});

describe("nextClipDrops", () => {
    const whole = [page(1, 0, true), page(2, 1), page(3, 9)];
    const split = [page(1, 0, true), page(4, 1), page(2, 5), page(3, 9)];

    it("a drop stays until its clip lands, however often the rows are rebuilt", () => {
        let state = initialClipDrops([], whole, 17);
        state = nextClipDrops(state, [track("move", 1, 9)], split, 17);
        expect([...state.drops]).toEqual(["move"]);
        // A query settling: the same rows, new arrays
        state = nextClipDrops(state, [track("move", 1, 9)], [...split], 17);
        expect([...state.drops]).toEqual(["move"]);
        state = landClip(state, "move");
        expect(state.drops.size).toBe(0);
    });

    it("a drop whose clip leaves the rows (undo) ends", () => {
        let state = initialClipDrops([], whole, 17);
        state = nextClipDrops(state, [track("move", 1, 9)], split, 17);
        state = nextClipDrops(state, [], whole, 17);
        expect(state.drops.size).toBe(0);
    });

    it("the new pages arriving before the tracks still drop the move", () => {
        let state = initialClipDrops([], whole, 17);
        // The split boxes first, the page's move a render later
        state = nextClipDrops(state, [], split, 17);
        state = nextClipDrops(state, [track("move", 1, 9)], split, 17);
        expect([...state.drops]).toEqual(["move"]);
    });

    it("deleting a flag but not its moves drops both", () => {
        let state = initialClipDrops([], split, 17);
        state = nextClipDrops(state, [], whole, 17);
        state = nextClipDrops(
            state,
            [track("first", 1, 5), track("second", 5, 9)],
            whole,
            17,
        );
        expect([...state.drops].sort()).toEqual(["first", "second"]);
    });

    it("once the rows change, earlier boxes no longer count", () => {
        let state = initialClipDrops([], whole, 17);
        state = nextClipDrops(state, [track("window", 3, 7)], split, 17);
        // Page 1's old box (1:9) is not a box since the rows changed
        state = nextClipDrops(
            state,
            [track("window", 3, 7), track("late", 1, 9)],
            split,
            17,
        );
        expect(state.drops.size).toBe(0);
    });
});
