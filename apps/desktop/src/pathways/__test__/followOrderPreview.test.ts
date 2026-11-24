import { afterEach, beforeEach, describe, expect, it } from "vitest";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type { FieldPointer } from "@/field/editor/fieldEditor";
import { setShapeField } from "@/shapes/field/shapeField";
import { boxCellsOf, mapCells } from "@/db-functions/timelineTrailSnake";
import { drawingOf, pathPenMode } from "../pathPenMode";
import { clearPath, usePathPenStore, type PathSession } from "../pathPenStore";
import type { PathTarget } from "../pathTarget";
import {
    followOrderPreview,
    setFollowSnake,
    type FollowDrag,
} from "../followDrag";

/**
 * The Follow tool's order preview (owner, 2026-11-17; spec DL-34): while the ends wait to be
 * grabbed, hovering an end previews the order a drag from it would use, leader first, the same
 * line the drag uses; another end flips it; leaving, a middle marcher or a grab shows none. The
 * line-up lane hides while it shows, and the other ends' pull arrows dim.
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

/**
 * The Follow tool open on the box, as `openFollowTool` opens it: its top-left snake, tail first;
 * with `order`, a hand-set order (tail first), so no box
 */
function open(handSet?: number[]) {
    const order = handSet ?? [4, 5, 6, 3, 2, 1];
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
        box: handSet ? null : BOX,
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

const preview = () => followOrderPreview(session().follow!);
const hover = (id: number) => {
    const p = starts.get(id)!;
    pathPenMode.cursorAt(at(p.x, p.y));
};

describe("the Follow tool's order preview", () => {
    it("hovering a box's corner previews its snake from there, leader first; another corner flips it; Columns re-runs it", () => {
        open();
        expect(preview()).toBeNull();
        hover(6);
        expect(session().follow!.hoverEnd).toBe(6);
        expect(preview()).toEqual([6, 5, 4, 1, 2, 3]);
        // The hovered corner's arrow stands for the tip; the others dim
        const arrows = drawingOf(session())!.pullArrows!;
        const six = starts.get(6)!;
        for (const a of arrows)
            expect(!!a.dim).toBe(!(a.at.x === six.x && a.at.y === six.y));
        hover(1);
        expect(preview()).toEqual([1, 2, 3, 6, 5, 4]);
        setFollowSnake("columns");
        expect(preview()).toEqual([1, 4, 5, 2, 3, 6]);
    });

    it("a hand-set order: its two ends preview it from either end, and the line-up lane hides while one shows", () => {
        // Hand-set leader 2, then 5, 4, 1, 6, 3 (tail first below)
        open([3, 6, 1, 4, 5, 2]);
        expect(drawingOf(session())!.lanes).toHaveLength(1);
        hover(2);
        expect(preview()).toEqual([2, 5, 4, 1, 6, 3]);
        expect(drawingOf(session())!.lanes).toEqual([]);
        hover(3);
        expect(preview()).toEqual([3, 6, 1, 4, 5, 2]);
        // A box corner that isn't one of the order's ends previews nothing
        hover(1);
        expect(preview()).toBeNull();
        expect(drawingOf(session())!.lanes).toHaveLength(1);
    });

    it("leaving, or grabbing an end, takes it away", () => {
        open();
        hover(4);
        expect(preview()).not.toBeNull();
        pathPenMode.leave();
        expect(preview()).toBeNull();
        hover(4);
        const p = starts.get(4)!;
        pathPenMode.press(at(p.x, p.y), press);
        pathPenMode.move(at(p.x - 3 * STEP, p.y));
        expect(session().follow!.grabbed).toBe(4);
        expect(preview()).toBeNull();
        expect(drawingOf(session())!.pullArrows).toBeUndefined();
    });
});
