import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type { FieldPointer } from "@/field/editor/fieldEditor";
import { setShapeField } from "@/shapes/field/shapeField";
import { transactionWithHistory } from "@/db-functions/history";
import { planTrailDrag } from "@/db-functions/timelineTrailDrag";
import { pathPenMode } from "../pathPenMode";
import {
    clearPath,
    openPath,
    setPathSelectionPort,
    showPath,
    storedPoints,
    usePathPenStore,
    type PathSession,
} from "../pathPenStore";
import type { PathTarget } from "../pathTarget";
import { cancelFollowDrawing, followPlanOf } from "../followDrag";
import { headSpacingOf, isHeadDrag } from "../trailHead";
import { formGrabFor, splitAt, tailSpacing } from "../trailForm";

vi.mock("@/db-functions/history", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("@/db-functions/history")>();
    return { ...actual, transactionWithHistory: vi.fn(async () => {}) };
});

/**
 * Dragging a trail's marcher reshapes its form (owner, 2026-11-17; plan step 4a, trails): a middle
 * marcher bends the line there, the leader moves the head, the tail slides along the trail, Alt
 * detaches one marcher; Edit path off keeps the route in. Spec L.17, QA-FD-1 to QA-FD-9.
 */

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const S = fieldProperties.pixelsPerStep;
const ZOOM = 2;
// On the field's half-step grid, so a landed point is where the pointer is
const X0 = 40 * S;
const Y0 =
    Math.round((fieldProperties.centerFrontPoint.yPixels - 30 * S) * 1000) /
    1000;

/** Five marchers two steps apart, M5 leading, dragged out 10 steps right: AP-T8's spots */
const homes = [1, 2, 3, 4, 5].map((_, i) => ({ x: X0 + 2 * i * S, y: Y0 }));
const lead = homes[4]!;
const lineUp = homes.map((p): [number, number] => [p.x, p.y]);

function storedTarget(length = 10): PathTarget {
    const head = { x: lead.x + length * S, y: Y0 };
    const points = [{ id: "h", at: head }];
    const spots = planTrailDrag(
        lineUp,
        points.map((p) => ({ id: p.id, at: [p.at.x, p.at.y] })),
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
        points: points.map((p) => ({ id: p.id, at: [p.at.x, p.at.y] })),
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

/** Where each marcher stands at the end of the move (10 steps out): M1 2 steps past the leader's start */
const spot = (id: number) => ({ x: lead.x + 2 * id * S, y: Y0 });

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
/** A press on marcher `id`'s dot */
const onMarcher = (id: number) => ({
    isMac: false,
    reachesInside: () => false,
    onDot: () => true,
    marcher: () => id,
});
const session = (): PathSession => usePathPenStore.getState().session!;
const show = (editing: boolean, target = storedTarget()) => {
    act(() => showPath(target, "5"));
    if (editing) act(() => void openPath());
    return session();
};
/** Marcher `id` pressed, dragged to `to` (its frame run), and let go there unless `hold` */
const drag = (id: number, to: FieldPointer, hold = false) => {
    const from = spot(id);
    const start = at(from.x, from.y, to.alt);
    pathPenMode.press(start, onMarcher(id));
    pathPenMode.move(to);
    vi.advanceTimersToNextFrame();
    if (!hold) pathPenMode.release(to, null);
};
const writes = (name: string) =>
    vi.mocked(transactionWithHistory).mock.calls.filter(([, n]) => n === name);
const picked = { ids: [] as readonly number[] };

beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(transactionWithHistory).mockClear();
    picked.ids = [1, 2, 3, 4, 5];
    setPathSelectionPort({
        get: () => picked.ids,
        set: (ids) => {
            picked.ids = ids;
        },
    });
    // Everyone stands on their end spot: the playhead at the move's end
    setShapeField({
        fieldProperties: () => fieldProperties,
        zoom: () => ZOOM,
        marchers: () => [],
        drawn: (ids) => new Map(ids.map((id) => [id, spot(id)])),
    });
});

afterEach(() => {
    act(() => clearPath());
    setPathSelectionPort(null);
    setShapeField(null);
    vi.useRealTimers();
});

const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

