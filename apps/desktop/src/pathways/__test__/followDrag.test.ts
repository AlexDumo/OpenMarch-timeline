import { afterEach, beforeEach, describe, expect, it } from "vitest";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type { FieldPointer } from "@/field/editor/fieldEditor";
import { setShapeField } from "@/shapes/field/shapeField";
import { planTrailDrag } from "@/db-functions/timelineTrailDrag";
import { drawingOf, pathPenMode } from "../pathPenMode";
import {
    clearPath,
    shapeOf,
    usePathPenStore,
    type PathSession,
} from "../pathPenStore";
import type { PathTarget } from "../pathTarget";
import {
    cancelFollowDrawing,
    evenLimitOf,
    followHit,
    followPlanOf,
    setFollowEnds,
    setFollowSpacing,
    trailLine,
    type FollowDrag,
} from "../followDrag";
import { bigSteps } from "../PathEditor";

/**
 * The Follow tool on the field (pathways step 4b, spec Appendix L): the selected line's ends
 * pulse, a middle marcher takes no press, a press-drag on an end draws the first leg with that end
 * leading, the end spots shown are AP-T8's, and Escape cancels the drawing, then leaves.
 */

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const STEP = fieldProperties.pixelsPerStep;
const ZOOM = 2;
const X0 = 40 * STEP;
const Y0 = 30 * STEP;

/** Five marchers in a level line two steps apart, ids 1 to 5 from the left */
const starts = new Map(
    [1, 2, 3, 4, 5].map((id, i) => [id, { x: X0 + 2 * i * STEP, y: Y0 }]),
);

const at = (x: number, y: number): FieldPointer => ({
    field: { x, y },
    screen: { x: x * ZOOM, y: y * ZOOM },
    button: 0,
    shift: false,
    alt: false,
    ctrl: false,
    meta: false,
});

