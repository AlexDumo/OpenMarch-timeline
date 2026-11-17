import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type { FieldPointer } from "@/field/editor/fieldEditor";
import { setShapeField } from "@/shapes/field/shapeField";
import { SMOOTH } from "@/shapes/line/lineGeometry";
import { planTrailDrag } from "@/db-functions/timelineTrailDrag";
import { transactionWithHistory } from "@/db-functions/history";
import { drawingOf, pathPenMode } from "../pathPenMode";
import {
    clearPath,
    removeLastPoint,
    showPath,
    startDrawing,
    usePathPenStore,
    type PathSession,
} from "../pathPenStore";
import type { PathTarget } from "../pathTarget";
import {
    cancelFollowDrawing,
    followDrawnPlanOf,
    type FollowDrag,
} from "../followDrag";
import { finishHeadDrag, isHeadClicks, isHeadDrag } from "../trailHead";
import {
    clickPlacesSmooth,
    DRAW_KIND_STORAGE_KEY,
    setDrawKind,
    setOtherKindHeld,
    useDrawKindStore,
} from "../drawKind";

// The write itself is AP-T16's (`timelineTrailHead.test.ts`: the rows, ids kept): here, what the
// field hands it, in one history transaction (one undo step)
vi.mock("@/db-functions/history", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("@/db-functions/history")>();
    return { ...actual, transactionWithHistory: vi.fn(async () => {}) };
});

/**
 * Drawing by clicks (owner, 2026-11-17): the drawing bar's Straight | Curve switch and Alt (what a
 * click places, remembered), a Follow tool end started with a click, and a trail's head clicked to
 * draw on from it (AP-T16 by clicks: clicks place, Enter writes once, Escape writes nothing). Spec
 * L.15, QA-DC-1 to QA-DC-10.
 */

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const S = fieldProperties.pixelsPerStep;
const ZOOM = 2;
const X0 = 40 * S;
// On the half-step grid, which runs from the center front point
const Y0 =
    Math.round((fieldProperties.centerFrontPoint.yPixels - 40 * S) * 1000) /
    1000;

const at = (x: number, y: number, alt = false): FieldPointer => ({
    field: { x, y },
    screen: { x: x * ZOOM, y: y * ZOOM },
    button: 0,
    shift: false,
    alt,
    ctrl: false,
    meta: false,
    kind: "mouse",
});
const pressOn = (onDot = false) => ({
    isMac: false,
    reachesInside: () => true,
    onDot: () => onDot,
});
const session = (): PathSession => usePathPenStore.getState().session!;
const click = (p: FieldPointer, double = false) => {
    pathPenMode.press(p, pressOn());
    pathPenMode.release(p, { double, ownFirst: true });
};
/** The pointer moved with the button up, and the frame the drawing follows it on */
const hover = (p: FieldPointer) => {
    pathPenMode.move(p);
    vi.advanceTimersToNextFrame();
};

