import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { makeAlongTrail } from "@openmarch/core";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type { FieldPointer } from "@/field/editor/fieldEditor";
import { setShapeField } from "@/shapes/field/shapeField";
import type { ToolEnv } from "@/shapes/tool/toolKind";
import { planTrailDrag } from "@/db-functions/timelineTrailDrag";
import { drawingOf, pathPenMode } from "../pathPenMode";
import {
    clearPath,
    showPath,
    storedPoints,
    usePathPenStore,
    type PathSession,
} from "../pathPenStore";
import type { PathTarget } from "../pathTarget";
import { cancelFollowDrawing, followPlanOf, trailLine } from "../followDrag";
import {
    canDragHead,
    headDragPoints,
    headSpacingOf,
    isHeadDrag,
    trailHeadOf,
} from "../trailHead";

/**
 * A dragged-out trail's head, AP-T16 (owner, 2026-11-17): the handle at the head of a stored trail
 * dragged out of a line, and dragging it on or back as step 4b's drag carried on (the Follow tool's
 * drawing, its plan the write's). QA-HD-6 to QA-HD-11; the write is `timelineTrailHead.test.ts`.
 */

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const S = fieldProperties.pixelsPerStep;
const ZOOM = 2;
const X0 = 40 * S;
const Y0 = 30 * S;

/** Five marchers two steps apart, M5 leading, dragged out 10 steps right: AP-T8's spots */
const homes = [1, 2, 3, 4, 5].map((id, i) => ({ x: X0 + 2 * i * S, y: Y0 }));
const lead = homes[4]!;
const head = { x: lead.x + 10 * S, y: Y0 };
const lineUp = homes.map((p): [number, number] => [p.x, p.y]);

function storedTarget(
    points: { at: { x: number; y: number }; id: string }[] = [
        { id: "h", at: head },
    ],
    spots = planTrailDrag(
        lineUp,
        points.map((p) => ({ id: p.id, at: [p.at.x, p.at.y] })),
        { kind: "keep" },
        S,
    ).spots,
    trail: Partial<NonNullable<PathTarget["trail"]>> = {},
): PathTarget {
    const last = points.at(-1)!.at;
    return {
        timelineId: 3,
        transitionId: 30,
        marcherId: 5,
        start: 9,
        end: 17,
        from: lead,
        to: { x: spots[0]![0], y: spots[0]![1] },
        routeId: 300,
        points: points.map((p) => ({ id: p.id, at: [p.at.x, p.at.y] })),
        ends: { from: [lead.x, lead.y], to: [last.x, last.y] },
        group: null,
        trail: {
            members: homes.map((from, i) => ({
                marcherId: i + 1,
                drill: `T${i + 1}`,
                from,
                to: { x: spots[i]![0], y: spots[i]![1] },
                endAt: i,
            })),
            leaderId: 5,
            reverse: false,
            along: true,
            ...trail,
        },
    };
}

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
const pressOn = (onDot: boolean) => ({
    isMac: false,
    reachesInside: () => true,
    onDot: () => onDot,
});
const session = (): PathSession => usePathPenStore.getState().session!;
const show = (target = storedTarget()) => {
    act(() => showPath(target, "5"));
    return session();
};
/** The pointer dragged to `p`, and the frame the head follows it on */
const dragTo = (p: FieldPointer) => {
    pathPenMode.move(p);
    vi.advanceTimersToNextFrame();
};
/** On the head's arrows: a step and a half out along the trail */
const onArrows = () => at(head.x + 1.5 * S, head.y);

const env: ToolEnv = {
    stepPx: S,
    snap: true,
    pull: false,
    constrain: false,
    gridSnap: (p) => ({
        x: Math.round(p.x / (S / 2)) * (S / 2),
        y: Math.round(p.y / (S / 2)) * (S / 2),
    }),
    hitRadius: S / 2,
    zoom: ZOOM,
};