describe("a trail's form, reshaped by dragging its marchers", () => {
    it("QA-FD-1: a press on a marcher standing on its spot is the trail's, Edit path on or off; elsewhere on the move, not", () => {
        show(false);
        const p = spot(3);
        expect(pathPenMode.claims(at(p.x, p.y), onMarcher(3))).toBe(true);
        show(true);
        expect(pathPenMode.claims(at(p.x, p.y), onMarcher(3))).toBe(true);
        // Mid-move the marcher isn't on its spot: the field's rules
        setShapeField({
            fieldProperties: () => fieldProperties,
            zoom: () => ZOOM,
            marchers: () => [],
            drawn: (ids) => new Map(ids.map((id) => [id, homes[id - 1]!])),
        });
        expect(pathPenMode.claims(at(p.x, p.y), onMarcher(3))).toBe(false);
    });

    it("QA-FD-2: a middle marcher bends the line there; it stays under the pointer, the spacing holds, the head moves with its leg; Edit path off keeps the route in", () => {
        show(false);
        const to = { x: spot(3).x, y: Y0 + 3 * S };
        drag(3, at(to.x, to.y), true);
        expect(isHeadDrag(session())).toBe(true);
        const pts = session().points;
        // The route in (the leader's start to the tail's spot) is kept by a corner at the tail
        expect(pts).toHaveLength(3);
        expect(near(pts[0]!.at, spot(1))).toBe(true);
        expect(near(pts[1]!.at, to)).toBe(true);
        expect(pts[1]!.tension).toBeUndefined();
        // The corner's leg was the last: the head moves with it, that leg as it was (4 steps)
        expect(near(pts[2]!.at, { x: to.x + 4 * S, y: to.y })).toBe(true);
        expect(pts[2]!.id).toBe("h");
        const plan = followPlanOf(session())!;
        expect(near({ x: plan.spots[2]![0], y: plan.spots[2]![1] }, to)).toBe(
            true,
        );
        pathPenMode.release(at(to.x, to.y), null);
        expect(writes("dragTrailHead")).toHaveLength(1);
    });

    it("QA-FD-3: with Edit path on nothing is protected: no corner at the tail, the route in bends too", () => {
        show(true);
        const to = { x: spot(3).x, y: Y0 + 3 * S };
        drag(3, at(to.x, to.y), true);
        const pts = session().points;
        expect(pts).toHaveLength(2);
        expect(near(pts[0]!.at, to)).toBe(true);
        act(() => void cancelFollowDrawing());
    });

    it("QA-FD-4: off the last leg, the corner follows the pointer and the head slides along its leg so the stretch after it keeps its length", () => {
        // A trail with a corner after the form's middle: the head slides, not translates
        const target = storedTarget(10);
        const bent: PathTarget = {
            ...target,
            points: [
                { id: "a", at: [lead.x + 8 * S, Y0] },
                { id: "h", at: [lead.x + 8 * S, Y0 + 2 * S] },
            ],
            ends: {
                from: [lead.x, lead.y],
                to: [lead.x + 8 * S, Y0 + 2 * S],
            },
        };
        const s = show(true, bent);
        const grab = formGrabFor(s, 3, S);
        expect(grab).not.toBe("lineUp");
        const before = (grab as Exclude<typeof grab, "lineUp" | null>)!;
        const from = spot(3);
        pathPenMode.press(at(from.x, from.y), onMarcher(3));
        pathPenMode.move(at(from.x, from.y - 2 * S));
        vi.advanceTimersToNextFrame();
        const pts = session().points;
        const plan = followPlanOf(session())!;
        // The grabbed marcher under the pointer, the head's distance from it as it was
        expect(plan.spots[2]![0]).toBeCloseTo(from.x, 2);
        expect(plan.spots[2]![1]).toBeCloseTo(from.y - 2 * S, 2);
        const total = plan.way.destOffset;
        expect(total - plan.ends[2]!).toBeCloseTo(before.back[2]!, 4);
        // The head stays on its leg's line (x = the corner's)
        expect(pts.at(-1)!.at.x).toBeCloseTo(lead.x + 8 * S, 2);
        act(() => void cancelFollowDrawing());
    });

    it("QA-FD-5: the leader moves the head point; the others follow back from it, spaced as before", () => {
        show(false);
        const to = { x: spot(5).x, y: Y0 + 4 * S };
        drag(5, at(to.x, to.y), true);
        const pts = session().points;
        expect(near(pts.at(-1)!.at, to)).toBe(true);
        expect(pts.at(-1)!.id).toBe("h");
        // Edit path off: the corner at the tail keeps the route in
        expect(near(pts[0]!.at, spot(1))).toBe(true);
        pathPenMode.release(at(to.x, to.y), null);
        expect(writes("dragTrailHead")).toHaveLength(1);
    });

    it("QA-FD-6: the tail slides along the trail: every gap back from the head scales, on half steps; the points stay; the write is one undo step", () => {
        show(false);
        // Back to the leader's start: the form stands on all 10 steps
        drag(1, at(lead.x, Y0), true);
        const f = session().follow!;
        expect(f.spacing.kind).toBe("gaps");
        if (f.spacing.kind !== "gaps") return;
        expect(f.spacing.back.map((b) => b / S)).toEqual([10, 7.5, 5, 2.5, 0]);
        expect(session().points).toHaveLength(1);
        pathPenMode.release(at(lead.x, Y0), null);
        expect(writes("dragTrailHead")).toHaveLength(1);
        // Read back from the written spots, the slid form keeps its gaps
        const plan = planTrailDrag(
            lineUp,
            storedPoints(session().points),
            f.spacing,
            S,
        );
        const target = storedTarget();
        const written = show(false, {
            ...target,
            trail: {
                ...target.trail!,
                members: target.trail!.members.map((m, q) => ({
                    ...m,
                    to: { x: plan.spots[q]![0], y: plan.spots[q]![1] },
                })),
            },
        });
        // Read back from the written spots: evenly spaced, so Even 2.5 (the same spots)
        expect(headSpacingOf(written, S)).toEqual({
            kind: "even",
            steps: 2.5,
        });
    });

    it("QA-FD-6: an uneven line's gaps all scale alike (an uneven line stays uneven), never so far back a marcher walks backward, and read back as written", () => {
        const plan = planTrailDrag(
            lineUp,
            [{ at: [lead.x + 10 * S, Y0] }],
            { kind: "keep" },
            S,
        );
        const back = [9, 5, 3, 1, 0].map((b) => b * S);
        const env = {
            stepPx: S,
            snap: true,
            pull: false,
            constrain: false,
            gridSnap: (p: { x: number; y: number }) => p,
            hitRadius: S / 2,
            zoom: ZOOM,
        };
        const grab = { back, spacing: { kind: "keep" as const } };
        const slid = tailSpacing(plan, grab, { x: lead.x, y: Y0 }, env);
        expect(slid.kind).toBe("gaps");
        if (slid.kind !== "gaps") return;
        expect(slid.back.map((b) => b / S)).toEqual(
            [9, 5, 3, 1, 0].map((b) => (b * 10) / 9),
        );
        // Far back past the line-up: held where no one walks backward
        const far = tailSpacing(plan, grab, { x: X0 - 40 * S, y: Y0 }, env);
        const farPlan = planTrailDrag(
            lineUp,
            [{ at: [lead.x + 10 * S, Y0] }],
            far,
            S,
        );
        expect(farPlan.forward).toBe(true);
    });

    it("QA-FD-7: Escape mid-drag writes nothing, the trail as it was; a click on a marcher only selects it", () => {
        const shown = show(false);
        drag(3, at(spot(3).x, Y0 + 3 * S), true);
        act(() => void cancelFollowDrawing());
        pathPenMode.cancel();
        expect(session()).toBe(shown);
        expect(writes("dragTrailHead")).toHaveLength(0);
        // A click: no drag, nothing written, that marcher selected (kept when it's selected)
        picked.ids = [2];
        const p = spot(3);
        pathPenMode.press(at(p.x, p.y), onMarcher(3));
        pathPenMode.release(at(p.x, p.y), { double: false, ownFirst: true });
        expect(session().phase).toBe("closed");
        expect(session().points).toEqual(shown.points);
        expect(picked.ids).toEqual([3]);
        expect(writes("dragTrailHead")).toHaveLength(0);
    });

    it("QA-FD-8: Alt detaches the one marcher: its spot leaves the line, shown where dragged, one write; the trail stays", async () => {
        const shown = show(false);
        const to = { x: spot(3).x, y: Y0 - 5 * S };
        drag(3, at(to.x, to.y, true), true);
        expect(isHeadDrag(session())).toBe(false);
        const drawn = pathPenMode.drawing()!;
        expect(drawn.marchersAt!.ids).toEqual([3]);
        expect(near(drawn.marchersAt!.spots[0]!, to)).toBe(true);
        pathPenMode.release(at(to.x, to.y, true), null);
        await vi.waitFor(() =>
            expect(writes("detachTrailSpot")).toHaveLength(1),
        );
        expect(writes("dragTrailHead")).toHaveLength(0);
        expect(session().points).toEqual(shown.points);
        expect(pathPenMode.drawing()!.marchersAt).toBeUndefined();
    });

    it("QA-FD-9: a middle marcher still in the line-up (a short trail) can't bend it: refused with the reason, nothing written", () => {
        const s = show(false, storedTarget(3));
        expect(formGrabFor(s, 2, S)).toBe("lineUp");
        // The tail and the leader still take their drags
        expect(formGrabFor(s, 1, S)).not.toBe("lineUp");
        expect(formGrabFor(s, 5, S)).not.toBe("lineUp");
    });

    it("splits an arc leg into two arcs of the same circle at a corner set on it", () => {
        const from = { x: 0, y: 0 };
        const points = [{ at: { x: 10 * S, y: 0 }, bulge: 0.25 }];
        const split = splitAt(points, from, 5 * S)!;
        expect(split.index).toBe(0);
        expect(split.points).toHaveLength(2);
        const [a, b] = split.points;
        // Same circle, each half its share of the sweep
        expect(a!.bulge).toBeGreaterThan(0);
        expect(b!.bulge).toBeGreaterThan(0);
        expect(a!.bulge! + b!.bulge!).toBeLessThan(0.25 * 2);
        expect(b!.at).toEqual({ x: 10 * S, y: 0 });
    });
});
