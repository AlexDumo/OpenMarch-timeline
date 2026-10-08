import { describe, expect, it } from "vitest";
import { snapEdgeBeat, stepOffForbidden } from "../timelineEdgeSnap";

/** UI-15: the rules every dragged timeline edge follows (page flags and move edges). */

describe("snapEdgeBeat", () => {
    const base = {
        pageBeats: [16],
        downbeats: [12, 16, 20],
        pixelsPerBeat: 16,
    };

    it("lands on a page line or the playhead within 12 px", () => {
        expect(snapEdgeBeat({ ...base, beat: 16.7 })).toBe(16);
        expect(snapEdgeBeat({ ...base, beat: 17.3 })).toBe(17);
        expect(snapEdgeBeat({ ...base, beat: 9.3, playheadBeat: 10 })).toBe(10);
    });

    it("lands on a downbeat only within 6 px, else on the nearest whole beat", () => {
        expect(snapEdgeBeat({ ...base, beat: 12.3 })).toBe(12);
        expect(snapEdgeBeat({ ...base, beat: 12.6 })).toBe(13);
    });

    it("a page line or the playhead wins over a nearer downbeat", () => {
        expect(
            snapEdgeBeat({
                pageBeats: [16],
                downbeats: [15.5],
                pixelsPerBeat: 16,
                beat: 15.6,
            }),
        ).toBe(16);
    });

    it("Alt keeps only the whole beat", () => {
        expect(snapEdgeBeat({ ...base, beat: 16.7, snapDisabled: true })).toBe(
            17,
        );
    });
});

describe("stepOffForbidden", () => {
    it("moves back toward where the edge started, past a run of forbidden beats", () => {
        expect(stepOffForbidden(20, 16, new Set([20]))).toBe(19);
        expect(stepOffForbidden(20, 16, new Set([19, 20]))).toBe(18);
        expect(stepOffForbidden(10, 16, new Set([10, 11]))).toBe(12);
        expect(stepOffForbidden(20, 16, new Set([17]))).toBe(20);
        // Never past where it started
        expect(stepOffForbidden(17, 16, new Set([16, 17]))).toBe(16);
    });
});
