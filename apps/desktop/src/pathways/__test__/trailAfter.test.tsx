import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { PathEditor } from "../PathEditor";
import { TRAIL_FIELD_MENU } from "../pathPenMode";
import { ACTIONS } from "@/shortcuts/definitions";
import { clearPath, shapeOf, showPath, usePathPenStore } from "../pathPenStore";
import type { PathSession } from "../pathPenStore";
import { drawingOf } from "../pathPenMode";
import { pathHandles, pathOutline } from "@/shapes/pen/penPath";
import type { PathTarget } from "../pathTarget";
import { setFollowTheLeader } from "../followTheLeader";

/**
 * A dragged-out trail once it's made (pathways step 11 follow-up, owner's lab test 2026-11-17):
 * the drawn trail ends at its own head, with no line from the head back to where the line is
 * entered (QA-SN-15), and no mark on the field names its leader (owner, 2026-11-18).
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

// Trails are edited only with Follow-the-leader on (#1095)
beforeEach(() => setFollowTheLeader(true));

afterEach(() => {
    setFollowTheLeader(false);
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

describe("a trail names no leader on the field (owner, 2026-11-18)", () => {
    it("selected or open, there's no leader's mark: the band says who leads", () => {
        sessionOf(alongTarget());
        render(<PathEditor fieldProperties={fieldProperties} />);
        expect(screen.getByTestId("path-editor")).toBeTruthy();
        expect(screen.queryByTestId("trail-leader")).toBeNull();
        expect(screen.queryByTestId("trail-reverse")).toBeNull();
        expect(document.body.textContent).not.toContain("Leader ·");
        cleanup();
        setPhase("open");
        render(<PathEditor fieldProperties={fieldProperties} />);
        expect(screen.queryByTestId("trail-leader")).toBeNull();
        expect(screen.queryByTestId("trail-reverse")).toBeNull();
    });

    it("Reverse leader stays on the field's menu on a trail and on Alt+L", () => {
        expect(TRAIL_FIELD_MENU).toContain("reverseTrail");
        expect(ACTIONS.reverseTrail.defaultBindings).toEqual(["Alt+L"]);
    });

    it("its bar's tooltips are a command's name, its shortcut and one short line, never a sentence (owner, 2026-11-17)", () => {
        sessionOf(alongTarget());
        render(<PathEditor fieldProperties={fieldProperties} />);
        const edit = screen.getByTestId("path-edit");
        expect(edit.getAttribute("aria-label")).toBe("Edit path");
        expect(edit.dataset.tipLabel).toBe("Edit path");
        expect(edit.dataset.tipAction).toBe("editPath");
        expect(edit.dataset.tipHint).toBe(
            "Drag its points, or its head to draw on",
        );
        // Every tooltip line on the bar fits in a line or two
        for (const el of document.querySelectorAll<HTMLElement>(
            "[data-tip-label]",
        )) {
            expect(el.dataset.tipLabel!.length).toBeLessThanOrEqual(40);
            expect((el.dataset.tipHint ?? "").length).toBeLessThanOrEqual(64);
        }
    });
});