function open(keepOffered = false) {
    const follow: FollowDrag = {
        window: { start: 9, end: 17 },
        ids: [1, 2, 3, 4, 5],
        order: [1, 2, 3, 4, 5],
        starts,
        grabbed: null,
        spacing: { kind: "keep" },
        ends: "trail",
        keepOffered,
        step: STEP,
    };
    const members = follow.order.map((id) => ({
        marcherId: id,
        drill: `T${id}`,
        from: starts.get(id)!,
        to: starts.get(id)!,
    }));
    const target: PathTarget = {
        timelineId: -1,
        transitionId: -1,
        marcherId: 5,
        start: 9,
        end: 17,
        from: starts.get(5)!,
        to: starts.get(5)!,
        routeId: null,
        points: [],
        ends: null,
        group: null,
        trail: { members, leaderId: 5, reverse: false },
    };
    usePathPenStore.setState({
        session: {
            phase: "drawing",
            target,
            drill: "5",
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

/** A press on `from`, a drag to `to`, and the release */
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

describe("the Follow tool (pathways step 4b)", () => {
    it("rings on everyone, the two ends pulsing; nothing else is drawn until an end is pressed", () => {
        open();
        const d = drawingOf(session())!;
        expect(d.memberRings!.map((r) => r.pulse ?? false)).toEqual([
            true,
            false,
            false,
            false,
            true,
        ]);
        expect(d.outline).toBeNull();
        expect(d.spots).toEqual([]);
        expect(pathPenMode.cursorAt(at(X0, Y0))).toBe("grab");
        expect(pathPenMode.cursorAt(at(X0 + 4 * STEP, Y0))).toBe("default");
    });

    it("a middle marcher, or the empty field, takes no press (DL-4)", () => {
        open();
        drag(
            { x: X0 + 4 * STEP, y: Y0 },
            { x: X0 + 4 * STEP, y: Y0 + 10 * STEP },
        );
        drag({ x: X0, y: Y0 + 20 * STEP }, { x: X0 + 9 * STEP, y: Y0 + 20 * STEP }); // prettier-ignore
        expect(session().follow!.grabbed).toBeNull();
        expect(session().points).toEqual([]);
    });

    it("a press-drag on the left end makes it the leader and draws the first leg; clicks add corners", () => {
        open();
        const left = starts.get(1)!;
        drag(left, { x: left.x, y: left.y + 10 * STEP });
        const s = session();
        expect(s.follow!.grabbed).toBe(1);
        expect(trailLine(s.follow!)).toEqual([5, 4, 3, 2, 1]);
        expect(s.target.trail!.leaderId).toBe(1);
        expect(s.target.from).toEqual(left);
        // landed as a Path pen point is (on the grid or a field line), near the drag's end
        expect(s.points).toHaveLength(1);
        expect(s.points[0]!.at.x).toBeCloseTo(left.x, 6);
        expect(Math.abs(s.points[0]!.at.y - (left.y + 10 * STEP))).toBeLessThan(
            STEP,
        );
        // a click adds a corner, as the Path pen does
        pathPenMode.press(at(left.x - 6 * STEP, left.y + 10 * STEP), press);
        pathPenMode.release(at(left.x - 6 * STEP, left.y + 10 * STEP), null);
        expect(session().points).toHaveLength(2);
        expect(shapeOf(session()).to).toEqual(session().points[1]!.at);
    });

    it("the end spots shown are AP-T8's, P(e_q); Even is held to its limit; Big steps reads each member's own way", () => {
        open();
        const right = starts.get(5)!;
        drag(right, { x: right.x + 10 * STEP, y: right.y });
        const s = session();
        const plan = followPlanOf(s)!;
        const end = s.points[0]!.at;
        const line = [1, 2, 3, 4, 5].map((id): [number, number] => [starts.get(id)!.x, starts.get(id)!.y]); // prettier-ignore
        const fresh = planTrailDrag(line, [{ at: [end.x, end.y] }], { kind: "keep" }, STEP); // prettier-ignore
        expect(plan.spots).toEqual(fresh.spots);
        expect(plan.ends).toEqual(fresh.ends);
        expect(plan.startDist).toEqual(fresh.startDist);
        const d = drawingOf(s)!;
        expect(d.spots).toEqual(plan.spots.map(([x, y]) => ({ x, y })));
        // Keep spacing: everyone as far on as the trail is long, 2 steps apart along the way
        const W = plan.drawn;
        d.spots.forEach((p, q) => {
            const want = plan.way.at(2 * q * STEP + W);
            expect(p.x).toBeCloseTo(want[0], 6);
            expect(p.y).toBeCloseTo(want[1], 6);
        });
        // Even's limit: the tail's (8 steps + W) / 4
        expect(evenLimitOf(plan)).toBe(
            Math.floor((8 * STEP + W) / (4 * STEP) / 0.5 + 1e-9) * 0.5,
        );
        setFollowSpacing({ kind: "even", steps: 1 });
        const even = drawingOf(session())!.spots;
        expect(
            Math.hypot(even[4]!.x - even[3]!.x, even[4]!.y - even[3]!.y),
        ).toBeCloseTo(STEP, 6);
        // 10 steps in 8 counts is no Big step for anyone; each walks the same 10 steps
        expect(bigSteps(session(), fieldProperties)).toBeNull();
    });

    it("Ends: Keep end spots only when offered", () => {
        open(false);
        setFollowEnds("keep");
        expect(session().follow!.ends).toBe("trail");
        open(true);
        setFollowEnds("keep");
        expect(session().follow!.ends).toBe("keep");
    });

    it("Escape cancels the drawing and the ends pulse again; then it leaves the tool", () => {
        open();
        const right = starts.get(5)!;
        drag(right, { x: right.x + 6 * STEP, y: right.y });
        expect(cancelFollowDrawing()).toBe(true);
        expect(session().follow!.grabbed).toBeNull();
        expect(session().points).toEqual([]);
        expect(cancelFollowDrawing()).toBe(false);
    });

    it("followHit: ends and middles under the pointer", () => {
        open();
        const f = session().follow!;
        expect(followHit(f, { x: X0 + 1, y: Y0 }, 4)).toEqual({
            id: 1,
            end: true,
        });
        expect(followHit(f, { x: X0 + 4 * STEP, y: Y0 }, 4)).toEqual({ id: 3, end: false }); // prettier-ignore
        expect(followHit(f, { x: X0, y: Y0 + 5 * STEP }, 4)).toBeNull();
    });
});
