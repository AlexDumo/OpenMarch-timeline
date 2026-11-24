import { afterEach, beforeEach, describe, expect, it } from "vitest";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type { FieldPointer } from "@/field/editor/fieldEditor";
import { setShapeField } from "@/shapes/field/shapeField";
import type { XY } from "@openmarch/core";
import { planTrailDrag } from "@/db-functions/timelineTrailDrag";
import { boxCellsOf, mapCells } from "@/db-functions/timelineTrailSnake";
import { drawingOf, pathPenMode } from "../pathPenMode";
import {
    clearPath,
    storedPoints,
    usePathPenStore,
    type PathSession,
} from "../pathPenStore";
import type { PathTarget } from "../pathTarget";
import {
    followEnds,
    followPlanOf,
    setFollowSnake,
    snakesThroughBox,
    trailLine,
    type FollowDrag,
} from "../followDrag";

/**
 * Snaking through a box in the Follow tool (pathways step 11, spec L.12, SN-2, SN-3): every corner
 * of a box with no order of its own is an end, its arrows point along the snake's first row (or
 * column), and the line is the snake from the corner grabbed (the write's, `timelineTrailSnakeFollow`).
 */

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const STEP = fieldProperties.pixelsPerStep;
const ZOOM = 2;
const X0 = 40 * STEP;
const Y0 = 30 * STEP;

/** A 2 × 3 box two steps apart: ids 1 to 3 the top row, 4 to 6 the bottom, left to right */
const starts = new Map(
    [1, 2, 3, 4, 5, 6].map((id, i) => [
        id,
        { x: X0 + 2 * (i % 3) * STEP, y: Y0 + (i < 3 ? 0 : 2) * STEP },
    ]),
);
const IDS = [1, 2, 3, 4, 5, 6];
const BOX = mapCells(
    boxCellsOf(IDS.map((id) => [starts.get(id)!.x, starts.get(id)!.y]))!,
    (i) => IDS[i]!,
);

const at = (x: number, y: number): FieldPointer => ({
    field: { x, y },
    screen: { x: x * ZOOM, y: y * ZOOM },
    button: 0,
    shift: false,
    alt: false,
    ctrl: false,
    meta: false,
    kind: "mouse",
});

/** The Follow tool open on the box, as `openFollowTool` opens it: its top-left snake, tail first */
function open() {
    const order = [4, 5, 6, 3, 2, 1];
    const follow: FollowDrag = {
        window: { start: 9, end: 17 },
        ids: IDS,
        order,
        starts,
        grabbed: null,
        spacing: { kind: "keep" },
        ends: "trail",
        keep: null,
        step: STEP,
        box: BOX,
        snakeBy: "rows",
    };
    const members = order.map((id) => ({
        marcherId: id,
        drill: `T${id}`,
        from: starts.get(id)!,
        to: starts.get(id)!,
    }));
    const target: PathTarget = {
        timelineId: -1,
        transitionId: -1,
        marcherId: 1,
        start: 9,
        end: 17,
        from: starts.get(1)!,
        to: starts.get(1)!,
        routeId: null,
        points: [],
        ends: null,
        group: null,
        trail: { members, leaderId: 1, reverse: false },
    };
    usePathPenStore.setState({
        session: {
            phase: "drawing",
            target,
            drill: "6",
            points: [],
            pointer: null,
            selected: null,
            dragging: null,
            object: false,
            byRoute: false,
            follow,
        },
    });
}

const session = (): PathSession => usePathPenStore.getState().session!;
const press = { isMac: false, reachesInside: () => true, onDot: () => true };

function drag(from: { x: number; y: number }, to: { x: number; y: number }) {
    pathPenMode.press(at(from.x, from.y), press);
    pathPenMode.move(at((from.x + to.x) / 2, (from.y + to.y) / 2));
    pathPenMode.move(at(to.x, to.y));
    pathPenMode.release(at(to.x, to.y), null);
}

beforeEach(() => {
    setShapeField({
        fieldProperties: () => fieldProperties,
        zoom: () => ZOOM,
        marchers: () => [],
        drawn: () => new Map(),
    });
});

afterEach(() => {
    clearPath();
    setShapeField(null);
});

describe("the Follow tool on a box (step 11)", () => {
    it("SN-2: every corner is an end, its arrows along the snake's first row, or column", () => {
        open();
        const f = session().follow!;
        expect(snakesThroughBox(f)).toBe(true);
        expect([...followEnds(f)].sort()).toEqual([1, 3, 4, 6]);
        const arrows = drawingOf(session())!.pullArrows!;
        expect(arrows).toHaveLength(4);
        // Row by row: each corner's arrow points out along its row
        for (const a of arrows) expect(Math.abs(a.dir.y)).toBeLessThan(1e-9);
        setFollowSnake("columns");
        for (const a of drawingOf(session())!.pullArrows!)
            expect(Math.abs(a.dir.x)).toBeLessThan(1e-9);
        // No line-up is drawn until a corner is grabbed: the snake runs from that corner
        expect(drawingOf(session())!.lanes).toEqual([]);
    });

    it("SN-2: a middle marcher takes no press; a corner grabbed leads its snake, and Rows or Columns re-run it from there", () => {
        open();
        const middle = starts.get(2)!;
        pathPenMode.press(at(middle.x, middle.y), press);
        pathPenMode.release(at(middle.x, middle.y), null);
        expect(session().follow!.grabbed).toBeNull();
        // Out of the bottom right corner, to the right
        const corner = starts.get(6)!;
        drag(corner, { x: corner.x + 6 * STEP, y: corner.y });
        expect(session().follow!.grabbed).toBe(6);
        // Along the bottom row from 6, then back along the top: tail first, 3 to 1 then 4 to 6
        expect(trailLine(session().follow!)).toEqual([3, 2, 1, 4, 5, 6]);
        setFollowSnake("columns");
        expect(session().follow!.grabbed).toBe(6);
        // Up 6's column, down the middle, up the left: 6, 3, 2, 5, 4, 1
        expect(trailLine(session().follow!)).toEqual([1, 4, 5, 2, 3, 6]);
        // The drawing's end spots are AP-T8's for that line
        const line = trailLine(session().follow!).map((id): XY => {
            const p = starts.get(id)!;
            return [p.x, p.y];
        });
        const plan = followPlanOf(session())!;
        expect(plan.spots).toEqual(
            planTrailDrag(
                line,
                storedPoints(session().points),
                { kind: "keep" },
                STEP,
            ).spots,
        );
    });
});
