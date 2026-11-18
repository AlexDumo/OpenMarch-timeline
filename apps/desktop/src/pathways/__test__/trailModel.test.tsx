import { afterEach, describe, expect, it } from "vitest";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { PathEditor } from "../PathEditor";
import {
    abortPointDrag,
    clearPath,
    convertTrailBlocker,
    pointsOf,
    showPath,
    usePathPenStore,
} from "../pathPenStore";
import type { PathTarget } from "../pathTarget";
import { liveTrailOf } from "../trailLive";
import { drawingOf } from "../pathPenMode";

/**
 * A trail's path is the only truth (owner, 2026-11-17, spec L.18) on the field: while a point of a
 * dragged-out trail is dragged, the form and the marchers follow live and nothing is written
 * (QA-TM-2); Escape calls the drag off (QA-TM-2); Convert to shape sits in the path bar's ···
 * (QA-TM-4).
 */

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const S = fieldProperties.pixelsPerStep;
const p = (x: number, y: number) => ({ x: x * S, y: y * S });

/** Four 2 steps apart, M4 leading, up 8 then right 8 along the way, Keep spacing */
const homes = [p(0, 0), p(2, 0), p(4, 0), p(6, 0)];

function alongTarget(
    points: [number, number][] = [
        [6, 8],
        [14, 8],
    ],
    spots = [p(8, 8), p(10, 8), p(12, 8), p(14, 8)],
): PathTarget {
    return {
        timelineId: 1,
        transitionId: 1,
        marcherId: 4,
        start: 32,
        end: 48,
        from: homes[3]!,
        to: spots[0]!,
        routeId: 9,
        points: points.map(([x, y], i) => ({
            id: `p${i}`,
            at: [x * S, y * S],
        })),
        ends: { from: [6 * S, 0], to: [14 * S, 8 * S] },
        group: null,
        trail: {
            members: homes.map((from, i) => ({
                marcherId: i + 1,
                drill: `T${i + 1}`,
                from,
                to: spots[i]!,
            })),
            leaderId: 4,
            reverse: false,
            along: true,
        },
    };
}

const open = (target: PathTarget) =>
    act(() => {
        showPath(target, "T4");
        const s = usePathPenStore.getState().session!;
        usePathPenStore.setState({ session: { ...s, phase: "open" } });
    });

/** The head point dragged to `at` (in steps), as a point drag shows it */
const dragHead = (at: [number, number]) =>
    act(() => {
        const s = usePathPenStore.getState().session!;
        const points = [...s.points];
        points[1] = { ...points[1]!, at: p(...at) };
        usePathPenStore.setState({ session: { ...s, points, dragging: 1 } });
    });

const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

afterEach(() => {
    act(() => clearPath());
    cleanup();
});

describe("A trail's path is the only truth on the field (L.18)", () => {
    it("QA-TM-2: a point dragged moves the form and the marchers live, spaced back from the head as before; nothing while no point is dragged", () => {
        open(alongTarget());
        const s0 = usePathPenStore.getState().session!;
        expect(liveTrailOf(s0)).toBeNull();
        useTimelineSelectionStore.setState({ playheadBeat: 48 });
        dragHead([14, 12]);
        const s = usePathPenStore.getState().session!;
        const live = liveTrailOf(s)!;
        expect(live).not.toBeNull();
        // The last leg now runs from (6, 8) to (14, 12): everyone 0, 2, 4 and 6 steps back on it
        const len = Math.hypot(8, 4);
        const back = (b: number) => p(14 - (8 * b) / len, 12 - (4 * b) / len);
        const want = [back(6), back(4), back(2), back(0)];
        live.spots.forEach((at, q) => expect(near(at, want[q]!)).toBe(true));
        // At the move's end the marchers stand on them, and the spots still show
        expect(live.marchersAt!.ids).toEqual([1, 2, 3, 4]);
        expect(live.marchersAt!.keepSpots).toBe(true);
        live.marchersAt!.spots.forEach((at, q) =>
            expect(near(at, want[q]!)).toBe(true),
        );
        // The field's drawing carries them: one path, the band and the walked route agree
        const drawing = drawingOf(s)!;
        expect(drawing.marchersAt?.ids).toEqual([1, 2, 3, 4]);
        drawing.spots.forEach((at, q) => expect(near(at, want[q]!)).toBe(true));
        // Mid-move, the marchers are where the playhead has them, short of their spots
        useTimelineSelectionStore.setState({ playheadBeat: 40 });
        const mid = liveTrailOf(usePathPenStore.getState().session!)!;
        expect(near(mid.marchersAt!.spots[3]!, want[3]!)).toBe(false);
        // Nothing written while dragging: the stored trail is as it was
        expect(usePathPenStore.getState().saved).toBe(0);
    });

    it("QA-TM-2: Escape calls a point's drag off: the points as stored, nothing written", () => {
        open(alongTarget());
        expect(abortPointDrag()).toBe(false);
        dragHead([14, 12]);
        expect(abortPointDrag()).toBe(true);
        const s = usePathPenStore.getState().session!;
        expect(s.dragging).toBeNull();
        expect(s.points).toEqual(pointsOf(s.target));
        expect(liveTrailOf(s)).toBeNull();
        expect(usePathPenStore.getState().saved).toBe(0);
    });

    it("QA-TM-4: ··· offers Convert to shape on a dragged-out trail; while the tail is still in the line it's greyed out with the reason", async () => {
        open(alongTarget());
        expect(
            convertTrailBlocker(usePathPenStore.getState().session),
        ).toBeNull();
        render(<PathEditor fieldProperties={fieldProperties} />);
        fireEvent.keyDown(screen.getByTestId("path-more"), {
            key: "ArrowDown",
        });
        await screen.findByTestId("path-more-menu");
        const item = screen.getByTestId("path-convert-shape");
        expect(item.textContent).toContain("Convert to shape");
        expect(item).not.toHaveAttribute("aria-disabled", "true");
        cleanup();
        // A 2-step trail on a 6-step line: the tail is still in the line
        open(alongTarget([[8, 0]], [p(2, 0), p(4, 0), p(6, 0), p(8, 0)]));
        expect(convertTrailBlocker(usePathPenStore.getState().session)).toMatch(
            /longer/,
        );
        render(<PathEditor fieldProperties={fieldProperties} />);
        fireEvent.keyDown(screen.getByTestId("path-more"), {
            key: "ArrowDown",
        });
        await screen.findByTestId("path-more-menu");
        expect(screen.getByTestId("path-convert-shape")).toHaveAttribute(
            "aria-disabled",
            "true",
        );
    });
});
