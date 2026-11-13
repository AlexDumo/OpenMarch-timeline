/**
 * Pins on the open path, pathways step 5 (spec Appendix M, AP-P2): the playhead marker, the count
 * a point is passed on, the count tags and what a drop of the marker means.
 */
import { describe, expect, it } from "vitest";
import type { PathShape } from "../pathEdit";
import type { PathTarget } from "../pathTarget";
import {
    countAtPlace,
    formatCount,
    pinSpeedFactor,
    passingCount,
    pinDropAt,
    pinTags,
    playheadMarkerAt,
    takesPins,
} from "../pathPins";

/** One marcher's own path (0,0) → (30,0) → (30,40) over [10, 26): 16 counts, 70 long */
const own = (pins: PathTarget["pins"] = []): PathTarget => ({
    timelineId: 1,
    transitionId: 1,
    marcherId: 1,
    start: 10,
    end: 26,
    from: { x: 0, y: 0 },
    to: { x: 30, y: 40 },
    routeId: 7,
    points: [{ id: "p1", at: [30, 0] }],
    pins,
    ends: { from: { x: 0, y: 0 }, to: { x: 30, y: 40 } },
    group: null,
});
const shapeOf = (t: PathTarget): PathShape => ({
    from: t.from,
    to: t.to,
    points: t.points.map((p) => ({
        id: p.id,
        at: { x: p.at[0], y: p.at[1] },
        ...(p.tension ? { tension: p.tension } : {}),
    })),
    ends: t.ends ?? undefined,
});

describe("the playhead marker", () => {
    it("sits where the walker is at the playhead, steady speed without pins", () => {
        const t = own();
        // 16 counts over 70: at count 8 the walker is 35 along, 5 past the corner
        expect(playheadMarkerAt(t, shapeOf(t), 18)).toEqual({ x: 30, y: 5 });
    });

    it("follows the pins' clock: on the corner on its pinned count", () => {
        const t = own([{ point: "p1", at: 4 }]);
        expect(playheadMarkerAt(t, shapeOf(t), 14)).toEqual({ x: 30, y: 0 });
        expect(playheadMarkerAt(t, shapeOf(t), 12)).toEqual({ x: 15, y: 0 });
    });

    it("is hidden at the move's ends, outside it, on a trail and on a path not saved yet", () => {
        const t = own();
        expect(playheadMarkerAt(t, shapeOf(t), 10)).toBeNull();
        expect(playheadMarkerAt(t, shapeOf(t), 26)).toBeNull();
        expect(playheadMarkerAt(t, shapeOf(t), 40)).toBeNull();
        expect(takesPins({ ...t, routeId: null })).toBe(false);
        expect(
            takesPins({
                ...t,
                trail: { members: [], leaderId: 1, reverse: false },
            }),
        ).toBe(false);
    });
});

describe("counts", () => {
    it("a point's passing count, steady or pinned", () => {
        const t = own();
        expect(passingCount(t, shapeOf(t), 0)).toBeCloseTo((16 * 30) / 70, 9);
        const pinned = own([{ point: "p1", at: 4 }]);
        expect(passingCount(pinned, shapeOf(pinned), 0)).toBe(4);
    });

    it("tags each pinned point with its count", () => {
        const t = own([{ point: "p1", at: 4 }]);
        expect(pinTags(t, shapeOf(t))).toEqual([
            { at: { x: 30, y: 0 }, text: "4", pointId: "p1" },
        ]);
        expect(formatCount(7.5)).toBe("7½");
        expect(formatCount(7.25)).toBe("7.3");
    });
});

describe("dropping the marker (AP-P2)", () => {
    it("on a point pins it; on a straight leg adds a corner there", () => {
        const t = own();
        const shape = shapeOf(t);
        expect(pinDropAt(t, shape, { x: 29, y: 1 }, 2)?.drop).toEqual({
            kind: "point",
            pointId: "p1",
        });
        expect(pinDropAt(t, shape, { x: 15, y: 1 }, 2)?.drop).toEqual({
            kind: "stretch",
            before: 0,
            at: [15, 0],
        });
        expect(pinDropAt(t, shape, { x: 31, y: 20 }, 2)?.drop).toEqual({
            kind: "stretch",
            before: 1,
            at: [30, 20],
        });
    });

    it("refuses a curve, and a group path's legs onto and off it", () => {
        const curved = own();
        const shape: PathShape = {
            ...shapeOf(curved),
            points: [{ id: "p1", at: { x: 30, y: 0 }, tension: 1 }],
        };
        expect(pinDropAt(curved, shape, { x: 15, y: 1 }, 2)).toBeNull();
        const group: PathTarget = {
            ...own(),
            points: [
                { id: "a", at: [30, 0] },
                { id: "b", at: [30, 40] },
            ],
            to: { x: 60, y: 40 },
            ends: { from: { x: 0, y: 0 }, to: { x: 60, y: 40 } },
            group: { members: [], outside: [] },
        };
        const gShape = shapeOf(group);
        expect(pinDropAt(group, gShape, { x: 15, y: 0 }, 2)).toBeNull();
        expect(pinDropAt(group, gShape, { x: 30, y: 20 }, 2)?.drop).toEqual({
            kind: "stretch",
            before: 1,
            at: [30, 20],
        });
    });
});

describe("Big steps with pins", () => {
    it("judges each stretch at its pinned speed", () => {
        // 70 long over 16 counts; the corner (30 along) pinned on 4: 30 in 4 counts, 40 in 12
        const t = own([{ point: "p1", at: 4 }]);
        const steady = 70 / 16;
        expect(pinSpeedFactor(t, shapeOf(t), 0, 30)).toBeCloseTo(
            30 / 4 / steady,
            9,
        );
        expect(pinSpeedFactor(t, shapeOf(t), 30, 70)).toBeCloseTo(
            40 / 12 / steady,
            9,
        );
        expect(pinSpeedFactor(t, shapeOf(t), 0, 70)).toBeCloseTo(
            30 / 4 / steady,
            9,
        );
        expect(pinSpeedFactor(own(), shapeOf(own()), 0, 70)).toBe(1);
        expect(countAtPlace(t, shapeOf(t), 50)).toBeCloseTo(10, 9);
    });
});
