import { afterEach, describe, expect, it } from "vitest";
import type { FtlEntryInfo, SpanInfo } from "@openmarch/core";
import { isTrailEndShape } from "../trailShape";
import { setFollowTheLeader } from "../followTheLeader";

/**
 * A trail's end shape takes no click as a whole (#1101): `isTrailEndShape` tells a placed shape
 * whose marchers are one follow-the-leader line arriving at its beat
 */

/** Marchers 1..4 arrive at beat 16 by transition 30 (follow-the-leader when `ftl`) */
const resolver = (ftl: boolean, line: number[] = [1, 2, 3, 4]) => ({
    spanInfos: (marcherId: number): SpanInfo[] => [
        {
            marcherId,
            start: -Infinity,
            end: 8,
            kind: "hold",
            assignmentId: null,
            assignmentEnd: null,
            transitionId: null,
            slot: null,
        },
        {
            marcherId,
            start: 8,
            end: 16,
            kind: "founding",
            assignmentId: 100 + marcherId,
            assignmentEnd: 16,
            transitionId: 30,
            slot: marcherId - 1,
        },
    ],
    ftlEntry: (transitionId: number): FtlEntryInfo => {
        if (!ftl) throw new Error(`transition ${transitionId} is not FTL`);
        return {
            transitionId,
            members: line,
            orderSource: { kind: "slot", fallback: false },
            startDist: [],
            endDist: [],
            targets: [],
        };
    },
});

afterEach(() => setFollowTheLeader(false));

describe("isTrailEndShape (#1101)", () => {
    it("a shape on exactly a follow-the-leader line, at the beat it arrives, is its end shape", () => {
        setFollowTheLeader(true);
        expect(isTrailEndShape([4, 3, 2, 1], 16, resolver(true))).toBe(true);
    });

    it("not at another beat, not on part of the line or more, not for a move that doesn't follow", () => {
        setFollowTheLeader(true);
        expect(isTrailEndShape([1, 2, 3, 4], 8, resolver(true))).toBe(false);
        expect(isTrailEndShape([1, 2, 3], 16, resolver(true))).toBe(false);
        expect(
            isTrailEndShape([1, 2, 3, 4], 16, resolver(true, [1, 2, 3, 4, 5])),
        ).toBe(false);
        expect(isTrailEndShape([1, 2, 3, 4], 16, resolver(false))).toBe(false);
        expect(isTrailEndShape([1, 2, 3, 4], 16, null)).toBe(false);
    });

    it("with Follow-the-leader off (#1095), a shape is clicked as any other", () => {
        expect(isTrailEndShape([1, 2, 3, 4], 16, resolver(true))).toBe(false);
    });
});
