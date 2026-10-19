import { describe, expect, it } from "vitest";
import type { XY } from "@openmarch/core";
import {
    followingAt,
    isSetAt,
    marcherSetBeats,
    type SetSpan,
} from "../timelineSetFollowing";

/**
 * Set vs Following (#300): a marcher is Set on a count where a move of its own ends with real
 * motion, and on the first page; everywhere else it's Following.
 */

const hold = (start: number, end: number): SetSpan => ({
    start,
    end,
    kind: "hold",
});
const own = (start: number, end: number, assignmentId = 1): SetSpan => ({
    start,
    end,
    kind: "join",
    assignmentId,
});

/** Positions by beat: where each span ends, held before and after. */
const at =
    (stops: readonly (readonly [beat: number, xy: XY])[]) =>
    (beat: number): XY => {
        let xy = stops[0]![1];
        for (const [b, p] of stops) if (b <= beat) xy = p;
        return xy;
    };

describe("one marcher's Set counts", () => {
    // Home at 0,0; moves to 8,0 over beats 1–9; holds; moves to 8,8 over 25–29 (mid-page 5)
    const spans = [
        hold(-Infinity, 1),
        own(1, 9),
        hold(9, 25),
        own(25, 29),
        hold(29, Infinity),
    ];
    const positionAt = at([
        [0, [0, 0]],
        [9, [8, 0]],
        [29, [8, 8]],
    ]);
    const setBeats = marcherSetBeats(spans, positionAt);

    it("is Set on the first page, always", () => {
        expect(isSetAt(setBeats, 0)).toBe(true);
        expect(isSetAt([], 0)).toBe(true);
    });

    it("is Set on a move's exact end beat", () => {
        expect(isSetAt(setBeats, 9)).toBe(true);
        expect(isSetAt(setBeats, 29)).toBe(true);
    });

    it("follows one beat before and one beat after a move's end", () => {
        expect(isSetAt(setBeats, 8)).toBe(false);
        expect(isSetAt(setBeats, 10)).toBe(false);
    });

    it("follows partway through a move", () => {
        expect(isSetAt(setBeats, 5)).toBe(false);
        expect(isSetAt(setBeats, 4.5)).toBe(false);
    });

    it("follows on the flag of a page whose move ended mid-page", () => {
        // Page 5's flag is beat 33; the move ended on beat 29
        expect(isSetAt(setBeats, 33)).toBe(false);
    });

    it("lists its Set beats ascending, without the first page's", () => {
        expect(setBeats).toEqual([9, 29]);
    });

    it("follows on a zero-motion stay move", () => {
        // Only Page N or unlink: a move ending where it began
        const stay = [hold(-Infinity, 1), own(1, 9), hold(9, Infinity)];
        expect(
            isSetAt(
                marcherSetBeats(stay, () => [4, 4]),
                9,
            ),
        ).toBe(false);
    });

    it("follows on a kept assignment, even when an earlier edit gave it motion", () => {
        const kept = [
            hold(-Infinity, 1),
            own(1, 9, 1),
            own(9, 17, 7),
            hold(17, Infinity),
        ];
        const moves = at([
            [0, [0, 0]],
            [9, [8, 0]],
            [17, [0, 0]],
        ]);
        const beats = marcherSetBeats(kept, moves, new Set([7]));
        expect(isSetAt(beats, 9)).toBe(true);
        expect(isSetAt(beats, 17)).toBe(false);
    });
});

describe("who follows at a count", () => {
    const setBeats = new Map<number, readonly number[]>([
        [1, [9, 17]],
        [2, [17]],
        [3, []],
    ]);

    it("is everyone not Set there", () => {
        expect([...followingAt(setBeats, 9)].sort()).toEqual([2, 3]);
        expect([...followingAt(setBeats, 17)]).toEqual([3]);
        expect([...followingAt(setBeats, 12)].sort()).toEqual([1, 2, 3]);
    });

    it("is nobody on the first page", () => {
        expect(followingAt(setBeats, 0).size).toBe(0);
    });
});