beforeEach(() => {
    vi.useFakeTimers();
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
    vi.useRealTimers();
});

describe("the head of a trail dragged out of a line (AP-T16)", () => {
    it("QA-HD-6: shown or selected, it has a handle at its head: the Follow tool's pull arrows, out along its way; open for point edits, none", () => {
        const s = show();
        expect(canDragHead(s)).toBe(true);
        expect(trailHeadOf(s)).toEqual({ at: head, dir: { x: 1, y: 0 } });
        expect(drawingOf(s)!.pullArrows).toEqual([
            { at: head, dir: { x: 1, y: 0 } },
        ]);
        // Edit path keeps its own point handles
        act(() =>
            usePathPenStore.setState({ session: { ...s, phase: "open" } }),
        );
        expect(trailHeadOf(session())).toBeNull();
        expect(drawingOf(session())!.pullArrows).toBeUndefined();
    });

    it("QA-HD-6: trails that lead into end spots (Follow into a form, Ripple in) or go around an outline have none", () => {
        const into = show(storedTarget(undefined, undefined, { along: false }));
        expect(trailHeadOf(into)).toBeNull();
        expect(drawingOf(into)!.pullArrows).toBeUndefined();
        expect(pathPenMode.claims(onArrows(), pressOn(false))).toBe(false);
        const around = show(
            storedTarget(undefined, undefined, { around: true }),
        );
        expect(trailHeadOf(around)).toBeNull();
    });

    it("QA-HD-7: its arrows take a press, and the head itself with no dot on it; a dot standing on the head keeps its own press (P-1)", () => {
        show();
        expect(pathPenMode.claims(onArrows(), pressOn(false))).toBe(true);
        expect(pathPenMode.claims(onArrows(), pressOn(true))).toBe(true);
        expect(pathPenMode.claims(at(head.x, head.y), pressOn(false))).toBe(
            true,
        );
        expect(pathPenMode.claims(at(head.x, head.y), pressOn(true))).toBe(
            false,
        );
        // Behind the head, on the trail, is the trail's (a click selects its walkers)
        expect(
            pathPenMode.claims(at(head.x - 4 * S, head.y), pressOn(false)),
        ).toBe(false);
        expect(pathPenMode.cursorAt(onArrows())).toBe("grab");
    });

    it("QA-HD-8: dragged on, it's step 4b's drawing carried on: the head slides along a straight trail, the spots and marchers shown are AP-T8's for the longer trail", () => {
        show();
        pathPenMode.press(onArrows(), pressOn(false));
        expect(isHeadDrag(session())).toBe(true);
        const f = session().follow!;
        expect(f.grabbed).toBe(5);
        expect(trailLine(f)).toEqual([1, 2, 3, 4, 5]);
        expect(session().points).toEqual([{ id: "h", at: head }]);
        // 6 steps further along the trail's line
        dragTo(at(head.x + 6 * S, head.y + 0.2 * S));
        const s = session();
        expect(s.points).toEqual([
            { id: "h", at: { x: head.x + 6 * S, y: head.y } },
        ]);
        const plan = planTrailDrag(
            lineUp,
            storedPoints(s.points),
            { kind: "keep" },
            S,
        );
        expect(followPlanOf(s)!.spots).toEqual(plan.spots);
        // The real marchers stand where they'll end, as the drag first showed them (DL-16)
        expect(drawingOf(s)!.marchersAt!.spots).toEqual(
            plan.spots.map(([x, y]) => ({ x, y })),
        );
        // No arrows while it's dragged; the hand holds it
        expect(drawingOf(s)!.pullArrows).toBeUndefined();
        expect(pathPenMode.cursorAt(at(head.x, head.y))).toBe("grab");
    });

    it("QA-HD-8: off its line it runs on with a corner at the old head; back along the trail it's cut, never under half a step", () => {
        show();
        pathPenMode.press(onArrows(), pressOn(false));
        dragTo(at(head.x + 4 * S, head.y + 6 * S));
        const [kept, corner] = session().points;
        expect(session().points).toHaveLength(2);
        expect(kept).toEqual({ id: "h", at: head });
        // landed as a click lands a corner while a trail is drawn (the grid, or a field line)
        expect(corner!.id).toBeUndefined();
        expect(
            Math.hypot(
                corner!.at.x - (head.x + 4 * S),
                corner!.at.y - (head.y + 6 * S),
            ),
        ).toBeLessThan(S);
        // Back along the trail: cut where the pointer is, on whole half steps
        dragTo(at(lead.x + 3.2 * S, head.y + 0.1 * S));
        expect(session().points).toEqual([
            { at: { x: lead.x + 3 * S, y: head.y } },
        ]);
        // Over the leader's start: as short as the drag's first leg can be
        dragTo(at(lead.x, lead.y));
        expect(session().points).toEqual([
            { at: { x: lead.x + S / 2, y: head.y } },
        ]);
    });

    it("QA-HD-9: Escape cancels with nothing written, the trail as it was; a press let go where it was changes nothing", () => {
        const shown = show();
        pathPenMode.press(onArrows(), pressOn(false));
        dragTo(at(head.x + 6 * S, head.y));
        expect(cancelFollowDrawing()).toBe(true);
        expect(session()).toBe(shown);
        // The button still down: the drag is over
        dragTo(at(head.x + 9 * S, head.y));
        pathPenMode.release(at(head.x + 9 * S, head.y), null);
        expect(session()).toBe(shown);
        expect(usePathPenStore.getState().saving).toBe(false);
        // A click on the arrows
        pathPenMode.press(onArrows(), pressOn(false));
        pathPenMode.release(onArrows(), { double: false, ownFirst: true });
        expect(session()).toBe(shown);
        // A lost press puts it back too
        pathPenMode.press(onArrows(), pressOn(false));
        dragTo(at(head.x + 6 * S, head.y));
        pathPenMode.cancel();
        expect(session()).toBe(shown);
    });

    it("QA-HD-10: the spacing it was dragged out with is read back from its spots: Even N, else Keep spacing", () => {
        const points = [{ id: "h", at: head }];
        const even = planTrailDrag(
            lineUp,
            [{ id: "h", at: [head.x, head.y] }],
            { kind: "even", steps: 1.5 },
            S,
        ).spots;
        expect(headSpacingOf(show(storedTarget(points, even)), S)).toEqual({
            kind: "even",
            steps: 1.5,
        });
        expect(headSpacingOf(show(), S)).toEqual({ kind: "keep" });
        // A spot moved by hand: planned again with Keep spacing
        const moved = [...even];
        moved[2] = [moved[2]![0], moved[2]![1] + 3 * S];
        expect(headSpacingOf(show(storedTarget(points, moved)), S)).toEqual({
            kind: "keep",
        });
    });

    it("QA-HD-11: cut on an arc leg, the trail keeps its circle: the cut point on it, the new last leg its share of the bulge", () => {
        const from = { x: 0, y: 0 };
        const prefix = [{ at: { x: 100, y: 0 }, bulge: 0.25 }];
        const way = makeAlongTrail([[0, 0]], {
            from: [0, 0],
            to: [100, 0],
            points: [{ at: [100, 0], bulge: 0.25 }],
        });
        const L = way.destOffset;
        const half = way.at(L / 2);
        const cut = headDragPoints(
            prefix,
            from,
            { x: half[0], y: half[1] },
            { ...env, snap: false, hitRadius: 2 },
        );
        expect(cut).toHaveLength(1);
        expect(cut[0]!.at.x).toBeCloseTo(half[0], 6);
        expect(cut[0]!.at.y).toBeCloseTo(half[1], 6);
        const phi = 2 * Math.atan(0.5);
        expect(cut[0]!.bulge).toBeCloseTo(Math.tan(phi / 4) / 2, 9);
    });
});