beforeEach(() => {
    vi.useFakeTimers();
    localStorage.removeItem(DRAW_KIND_STORAGE_KEY);
    useDrawKindStore.setState({ kind: "straight", otherHeld: false });
    vi.mocked(transactionWithHistory).mockClear();
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

// ---------------------------------------------------------------------------
// The Path pen: Straight | Curve, Alt
// ---------------------------------------------------------------------------

/** One marcher's move, from (X0, Y0) to 20 steps right */
const penTarget: PathTarget = {
    timelineId: 3,
    transitionId: 30,
    marcherId: 1,
    start: 9,
    end: 17,
    from: { x: X0, y: Y0 },
    to: { x: X0 + 20 * S, y: Y0 },
    routeId: null,
    points: [],
    ends: null,
    group: null,
    trail: null,
};

describe("Straight | Curve and Alt (what a click places)", () => {
    it("QA-DC-1: Straight is the default; the choice is remembered with the user's settings, not the show", async () => {
        expect(useDrawKindStore.getState().kind).toBe("straight");
        setDrawKind("curve");
        expect(localStorage.getItem(DRAW_KIND_STORAGE_KEY)).toBe("curve");
        // The next time the app opens
        vi.resetModules();
        const fresh = await import("../drawKind");
        expect(fresh.useDrawKindStore.getState().kind).toBe("curve");
        localStorage.setItem(DRAW_KIND_STORAGE_KEY, "nonsense");
        vi.resetModules();
        const again = await import("../drawKind");
        expect(again.useDrawKindStore.getState().kind).toBe("straight");
    });

    it("QA-DC-2: a click places a corner in Straight, a smooth point at the plain roundness in Curve; Alt places the other kind", () => {
        act(() => startDrawing(penTarget, "1"));
        click(at(X0 + 4 * S, Y0 + 6 * S));
        setDrawKind("curve");
        click(at(X0 + 8 * S, Y0 + 2 * S));
        click(at(X0 + 12 * S, Y0 + 6 * S, true));
        setDrawKind("straight");
        click(at(X0 + 16 * S, Y0 + 2 * S, true));
        expect(session().points.map((p) => p.tension ?? 0)).toEqual([
            0,
            SMOOTH,
            0,
            SMOOTH,
        ]);
        expect(session().points.map((p) => p.at)).toEqual([
            { x: X0 + 4 * S, y: Y0 + 6 * S },
            { x: X0 + 8 * S, y: Y0 + 2 * S },
            { x: X0 + 12 * S, y: Y0 + 6 * S },
            { x: X0 + 16 * S, y: Y0 + 2 * S },
        ]);
    });

    it("QA-DC-3: the leg to the pointer shows the kind a click would place: a tangent bar for a curve point, none for a corner; Alt flips it the moment it's held", () => {
        act(() => startDrawing(penTarget, "1"));
        hover(at(X0 + 6 * S, Y0 + 6 * S));
        expect(drawingOf(session())!.barHandles).toEqual([]);
        // Alt held with the pointer still: the key events set it
        act(() => setOtherKindHeld(true));
        expect(clickPlacesSmooth()).toBe(true);
        const bar = drawingOf(session())!.barHandles!;
        expect(bar).toHaveLength(2);
        const p = { x: X0 + 6 * S, y: Y0 + 6 * S };
        expect(bar.every((b) => b.from.x === p.x && b.from.y === p.y)).toBe(
            true,
        );
        // Along the leg coming in, from the marcher's start
        const d = { x: bar[0]!.at.x - p.x, y: bar[0]!.at.y - p.y };
        expect(Math.abs(d.x * 6 - d.y * 6)).toBeLessThan(1e-9);
        act(() => setOtherKindHeld(false));
        expect(drawingOf(session())!.barHandles).toEqual([]);
        // Curve: the bar; a move with Alt down takes it away
        act(() => setDrawKind("curve"));
        expect(drawingOf(session())!.barHandles).toHaveLength(2);
        hover(at(X0 + 6 * S, Y0 + 6 * S, true));
        expect(useDrawKindStore.getState().otherHeld).toBe(true);
        expect(drawingOf(session())!.barHandles).toEqual([]);
    });

    it("QA-DC-4: a press-and-drag still places a smooth point, its roundness the drag's, in either mode", () => {
        for (const kind of ["straight", "curve"] as const) {
            act(() => setDrawKind(kind));
            act(() => startDrawing(penTarget, "1"));
            click(at(X0 + 4 * S, Y0 + 6 * S));
            const q = { x: X0 + 8 * S, y: Y0 };
            pathPenMode.press(at(q.x, q.y), pressOn());
            pathPenMode.move(at(q.x + 1 * S, q.y));
            pathPenMode.move(at(q.x + 6 * S, q.y));
            pathPenMode.release(at(q.x + 6 * S, q.y), null);
            const t = session().points[1]!.tension ?? 0;
            expect(t).toBeGreaterThan(0);
            expect(t).not.toBe(SMOOTH);
            expect(session().points[1]!.at.x).toBeCloseTo(q.x, 2);
            expect(session().points[1]!.at.y).toBeCloseTo(q.y, 2);
            clearPath();
        }
    });
});

// ---------------------------------------------------------------------------
// The Follow tool: a click on an end starts the drawing
// ---------------------------------------------------------------------------

const starts = new Map(
    [1, 2, 3, 4, 5].map((id, i) => [id, { x: X0 + 2 * i * S, y: Y0 }]),
);

function openFollow() {
    const follow: FollowDrag = {
        window: { start: 9, end: 17 },
        ids: [1, 2, 3, 4, 5],
        order: [1, 2, 3, 4, 5],
        starts,
        grabbed: null,
        spacing: { kind: "keep" },
        ends: "trail",
        keep: null,
        step: S,
    };
    const members = follow.order.map((id) => ({
        marcherId: id,
        drill: `T${id}`,
        from: starts.get(id)!,
        to: starts.get(id)!,
    }));
    usePathPenStore.setState({
        session: {
            phase: "drawing",
            target: {
                ...penTarget,
                marcherId: 5,
                from: starts.get(5)!,
                to: starts.get(5)!,
                trail: { members, leaderId: 5, reverse: false },
            },
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

describe("the Follow tool started with a click", () => {
    it("QA-DC-5: a click on an end grabs it; the first leg follows the pointer with the button up; clicks place points by the switch", () => {
        openFollow();
        const right = starts.get(5)!;
        click(at(right.x, right.y));
        expect(session().follow!.grabbed).toBe(5);
        expect(session().points).toEqual([]);
        // The first leg follows the pointer: the line is planned to it, nothing placed
        hover(at(right.x + 6 * S, right.y));
        expect(session().pointer!.x).toBeCloseTo(right.x + 6 * S, 2);
        expect(session().pointer!.y).toBeCloseTo(right.y, 2);
        expect(followDrawnPlanOf(session())!.spots).toHaveLength(5);
        click(at(right.x + 6 * S, right.y));
        act(() => setDrawKind("curve"));
        click(at(right.x + 6 * S, right.y + 6 * S));
        click(at(right.x + 12 * S, right.y + 6 * S, true));
        const r = (v: number) => Math.round(v * 100) / 100;
        expect(
            session().points.map((p) => [r(p.at.x), r(p.at.y), p.tension ?? 0]),
        ).toEqual([
            [r(right.x + 6 * S), r(right.y), 0],
            [r(right.x + 6 * S), r(right.y + 6 * S), SMOOTH],
            [r(right.x + 12 * S), r(right.y + 6 * S), 0],
        ]);
        // Escape cancels the trail; the ends pulse again
        expect(cancelFollowDrawing()).toBe(true);
        expect(session().follow!.grabbed).toBeNull();
        expect(session().points).toEqual([]);
    });

    it("QA-DC-6: the press-drag out of an end is as before: the first leg lands where it's let go", () => {
        openFollow();
        const left = starts.get(1)!;
        pathPenMode.press(at(left.x, left.y), pressOn(true));
        pathPenMode.move(at(left.x, left.y + 5 * S));
        pathPenMode.move(at(left.x, left.y + 10 * S));
        pathPenMode.release(at(left.x, left.y + 10 * S), null);
        expect(session().follow!.grabbed).toBe(1);
        expect(session().points).toEqual([
            { at: { x: left.x, y: left.y + 10 * S } },
        ]);
    });
});

// ---------------------------------------------------------------------------
// A trail's head clicked: drawn on with clicks (AP-T16)
// ---------------------------------------------------------------------------

/** Five marchers two steps apart, T5 leading, dragged out 10 steps right (AP-T8's spots) */
const homes = [1, 2, 3, 4, 5].map((id, i) => ({ x: X0 + 2 * i * S, y: Y0 }));
const lead = homes[4]!;
const head = { x: lead.x + 10 * S, y: Y0 };

function storedTrail(): PathTarget {
    const spots = planTrailDrag(
        homes.map((p): [number, number] => [p.x, p.y]),
        [{ id: "h", at: [head.x, head.y] }],
        { kind: "keep" },
        S,
    ).spots;
    return {
        timelineId: 3,
        transitionId: 30,
        marcherId: 5,
        start: 9,
        end: 17,
        from: lead,
        to: { x: spots[0]![0], y: spots[0]![1] },
        routeId: 300,
        points: [{ id: "h", at: [head.x, head.y] }],
        ends: { from: [lead.x, lead.y], to: [head.x, head.y] },
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
        },
    };
}

const show = () => {
    act(() => showPath(storedTrail(), "5"));
    return session();
};
const onHead = () => at(head.x + 1.5 * S, head.y);

/** The trail's write (AP-T16): one history transaction, one undo step */
const writes = () =>
    vi
        .mocked(transactionWithHistory)
        .mock.calls.filter(([, name]) => name === "dragTrailHead");

describe("a trail's head clicked: drawn on with clicks (AP-T16)", () => {
    it("QA-DC-7: a click on the head draws on from it: the next leg follows the pointer, clicks place points, Enter writes what's placed, in one undo step", async () => {
        const shown = show();
        click(onHead());
        expect(isHeadClicks(session())).toBe(true);
        expect(session().phase).toBe("drawing");
        expect(session().points).toEqual(shown.points);
        expect(writes()).toHaveLength(0);
        // The pen's cross while drawing on
        expect(pathPenMode.cursorAt(at(head.x + 4 * S, head.y + 6 * S))).toBe(
            "crosshair",
        );
        // The next leg follows the pointer: on with a point at it, nothing placed yet
        hover(at(head.x + 4 * S, head.y + 6 * S));
        expect(session().points).toHaveLength(2);
        expect(session().follow!.head!.prefix).toEqual(shown.points);
        // Two corners placed by clicks
        click(at(head.x, head.y + 6 * S));
        click(at(head.x + 6 * S, head.y + 6 * S));
        const placed = [
            { id: "h", at: head },
            { at: { x: head.x, y: head.y + 6 * S } },
            { at: { x: head.x + 6 * S, y: head.y + 6 * S } },
        ];
        expect(session().follow!.head!.prefix).toEqual(placed);
        // The pointer wanders off on a third leg: shown, not placed
        hover(at(head.x + 6 * S, head.y + 12 * S));
        expect(session().points).toHaveLength(4);
        // More marchers come out: the line is planned to the pointer while drawing
        expect(followDrawnPlanOf(session())!.spots).toHaveLength(5);
        await act(() => finishHeadDrag());
        expect(writes()).toHaveLength(1);
        // Shown again, closed, with what was placed and written
        expect(session().phase).toBe("closed");
        expect(session().points).toEqual(placed);
        expect(isHeadDrag(session())).toBe(false);
    });

    it("QA-DC-8: drawn on with clicks, the switch and Alt choose each point's kind; Backspace takes the last click back; back along the trail a click cuts it", async () => {
        show();
        click(onHead());
        act(() => setDrawKind("curve"));
        click(at(head.x + 4 * S, head.y + 6 * S));
        click(at(head.x + 8 * S, head.y, true));
        expect(session().points.map((p) => p.tension ?? 0)).toEqual([
            0,
            SMOOTH,
            0,
        ]);
        // A curve point shows its cue at the pointer; a cut back along the trail shows none
        hover(at(head.x + 8 * S, head.y + 6 * S));
        expect(drawingOf(session())!.barHandles).toHaveLength(2);
        removeLastPoint();
        expect(session().points).toHaveLength(2);
        // Back along the stored trail: a cut there, on half steps
        hover(at(lead.x + 3.2 * S, head.y + 0.1 * S));
        expect(session().points).toEqual([
            { at: { x: lead.x + 3 * S, y: head.y } },
        ]);
        expect(drawingOf(session())!.barHandles).toEqual([]);
        click(at(lead.x + 3.2 * S, head.y + 0.1 * S));
        await act(() => finishHeadDrag());
        expect(writes()).toHaveLength(1);
        expect(session().points).toEqual([
            { at: { x: lead.x + 3 * S, y: head.y } },
        ]);
    });

    it("QA-DC-9: a double-click finishes (its first click places its point); Escape writes nothing and shows the trail as it was", async () => {
        const shown = show();
        click(onHead());
        click(at(head.x, head.y + 6 * S));
        expect(cancelFollowDrawing()).toBe(true);
        expect(session()).toBe(shown);
        expect(writes()).toHaveLength(0);
        // Again, finished with a double-click
        click(onHead());
        const p = at(head.x + 4 * S, head.y + 6 * S);
        click(p);
        pathPenMode.press(p, pressOn());
        pathPenMode.release(p, { double: true, ownFirst: true });
        await vi.waitFor(() => expect(writes()).toHaveLength(1));
        await vi.waitFor(() => expect(session().phase).toBe("closed"));
        expect(session().points).toEqual([
            { id: "h", at: head },
            { at: { x: head.x + 4 * S, y: head.y + 6 * S } },
        ]);
    });

    it("QA-DC-10: a press-drag-release on the head still writes on release, at once", async () => {
        show();
        pathPenMode.press(onHead(), pressOn());
        pathPenMode.move(at(head.x + 3 * S, head.y));
        vi.advanceTimersToNextFrame();
        pathPenMode.move(at(head.x + 6 * S, head.y));
        vi.advanceTimersToNextFrame();
        pathPenMode.release(at(head.x + 6 * S, head.y), null);
        await vi.waitFor(() => expect(writes()).toHaveLength(1));
        await vi.waitFor(() => expect(session().phase).toBe("closed"));
        expect(session().points).toEqual([
            { id: "h", at: { x: head.x + 6 * S, y: head.y } },
        ]);
    });
});
