import { afterEach, beforeEach, describe, expect, it } from "vitest";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import { setShapeField } from "@/shapes/field/shapeField";
import { boxCellsOf, snakeFrom } from "@/db-functions/timelineTrailSnake";
import { drawingOf } from "../pathPenMode";
import {
    clearPath,
    pathKey,
    setPathHidden,
    showPath,
    usePathPenStore,
} from "../pathPenStore";
import type { PathTarget } from "../pathTarget";
import { walkedRoute } from "../walkedRoute";
import { shapeTuckedUnderTrail, toggleTrailShapeControls } from "../trailShape";
import { setFollowTheLeader } from "../followTheLeader";

/**
 * A selected trail, calmer (owner, 2026-11-17, after the trail audit): one way the line walks, from
 * where it started out of its form into the band; ghosts with no rings; start flag positions and
 * the end shape's controls out of the way (spec L.14, QA-CT-1 to QA-CT-8).
 */

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const S = fieldProperties.pixelsPerStep;
const p = (x: number, y: number) => ({ x: x * S, y: y * S });

beforeEach(() => {
    setShapeField({
        fieldProperties: () => fieldProperties,
        zoom: () => 2,
        marchers: () => [],
        drawn: () => new Map(),
    });
});

afterEach(() => {
    clearPath();
    setPathHidden(false);
    usePathPenStore.setState({ shapeControlsFor: null });
    setShapeField(null);
});

/**
 * Six in a 3 × 2 box, 2 steps apart, its top right (marcher 3) leading out to the right 10 steps
 * then down 6 (a snake out of a box, step 11): the line in snake order, tail first
 */
function boxTrail(): PathTarget {
    const spots = new Map<number, { x: number; y: number }>([
        [1, p(0, 0)],
        [2, p(2, 0)],
        [3, p(4, 0)],
        [4, p(0, 2)],
        [5, p(2, 2)],
        [6, p(4, 2)],
    ]);
    const ids = [...spots.keys()];
    const cells = boxCellsOf(
        ids.map((id) => [spots.get(id)!.x, spots.get(id)!.y]),
    )!;
    // The snake from the top right, by index into `ids`, leader first
    const snake = snakeFrom(cells, "rows", 2)!.map((i) => ids[i]!);
    const line = [...snake].reverse();
    const head = p(14, 6);
    const ends = [p(14, -4), p(14, -2), p(14, 0), p(14, 2), p(14, 4), head];
    const members = line.map((id, q) => ({
        marcherId: id,
        drill: `B${id}`,
        from: spots.get(id)!,
        to: ends[q]!,
    }));
    return {
        timelineId: 1,
        transitionId: 4,
        marcherId: 3,
        start: 0,
        end: 16,
        from: spots.get(3)!,
        to: head,
        routeId: 9,
        // A dragged-out trail's route ends at its own last point, the head (AP-T10)
        points: [
            { id: "c", at: [14 * S, 0] as const },
            { id: "h", at: [head.x, head.y] as const },
        ],
        ends: { from: [4 * S, 0], to: [head.x, head.y] },
        group: null,
        trail: { members, leaderId: 3, reverse: false, along: true },
    };
}

