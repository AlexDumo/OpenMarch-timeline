import { describe, expect, it } from "vitest";
import { droppedClips, pageBoxKeys } from "../clipDrops";
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
