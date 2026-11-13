import { describe, expect, it } from "vitest";
import type { Resolver } from "@openmarch/core";
import type { MoveRoute } from "@/db-functions/timelineRoutes";
import { laneOutline, memberWalkOf, scheduleOf } from "../pathEdit";
import { groupToShow, refitNeeded, targetOfRoute } from "../pathTarget";

/**
 * Detach (pathways step 3c, spec J.8 AP-R9): a Detached copy is a group path with one lane, shown
 * and edited as that lane (its points plus the lane's offset), so the editor draws it where its
 * marcher walks and Re-fit isn't offered for the group's `to`, which the copy keeps on purpose.
 */

const geometry = {
    v: 1 as const,
    from: [0, 0] as [number, number],
    to: [80, 0] as [number, number],
    points: [
        { id: "a", at: [20, 10] as [number, number] },
        { id: "b", at: [60, 10] as [number, number], tension: 1 },
    ],
};

/** The copy's one lane: offset (4, -6), its marcher starting on it and ending elsewhere */
const copyEntry = (laneCount: number): MoveRoute => ({
    routeId: 9,
    laneId: 3,
    transitionId: 100,
    slot: 2,
    timelineId: 1,
    marcherId: 7,
    start: 0,
    end: 8,
    offset: [4, -6],
    adjust: null,
    geometry,
    laneCount,
    detachedFrom: laneCount === 1 ? 5 : null,
});

const resolver = {
    explain: () => ({ origin: [4, -6] }),
    positionAt: () => [90, 3],
} as unknown as Pick<Resolver, "explain" | "positionAt">;
const drills = new Map([[7, "T7"]]);

describe("a Detached copy is shown on its lane", () => {
    it("its points and ends are the route's plus the offset; the member's offset is zero", () => {
        const t = targetOfRoute([copyEntry(1)], resolver, drills)!;
        expect(t.lane).toEqual({ offset: { x: 4, y: -6 }, detachedFrom: 5 });
        expect(t.points.map((p) => p.at)).toEqual([
            [24, 4],
            [64, 4],
        ]);
        expect(t.points.map((p) => p.id)).toEqual(["a", "b"]);
        expect(t.points[1]!.tension).toBe(1);
        expect(t.from).toEqual({ x: 4, y: -6 });
        expect(t.ends).toEqual({
            from: { x: 4, y: -6 },
            to: { x: 84, y: -6 },
        });
        expect(t.group!.members).toEqual([
            expect.objectContaining({ marcherId: 7, offset: { x: 0, y: 0 } }),
        ]);
        // The line is drawn from where its marcher starts to its end spot
        expect(t.drawnEnds).toEqual({
            from: { x: 4, y: -6 },
            to: { x: 90, y: 3 },
        });
    });

    it("its lane, walked on the shown points with no offset, is the copy's lane", () => {
        const t = targetOfRoute([copyEntry(1)], resolver, drills)!;
        const shown = laneOutline(
            memberWalkOf(
                scheduleOf({
                    from: t.drawnEnds!.from,
                    to: t.drawnEnds!.to,
                    points: t.points.map((p) => ({
                        at: { x: p.at[0], y: p.at[1] },
                        ...(p.tension ? { tension: p.tension } : {}),
                    })),
                    ends: t.ends!,
                }),
                t.group!.members[0]!,
            ),
        );
        const stored = laneOutline(
            memberWalkOf(
                scheduleOf({
                    from: { x: 4, y: -6 },
                    to: { x: 90, y: 3 },
                    points: geometry.points.map((p) => ({
                        at: { x: p.at[0], y: p.at[1] },
                        ...(p.tension ? { tension: p.tension } : {}),
                    })),
                    ends: { from: { x: 0, y: 0 }, to: { x: 80, y: 0 } },
                }),
                {
                    from: { x: 4, y: -6 },
                    to: { x: 90, y: 3 },
                    offset: { x: 4, y: -6 },
                },
            ),
        );
        expect(shown).toHaveLength(stored.length);
        shown.forEach((p, i) => {
            expect(p.x).toBeCloseTo(stored[i]!.x, 9);
            expect(p.y).toBeCloseTo(stored[i]!.y, 9);
        });
    });

    it("Re-fit isn't offered right after Detach; it is once the marcher's start moved", () => {
        const t = targetOfRoute([copyEntry(1)], resolver, drills)!;
        expect(refitNeeded(t)).toBe(false);
        const moved = {
            explain: () => ({ origin: [7, -6] }),
            positionAt: () => [90, 3],
        } as unknown as Pick<Resolver, "explain" | "positionAt">;
        expect(refitNeeded(targetOfRoute([copyEntry(1)], moved, drills)!)).toBe(
            true,
        );
    });

    it("a group path with two or more lanes is shown as before, on its reference line", () => {
        const t = targetOfRoute([copyEntry(2)], resolver, drills)!;
        expect(t.lane).toBeUndefined();
        expect(t.points.map((p) => p.at)).toEqual([
            [20, 10],
            [60, 10],
        ]);
    });
});

describe("which group path the selection shows (groupToShow)", () => {
    const R = { routeId: 5, detachedFrom: null };
    const copyOfR = { routeId: 9, detachedFrom: 5 };
    const other = { routeId: 6, detachedFrom: null };
    it("the only one; or the group path its selected copies came from", () => {
        expect(groupToShow([copyOfR])).toBe(copyOfR);
        expect(groupToShow([R, copyOfR])).toBe(R);
        expect(groupToShow([copyOfR, { routeId: 10, detachedFrom: 5 }])).toBe(
            null,
        );
        expect(groupToShow([R, other])).toBe(null);
        expect(groupToShow([])).toBe(null);
    });
});