describe("the way a trail walks (QA-CT-1, QA-CT-2)", () => {
    it("QA-CT-1: out of a box, the snake through its old spots in exit order, ending at the exit corner where the trail begins", () => {
        const target = boxTrail();
        const route = [p(4, 0), p(14, 0), p(14, 6)];
        const way = walkedRoute(target.trail!, route);
        // Rows from the top right: 3, 2, 1, then back along the bottom 4, 5, 6; the tail (6) first
        expect(target.trail!.members.map((m) => m.marcherId)).toEqual([
            6, 5, 4, 1, 2, 3,
        ]);
        expect(way).toEqual([
            p(4, 2),
            p(2, 2),
            p(0, 2),
            // The row's end, cut straight across to the next row (SN-3)
            p(0, 0),
            p(2, 0),
            // The exit corner: the leader's start, where the trail begins
            p(4, 0),
            p(14, 0),
            p(14, 6),
        ]);
    });

    it("QA-CT-2: a line dragged out of a line leads into its trail; one into a form runs on through the end spots", () => {
        const members = [0, 1, 2].map((i) => ({
            marcherId: i + 1,
            drill: `T${i + 1}`,
            from: p(2 * i, 0),
            to: p(10, 2 + 2 * i),
        }));
        const route = [p(4, 0), p(10, 0), p(10, 2)];
        expect(walkedRoute({ members, along: true }, route)).toEqual([
            p(0, 0),
            p(2, 0),
            p(4, 0),
            p(10, 0),
            p(10, 2),
        ]);
        // Into end spots: the route ends at the entrance (the tail's spot), then the end line
        expect(walkedRoute({ members }, route)).toEqual([
            p(0, 0),
            p(2, 0),
            p(4, 0),
            p(10, 0),
            p(10, 2),
            p(10, 4),
            p(10, 6),
        ]);
        // The stored end line wins over the members' spots (vacant slots too)
        expect(
            walkedRoute({ members, endLine: [p(10, 2), p(12, 2)] }, route).at(
                -1,
            ),
        ).toEqual(p(12, 2));
    });

    it("selected, the box trail's drawing is that way, its line not drawn, no rings or lanes, its end spots cleared under marchers", () => {
        showPath(boxTrail(), "B3");
        const d = drawingOf(usePathPenStore.getState().session)!;
        expect(d.walked!.slice(0, 6)).toEqual([
            p(4, 2),
            p(2, 2),
            p(0, 2),
            p(0, 0),
            p(2, 0),
            p(4, 0),
        ]);
        expect(d.walked!.at(-1)).toEqual(p(14, 6));
        expect(d.outlineHidden).toBe(true);
        expect(d.memberRings).toBeUndefined();
        expect(d.lanes).toBeUndefined();
        expect(d.spotsClear).toBe(true);
        // One plain ghost where each started
        expect(d.rings).toHaveLength(6);
    });
});

describe("the end shape's controls are tucked away (QA-CT-3)", () => {
    // The end shape is a trail's: tucked only with Follow-the-leader on (#1095)
    beforeEach(() => setFollowTheLeader(true));
    afterEach(() => setFollowTheLeader(false));

    it("#1095: never with Follow-the-leader off, where Shape controls isn't offered: the shape keeps its controls", () => {
        const ids = [1, 2, 3, 4, 5, 6];
        showPath(boxTrail(), "B3");
        expect(shapeTuckedUnderTrail(ids)).toBe(true);
        setFollowTheLeader(false);
        expect(shapeTuckedUnderTrail(ids)).toBe(false);
    });

    it("only for exactly the trail's marchers while it's shown, stored and not drawn; Shape controls brings them back for that trail", () => {
        const ids = [1, 2, 3, 4, 5, 6];
        expect(shapeTuckedUnderTrail(ids)).toBe(false);
        showPath(boxTrail(), "B3");
        expect(shapeTuckedUnderTrail(ids)).toBe(true);
        expect(shapeTuckedUnderTrail([1, 2, 3, 4, 5])).toBe(false);
        expect(shapeTuckedUnderTrail([...ids, 7])).toBe(false);
        // Open in Edit path too
        usePathPenStore.setState({
            session: { ...usePathPenStore.getState().session!, phase: "open" },
        });
        expect(shapeTuckedUnderTrail(ids)).toBe(true);
        toggleTrailShapeControls();
        expect(usePathPenStore.getState().shapeControlsFor).toBe(
            pathKey(boxTrail()),
        );
        expect(shapeTuckedUnderTrail(ids)).toBe(false);
        toggleTrailShapeControls();
        expect(shapeTuckedUnderTrail(ids)).toBe(true);
        // Hidden (not drawn), nothing is tucked
        usePathPenStore.setState({
            session: {
                ...usePathPenStore.getState().session!,
                phase: "closed",
            },
        });
        setPathHidden(true);
        expect(shapeTuckedUnderTrail(ids)).toBe(false);
    });
});
