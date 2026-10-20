import { describe, expect, it } from "vitest";
import { initialClipDrops, landClip, nextClipDrops } from "../clipDrops";
import type { TimelineTrack } from "../TimelineViewModel";

/**
 * Which clips drop out of a page box (UI-9 **Create page at playhead**, deleting a flag): a move the page boxes stood
 * for that now has a clip. It was hidden behind its box; the box no longer fits it, so it shows
 * as a clip, sliding down from the page row. Found by identity, never by range.
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

const MOVE = track("move", 1, 9);

describe("nextClipDrops", () => {
    it("a move the boxes stood for that now has a clip drops", () => {
        const state = nextClipDrops(
            initialClipDrops(new Set(["move"])),
            [MOVE],
            new Set(),
        );
        expect([...state.drops]).toEqual(["move"]);
    });

    it("a new move, whatever its range, doesn't", () => {
        const state = nextClipDrops(
            initialClipDrops(new Set(["other"])),
            [MOVE, track("window", 3, 7)],
            new Set(["other"]),
        );
        expect(state.drops.size).toBe(0);
    });

    it("a drop stays until its clip lands, however often the moves are read again", () => {
        let state = initialClipDrops(new Set(["move"]));
        state = nextClipDrops(state, [MOVE], new Set());
        state = nextClipDrops(state, [track("move", 1, 9)], new Set());
        expect([...state.drops]).toEqual(["move"]);
        state = landClip(state, "move");
        expect(state.drops.size).toBe(0);
    });

    it("a drop whose clip goes (undo) ends", () => {
        let state = initialClipDrops(new Set(["move"]));
        state = nextClipDrops(state, [MOVE], new Set());
        state = nextClipDrops(state, [], new Set(["move"]));
        expect(state.drops.size).toBe(0);
    });

    it("deleting a flag but not its moves drops both", () => {
        const state = nextClipDrops(
            initialClipDrops(new Set(["first", "second"])),
            [track("first", 1, 5), track("second", 5, 9)],
            new Set(),
        );
        expect([...state.drops].sort()).toEqual(["first", "second"]);
    });

    it("a move deleted with its page doesn't drop: it has no clip", () => {
        const state = nextClipDrops(
            initialClipDrops(new Set(["move"])),
            [],
            new Set(),
        );
        expect(state.drops.size).toBe(0);
    });

    it("a clip without a range never drops", () => {
        const empty: TimelineTrack = { ...MOVE, legs: [], activitySpans: [] };
        const state = nextClipDrops(
            initialClipDrops(new Set(["move"])),
            [empty],
            new Set(),
        );
        expect(state.drops.size).toBe(0);
    });

    it("the same moves behind the boxes keep the state as it is", () => {
        const pageMoves = new Set(["move"]);
        const state = initialClipDrops(pageMoves);
        expect(nextClipDrops(state, [MOVE], pageMoves)).toBe(state);
    });
});
