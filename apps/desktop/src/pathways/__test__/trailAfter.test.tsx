import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createResolver, type TimelineSnapshot } from "@openmarch/core";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import { fieldToElement, useFieldViewStore } from "@/field/three/fieldView";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { PathEditor, leaderMarkBeats, leaderMarkPlace } from "../PathEditor";
import { clearPath, shapeOf, showPath, usePathPenStore } from "../pathPenStore";
import type { PathSession } from "../pathPenStore";
import { drawingOf } from "../pathPenMode";
import { pathHandles, pathOutline } from "../pathEdit";
import type { PathTarget } from "../pathTarget";

/**
 * A dragged-out trail once it's made (pathways step 11 follow-up, owner's lab test 2026-11-17):
 * the leader's mark goes by the leader at the playhead (QA-SN-14), and the drawn trail ends at
 * its own head, with no line from the head back to where the line is entered (QA-SN-15).
 */

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;

/**
 * Two marchers 10 apart, B2 leading, dragged out right 20 then down 20; the line stops along the
 * way: B2 at the head (30, 20), B1 a spacing behind it (30, 10). Stored as AP-T8 writes it: the
 * route `to` is its last point, and the target's `to` is the entrance (B1's spot), as
 * `targetOfTrail` reads it.
 */
const homes = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
];
const spots = [
    { x: 30, y: 10 },
    { x: 30, y: 20 },
];
const head = { x: 30, y: 20 };

function alongTarget(): PathTarget {
    return {
        timelineId: 1,
        transitionId: 1,
        marcherId: 2,
        start: 0,
        end: 16,
        from: homes[1]!,
        to: spots[0]!,
        routeId: 1,
        points: [
            { id: "a", at: [30, 0] },
            { id: "b", at: [head.x, head.y] },
        ],
        ends: { from: [10, 0], to: [head.x, head.y] },
        group: null,
        trail: {
            members: homes.map((from, i) => ({
                marcherId: i + 1,
                drill: `B${i + 1}`,
                from,
                to: spots[i]!,
                endAt: i,
            })),
            leaderId: 2,
            reverse: false,
            along: true,
            endLine: spots,
        },
    };
}

/** The same trail in the timeline, so the resolver walks it (R-13″) */
const snapshot: TimelineSnapshot = {
    marchers: [
        { id: 1, home: [0, 0] },
        { id: 2, home: [10, 0] },
    ],
    shapes: {},
    transitions: {
        1: {
            id: 1,
            start: 0,
            end: 16,
            dest: null,
            points: [
                [30, 10],
                [30, 20],
            ],
            slots: 2,
            style: "follow_the_leader",
            order: "slot",
            params: { waypoints: [], ends: "along" },
            route: 1,
        },
    },
    routes: {
        1: {
            geometry: {
                v: 1,
                from: [10, 0],
                to: [30, 20],
                points: [
                    { id: "a", at: [30, 0] },
                    { id: "b", at: [30, 20] },
                ],
            },
        },
    },
    assignments: [1, 2].map((m) => ({
        id: m,
        marcher: m,
        transition: 1,
        slot: m - 1,
        start: 0,
        end: 16,
        layer: 0,
    })),
};

const same = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    a.x === b.x && a.y === b.y;

/** Whether `line` reaches the head and goes nowhere after it (no leg back to the entrance) */
const endsAtHead = (line: readonly { x: number; y: number }[]) => {
    const i = line.findIndex((p) => same(p, head));
    return i >= 0 && line.slice(i).every((p) => same(p, head));
};

const sessionOf = (target: PathTarget): PathSession => {
    act(() => showPath(target, "B2"));
    return usePathPenStore.getState().session!;
};

const setPhase = (phase: PathSession["phase"]) =>
    act(() => {
        const s = usePathPenStore.getState().session!;
        usePathPenStore.setState({ session: { ...s, phase } });
    });

afterEach(() => {
    act(() => clearPath());
    act(() => {
        useTimelineResolverStore.setState({ resolver: null });
        useTimelineSelectionStore.setState({
            playheadBeat: 0,
            cursorBeat: null,
        });
    });
    cleanup();
});

describe("a dragged-out trail ends at its head (QA-SN-15)", () => {
    it("its shape runs to its last point, not on to the entrance", () => {
        const s = sessionOf(alongTarget());
        const shape = shapeOf(s);
        expect(shape.to).toEqual(head);
        expect(shape.ends?.to).toEqual(head);
        expect(endsAtHead(pathOutline(shape))).toBe(true);
    });

    it("closed and open, the drawn line stops at the head", () => {
        sessionOf(alongTarget());
        for (const phase of ["closed", "open"] as const) {
            setPhase(phase);
            const drawn = drawingOf(usePathPenStore.getState().session)!;
            expect(endsAtHead(drawn.outline!)).toBe(true);
        }
    });

    it("open for point edits, no add handle sits on the head's own handle", () => {
        const s = sessionOf(alongTarget());
        const handles = pathHandles(shapeOf(s));
        const onHead = handles.filter(
            (h) => h.at.x === head.x && h.at.y === head.y,
        );
        expect(onHead.map((h) => h.adds ?? false)).toEqual([false]);
    });

    it("drawn again, the line ends at the pointer", () => {
        sessionOf(alongTarget());
        act(() => {
            const s = usePathPenStore.getState().session!;
            usePathPenStore.setState({
                session: {
                    ...s,
                    phase: "drawing",
                    points: [],
                    pointer: { x: 40, y: 0 },
                },
            });
        });
        const drawn = drawingOf(usePathPenStore.getState().session)!;
        expect(drawn.outline!.at(-1)).toEqual({ x: 40, y: 0 });
    });

    it("a trail into end spots still runs on into its entrance (AP-T1)", () => {
        const t = alongTarget();
        const s = sessionOf({ ...t, trail: { ...t.trail!, along: false } });
        expect(pathOutline(shapeOf(s)).at(-1)).toEqual(spots[0]);
    });
});

describe("the leader's mark follows the leader (QA-SN-14)", () => {
    const target = alongTarget();
    const closed = { target, phase: "closed" as const, follow: undefined };

    it("reads the leader at the playhead, held to the move", () => {
        expect(leaderMarkBeats(target, 8)).toEqual({ at: 8, back: 7, on: 9 });
        expect(leaderMarkBeats(target, 40)).toEqual({
            at: 16,
            back: 15,
            on: 16,
        });
        expect(leaderMarkBeats(target, -3)).toEqual({ at: 0, back: 0, on: 1 });
    });

    it("sits by the leader where it is; where it starts while the trail is drawn", () => {
        const at = { x: 30, y: 20 };
        const read = { at, back: { x: 30, y: 18 }, on: at };
        expect(leaderMarkPlace(closed, read)).toEqual({ at, below: false });
        expect(
            leaderMarkPlace({ ...closed, phase: "drawing" }, read).at,
        ).toEqual(homes[1]);
        // No timeline read yet: where it starts
        expect(
            leaderMarkPlace(closed, { at: null, back: null, on: null }).at,
        ).toEqual(homes[1]);
    });

    it("goes below the leader when it walks up the screen, clear of the head's arrow", () => {
        const at = { x: 30, y: 20 };
        expect(
            leaderMarkPlace(closed, { at, back: { x: 30, y: 24 }, on: at })
                .below,
        ).toBe(true);
        // At the move's start, which way it sets off
        expect(
            leaderMarkPlace(closed, { at, back: at, on: { x: 30, y: 17 } })
                .below,
        ).toBe(true);
        expect(
            leaderMarkPlace(closed, { at, back: { x: 26, y: 22 }, on: at })
                .below,
        ).toBe(false);
    });

    it("in the app: at the move's end it's by the head, mid-move by the leader, not where it started", () => {
        const resolver = createResolver(snapshot);
        act(() => {
            useTimelineResolverStore.setState({ resolver, version: 1 });
            useTimelineSelectionStore.setState({
                playheadBeat: 16,
                cursorBeat: null,
            });
        });
        sessionOf(alongTarget());
        render(<PathEditor fieldProperties={fieldProperties} />);
        const view = useFieldViewStore.getState();
        const chip = () => screen.getByTestId("trail-leader");
        const left = () => parseFloat(chip().style.left);
        const top = () => parseFloat(chip().style.top);
        const end = fieldToElement(view, head.x, head.y);
        expect(left()).toBeCloseTo(end.x, 6);
        expect(top()).toBeCloseTo(end.y - 40, 6);

        act(() => {
            useTimelineSelectionStore.setState({ playheadBeat: 6 });
        });
        const [x, y] = resolver.positionAt(2, 6);
        const mid = fieldToElement(view, x, y);
        expect(left()).toBeCloseTo(mid.x, 6);
        const start = fieldToElement(view, homes[1]!.x, homes[1]!.y);
        expect(left()).not.toBeCloseTo(start.x, 1);
        expect(top()).toBeCloseTo(mid.y - 40, 6);
    });
});
