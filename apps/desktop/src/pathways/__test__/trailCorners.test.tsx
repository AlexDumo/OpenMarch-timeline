import { afterEach, describe, expect, it } from "vitest";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import {
    createResolver,
    type CornerCount,
    type TimelineSnapshot,
} from "@openmarch/core";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import { PathEditor } from "../PathEditor";
import {
    chipObstaclesOf,
    chipPlaces,
    chipSize,
    onTrail,
    toggleCornerChips,
    useCornerChipsStore,
    type ChipObstacle,
} from "../TrailCornerCounts";
import { subscribeHistoryChanges } from "@/db-functions/history";
import { clearPath, pathKey, showPath, usePathPenStore } from "../pathPenStore";
import type { PathTarget } from "../pathTarget";
import { followTarget, type FollowDrag } from "../followDrag";
import {
    cornerRange,
    formatCount,
    offCountTally,
    trailCornersOf,
} from "../trailCorners";
import type { PathSession } from "../pathPenStore";

/**
 * Corner counts for block letters, pathways step 6 (spec Appendix L.9): the counts the field shows
 * for the trail a session holds (TC-1 to TC-4), the chips and the corner's list (TC-5, TC-6), and
 * the path bar's warning (TC-7). QA-TC-2, QA-TC-3, QA-TC-7, QA-TC-8, QA-TC-9 and QA-TC-13 in the app.
 */

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const S = fieldProperties.pixelsPerStep;
const p = (x: number, y: number) => ({ x: x * S, y: y * S });

/** QA-TC-2's line, in steps: four 2 apart, M4 leading, up 8 then right 8, ends along the way */
const homes = [p(0, 0), p(2, 0), p(4, 0), p(6, 0)];
const spots = [p(8, 8), p(10, 8), p(12, 8), p(14, 8)];

function alongTarget(counts = 16): PathTarget {
    const members = homes.map((from, i) => ({
        marcherId: i + 1,
        drill: `T${i + 1}`,
        from,
        to: spots[i]!,
    }));
    return {
        timelineId: 1,
        transitionId: 1,
        marcherId: 4,
        start: 32,
        end: 32 + counts,
        from: homes[3]!,
        to: spots[0]!,
        routeId: 9,
        points: [
            { id: "a", at: [6 * S, 8 * S] },
            { id: "b", at: [14 * S, 8 * S] },
        ],
        ends: { from: [6 * S, 0], to: [14 * S, 8 * S] },
        group: null,
        trail: {
            members,
            leaderId: 4,
            reverse: false,
            along: true,
        },
    };
}

const sessionOf = (target: PathTarget): PathSession => {
    act(() => showPath(target, "T4"));
    return usePathPenStore.getState().session!;
};

afterEach(() => {
    act(() => clearPath());
    useCornerChipsStore.setState({ pinnedFor: null, listOpen: false });
    cleanup();
});

/** Each corner's turns as [drill, count to a tenth], leader first */
const listed = (s: PathSession) => {
    const view = trailCornersOf(s)!;
    return view.corners.map((c) =>
        c.turns.map((t) => [view.drills[t.q], formatCount(t.count)]),
    );
};

describe("corner counts on a trail (spec L.9, pathways step 6)", () => {
    it("QA-TC-2: a stored trail along the way, every turn on a count, counted from the move's start", () => {
        const s = sessionOf(alongTarget());
        expect(listed(s)).toEqual([
            [
                ["T3", "2"],
                ["T2", "4"],
                ["T1", "6"],
            ],
            [
                ["T4", "8"],
                ["T3", "10"],
                ["T2", "12"],
                ["T1", "14"],
            ],
        ]);
        expect(offCountTally(trailCornersOf(s))).toEqual({
            turns: 0,
            corners: 0,
        });
        expect(trailCornersOf(s)!.corners.map(cornerRange)).toEqual([
            "2–6",
            "8–14",
        ]);
    });

    it("a trail nobody founds (each taken over at its start) has no counts (TC-2)", () => {
        const t = alongTarget();
        const s = sessionOf({ ...t, trail: { ...t.trail!, unfounded: true } });
        expect(trailCornersOf(s)).toBeNull();
    });

    it("QA-TC-9: a founder taken over partway turns at no corner after it leaves (TC-2)", () => {
        const t = alongTarget();
        // T1 is taken over on beat 32 + 9: it would turn at (6,8) on count 14
        const members = t.trail!.members.map((m, q) =>
            q === 0 ? { ...m, until: 41 } : m,
        );
        const s = sessionOf({ ...t, trail: { ...t.trail!, members } });
        expect(listed(s)[1]).toEqual([
            ["T4", "8"],
            ["T3", "10"],
            ["T2", "12"],
        ]);
        expect(trailCornersOf(s)!.corners[1]!.stopBefore).toBe(1);
        // its turn at the leader's start, on count 6, is before it leaves
        expect(listed(s)[0]).toContainEqual(["T1", "6"]);
    });

    it("QA-TC-3: over 12 counts, turns fall between counts", () => {
        const s = sessionOf(alongTarget(12));
        expect(listed(s)).toEqual([
            [
                ["T3", "1.5"],
                ["T2", "3"],
                ["T1", "4.5"],
            ],
            [
                ["T4", "6"],
                ["T3", "7.5"],
                ["T2", "9"],
                ["T1", "10.5"],
            ],
        ]);
        expect(offCountTally(trailCornersOf(s))).toEqual({
            turns: 4,
            corners: 2,
        });
    });

    it("a point dragged on the open trail changes the counts with it, before anything is saved", () => {
        const s = sessionOf(alongTarget());
        // the corner moved 1 step up: the leader's walk is longer and its corner farther, so its
        // count there changes before the edit is saved
        const moved: PathSession = {
            ...s,
            phase: "open",
            points: [{ id: "a", at: p(6, 9) }, s.points[1]!],
        };
        const before = trailCornersOf(s)!.corners[1]!;
        const after = trailCornersOf(moved)!.corners[1]!;
        expect(after.at).toEqual([6 * S, 9 * S]);
        expect(after.turns[0]!.count).not.toBeCloseTo(
            before.turns[0]!.count,
            3,
        );
    });

    it("a trail into end spots with a gap reads the whole end line, as the resolver does", () => {
        // three founders; slot 1 is vacant, its spot off the line, so the end line bends there
        const db: TimelineSnapshot = {
            marchers: [
                { id: 1, home: [0, 0] },
                { id: 3, home: [8, 0] },
            ],
            shapes: {},
            transitions: {
                1: {
                    id: 1,
                    start: 0,
                    end: 16,
                    dest: null,
                    points: [
                        [20, 10],
                        [24, 12],
                        [20, 22],
                    ],
                    slots: 3,
                    style: "follow_the_leader",
                    order: "slot",
                    params: { waypoints: [] },
                    route: 1,
                },
            },
            routes: {
                1: {
                    geometry: {
                        v: 1,
                        from: [8, 0],
                        to: [20, 10],
                        points: [{ id: "a", at: [14, 0] }],
                    },
                },
            },
            assignments: [
                {
                    id: 1,
                    marcher: 1,
                    transition: 1,
                    slot: 0,
                    start: 0,
                    end: 16,
                    layer: 0,
                },
                {
                    id: 2,
                    marcher: 3,
                    transition: 1,
                    slot: 2,
                    start: 0,
                    end: 16,
                    layer: 0,
                },
            ],
        };
        const r = createResolver(db);
        const xy = ([x, y]: readonly [number, number]) => ({ x, y });
        const target: PathTarget = {
            timelineId: 1,
            transitionId: 1,
            marcherId: 3,
            start: 0,
            end: 16,
            from: { x: 8, y: 0 },
            to: { x: 20, y: 10 },
            routeId: 1,
            points: [{ id: "a", at: [14, 0] }],
            ends: { from: [8, 0], to: [20, 10] },
            group: null,
            trail: {
                members: [
                    {
                        marcherId: 1,
                        drill: "A1",
                        from: xy([0, 0]),
                        to: xy([20, 10]),
                        endAt: 0,
                    },
                    {
                        marcherId: 3,
                        drill: "A3",
                        from: xy([8, 0]),
                        to: xy([20, 22]),
                        // its slot is 2: slot 1 is the vacant spot (24,12)
                        endAt: 2,
                    },
                ],
                leaderId: 3,
                reverse: false,
                endLine: [xy([20, 10]), xy([24, 12]), xy([20, 22])],
            },
        };
        const view = trailCornersOf(sessionOf(target))!;
        // the entrance (20,10) and the gap's bend (24,12): only the leader turns at either
        const entrance = view.corners.find(
            (c) => c.at[0] === 20 && c.at[1] === 10,
        )!;
        const bend = view.corners.find((c) => c.at[0] === 24)!;
        for (const c of [entrance, bend]) {
            expect(c.turns.map((t) => view.drills[t.q])).toEqual(["A3"]);
            const at = r.positionAt(3, c.turns[0]!.count);
            expect(at[0]).toBeCloseTo(c.at[0], 6);
            expect(at[1]).toBeCloseTo(c.at[1], 6);
        }
    });

    it("dragging out a trail: the counts follow the pointer (DL-20)", () => {
        const starts = new Map(homes.map((h, i) => [i + 1, h]));
        const follow: FollowDrag = {
            window: { start: 9, end: 17 },
            ids: [1, 2, 3, 4],
            order: [1, 2, 3, 4],
            starts,
            grabbed: 4,
            spacing: { kind: "keep" },
            ends: "trail",
            keep: null,
            step: S,
        };
        const base: PathTarget = {
            timelineId: -1,
            transitionId: -1,
            marcherId: 4,
            start: 9,
            end: 17,
            from: homes[3]!,
            to: homes[3]!,
            routeId: null,
            points: [],
            ends: null,
            group: null,
        };
        const drills = new Map([1, 2, 3, 4].map((id) => [id, `T${id}`]));
        const session = (pointer: { x: number; y: number }): PathSession => ({
            phase: "drawing",
            target: followTarget(base, follow, drills),
            drill: "T4",
            points: [],
            pointer,
            selected: null,
            dragging: null,
            object: false,
            follow,
        });
        // 10 steps straight up from the leader over 8 counts: each walks 10 steps (Keep spacing),
        // so a follower 2 steps behind turns at the leader's start on 1.6, the tail (6 behind) on 4.8
        expect(listed(session(p(6, 10)))).toEqual([
            [
                ["T3", "1.6"],
                ["T2", "3.2"],
                ["T1", "4.8"],
            ],
        ]);
        // 8 steps up: one step a count, so every turn is on a count
        expect(listed(session(p(6, 8)))).toEqual([
            [
                ["T3", "2"],
                ["T2", "4"],
                ["T1", "6"],
            ],
        ]);
    });

    it("formats counts to a tenth and ranges from the first to the last turn", () => {
        expect(formatCount(7.46)).toBe("7.5");
        expect(formatCount(6.04)).toBe("6");
        expect(formatCount(12)).toBe("12");
    });
});

describe("the corner chips and their lists (TC-5 to TC-7)", () => {
    it("QA-TC-7: a selected trail shows a chip at each corner once pointed at (or pinned); a tap lists who turns when, and nothing is written", () => {
        let commits = 0;
        const stop = subscribeHistoryChanges(() => commits++);
        act(() => showPath(alongTarget(), "T4"));
        render(<PathEditor fieldProperties={fieldProperties} />);
        // Selected, the chips wait for the pointer on the trail (owner, 2026-11-17)
        expect(screen.queryAllByTestId("trail-corner-count")).toHaveLength(0);
        // On count everywhere: no summary on the bar either
        expect(screen.queryByTestId("path-corner-summary")).toBeNull();
        act(() => toggleCornerChips(usePathPenStore.getState().session!));
        const chips = screen.getAllByTestId("trail-corner-count");
        expect(chips.map((c) => c.textContent)).toEqual(["2–6", "8–14"]);
        expect(chips.every((c) => c.dataset.off === undefined)).toBe(true);
        act(() => {
            fireEvent.click(chips[1]!);
        });
        const list = screen.getByTestId("trail-corner-list");
        const rows = screen.getAllByTestId("trail-corner-turn");
        expect(rows.map((r) => r.textContent)).toEqual([
            "T4count 8",
            "T3count 10",
            "T2count 12",
            "T1count 14",
        ]);
        expect(list).toBeTruthy();
        // a read: no history commit (nothing on the undo stack), and the session untouched
        expect(commits).toBe(0);
        expect(usePathPenStore.getState().session!.phase).toBe("closed");
        // Space on a chip reached by keyboard is the chip's, not Play's (ShortcutDispatcher)
        expect(chips[0]!.closest("[data-shape-ui]")).toBe(chips[0]);
        stop();
    });

    it("QA-TC-8: a corner off a count warns on its chip, in its list and on the open trail's path bar", () => {
        act(() => showPath(alongTarget(12), "T4"));
        act(() => {
            const s = usePathPenStore.getState().session!;
            usePathPenStore.setState({ session: { ...s, phase: "open" } });
            // Open, a dragged-out trail's chips show when the summary pins them (L.18, TM-7)
            useCornerChipsStore.setState({ pinnedFor: pathKey(s.target) });
        });
        render(<PathEditor fieldProperties={fieldProperties} />);
        const chips = screen.getAllByTestId("trail-corner-count");
        expect(chips.map((c) => c.dataset.off)).toEqual(["true", "true"]);
        expect(screen.getByTestId("path-off-count").textContent).toBe(
            "Turns between counts",
        );
        act(() => {
            fireEvent.click(chips[1]!);
        });
        const rows = screen.getAllByTestId("trail-corner-turn");
        expect(rows.map((r) => r.dataset.onCount)).toEqual([
            "true",
            "false",
            "true",
            "false",
        ]);
        expect(rows[1]!.textContent).toBe("T37.5 · between 7 and 8");
        // a tap on the bar's warning shows its detail (a finger has no hover)
        act(() => {
            fireEvent.click(screen.getByTestId("path-off-count"));
        });
        expect(
            screen.getByTestId("path-off-count-detail").textContent,
        ).toContain("4 turns fall between counts, at 2 corners");
    });
});

describe("chips in a dense block or zoomed out (TC-5)", () => {
    it("QA-TC-13: leaves out a chip that would sit on one already placed, keeping the first along the way", () => {
        const corner = (d: number, x: number): CornerCount => ({
            d,
            at: [x, 0],
            turn: Math.PI / 2,
            dirIn: [1, 0],
            dirOut: [0, 1],
            turns: [{ q: 0, count: d, onCount: true }],
            stopBefore: 0,
            offCount: false,
        });
        // 10 px apart: the second chip, on the same side, would sit on the first
        const corners = [corner(1, 0), corner(2, 10), corner(3, 100)];
        const places = chipPlaces(corners, (x, y) => ({ x, y }));
        expect(places.map((p) => p.corner.d)).toEqual([1, 3]);
    });
});

describe("a chip never covers a point, handle, dot or label (owner, 2026-11-17)", () => {
    /** The owner's case: a corner point dragged out to the right, the legs in and out of it */
    const pulledRight = (
        x: number,
        y: number,
        offCount = true,
    ): CornerCount => ({
        d: 1,
        at: [x, y],
        turn: 1.8,
        dirIn: [0.8, 0.6],
        dirOut: [-0.8, 0.6],
        turns: [
            { q: 0, count: 4.6, onCount: false },
            { q: 1, count: 10.2, onCount: false },
        ],
        stopBefore: 0,
        offCount,
    });
    const id = (x: number, y: number) => ({ x, y });
    /** The chip's box on screen, as it hangs from its anchor */
    const boxOf = (
        place: ReturnType<typeof chipPlaces>[number],
        size: { w: number; h: number },
    ) => ({
        x: place.left + (place.sx * size.w) / 2,
        y: place.top + (place.sy * size.h) / 2,
        w: size.w,
        h: size.h,
    });
    /** How far a point is from a box (0 inside it) */
    const gap = (box: ReturnType<typeof boxOf>, x: number, y: number) =>
        Math.hypot(
            Math.max(0, Math.abs(x - box.x) - box.w / 2),
            Math.max(0, Math.abs(y - box.y) - box.h / 2),
        );

    it("QA-TC-15: outside the corner, its edge a fixed gap from the point however wide it is (a corner pulled out right: the chip right of it)", () => {
        const corner = pulledRight(500, 500);
        for (const w of [40, 80, 200]) {
            const size = { w, h: 18 };
            const [place] = chipPlaces([corner], id, [], () => size);
            expect(place!.sx).toBe(1);
            expect(place!.sy).toBeCloseTo(0, 9);
            const box = boxOf(place!, size);
            // Its near edge 18 px right of the point, whatever its width
            expect(box.x - w / 2).toBeCloseTo(518, 9);
            expect(gap(box, 500, 500)).toBeGreaterThanOrEqual(12);
        }
        // Every way a corner can point: the chip clears it
        for (let a = 0; a < 2 * Math.PI; a += Math.PI / 12) {
            const c: CornerCount = {
                ...pulledRight(500, 500),
                dirIn: [Math.cos(a), Math.sin(a)],
                dirOut: [Math.cos(a + 2), Math.sin(a + 2)],
            };
            const size = chipSize(c, false);
            const [place] = chipPlaces([c], id, [], () => size);
            expect(gap(boxOf(place!, size), 500, 500)).toBeGreaterThan(12);
        }
    });

    it("QA-TC-16: the side outside the turn taken (a point, a dot's label): the next free side; every side taken: farther out", () => {
        const corner = pulledRight(500, 500);
        const size = chipSize(corner, false);
        const point: ChipObstacle = { kind: "circle", x: 540, y: 500, r: 8 };
        const [aside] = chipPlaces([corner], id, [point], () => size);
        const box = boxOf(aside!, size);
        expect(gap(box, 540, 500)).toBeGreaterThan(8);
        expect(gap(box, 500, 500)).toBeGreaterThan(12);
        // Square to the way out of the turn: below it
        expect(aside!.sy).toBe(1);
        // A label on every side near the corner: the chip goes farther out, still clear of them
        const near: ChipObstacle[] = [
            { kind: "box", x: 530, y: 500, w: 20, h: 14 },
            { kind: "box", x: 470, y: 500, w: 20, h: 14 },
            { kind: "box", x: 500, y: 525, w: 20, h: 14 },
            { kind: "box", x: 500, y: 475, w: 20, h: 14 },
        ];
        const [far] = chipPlaces([corner], id, near, () => size);
        const farBox = boxOf(far!, size);
        for (const o of near)
            expect(
                Math.abs(farBox.x - o.x) >= (farBox.w + o.w) / 2 ||
                    Math.abs(farBox.y - o.y) >= (farBox.h + o.h) / 2,
            ).toBe(true);
    });

    it("what a chip keeps off: the open trail's points and leg handles, and the line's starts and spots", () => {
        const s = sessionOf(alongTarget());
        act(() =>
            usePathPenStore.setState({ session: { ...s, phase: "open" } }),
        );
        const view = { panX: 0, panY: 0, zoom: 1, width: 800, height: 600 };
        const obstacles = chipObstaclesOf(
            usePathPenStore.getState().session!,
            view as never,
        );
        const has = (x: number, y: number) =>
            obstacles.some(
                (o) => o.kind === "circle" && o.x === x && o.y === y,
            );
        // the corner point (6, 8) in steps, and the first leg's middle handle
        expect(has(6 * S, 8 * S)).toBe(true);
        expect(has(6 * S, 4 * S)).toBe(true);
        for (const p of [...homes, ...spots]) expect(has(p.x, p.y)).toBe(true);
    });
});

describe("a selected trail's chips wait for a hover; the bar sums them up (owner, 2026-11-17)", () => {
    it("QA-CT-4: off a count, the selected trail's bar reads Edit path · 2 corners turn between counts · ···; a click pins the chips, again unpins them", () => {
        act(() => showPath(alongTarget(12), "T4"));
        render(<PathEditor fieldProperties={fieldProperties} />);
        const bar = screen.getByTestId("path-editor");
        const summary = screen.getByTestId("path-corner-summary");
        expect(summary.textContent).toBe("2 corners turn between counts");
        // In that order on the bar, with no Reverse of its own (the leader's mark has it)
        const order = [...bar.querySelectorAll("[data-testid]")]
            .map((e) => e.getAttribute("data-testid"))
            .filter((id) =>
                [
                    "path-edit",
                    "path-corner-summary",
                    "path-more",
                    "path-reverse",
                ].includes(id!),
            );
        expect(order).toEqual([
            "path-edit",
            "path-corner-summary",
            "path-more",
        ]);
        expect(screen.queryByTestId("path-off-count")).toBeNull();
        expect(screen.getByTestId("trail-reverse")).toBeTruthy();
        expect(screen.queryAllByTestId("trail-corner-count")).toHaveLength(0);
        act(() => {
            fireEvent.click(summary);
        });
        expect(summary.getAttribute("aria-pressed")).toBe("true");
        expect(screen.getAllByTestId("trail-corner-count")).toHaveLength(2);
        act(() => {
            fireEvent.click(summary);
        });
        expect(screen.queryAllByTestId("trail-corner-count")).toHaveLength(0);
    });

    it("QA-CT-5, QA-TM-7: open (Edit path), a dragged-out trail shows only the dragged corner's chip, or all when the summary pins them; Reverse is the leader's mark's, not the bar's", () => {
        act(() => showPath(alongTarget(), "T4"));
        act(() => {
            const s = usePathPenStore.getState().session!;
            usePathPenStore.setState({ session: { ...s, phase: "open" } });
        });
        render(<PathEditor fieldProperties={fieldProperties} />);
        expect(screen.queryAllByTestId("trail-corner-count")).toHaveLength(0);
        // The first corner's point dragged: its chip only
        act(() => {
            const s = usePathPenStore.getState().session!;
            usePathPenStore.setState({ session: { ...s, dragging: 0 } });
        });
        expect(screen.getAllByTestId("trail-corner-count")).toHaveLength(1);
        act(() => {
            const s = usePathPenStore.getState().session!;
            usePathPenStore.setState({ session: { ...s, dragging: null } });
            useCornerChipsStore.setState({ pinnedFor: pathKey(s.target) });
        });
        expect(screen.getAllByTestId("trail-corner-count")).toHaveLength(2);
        expect(screen.queryByTestId("path-reverse")).toBeNull();
        expect(screen.getByTestId("trail-reverse")).toBeTruthy();
    });

    it("the pointer is on the trail within reach of its way or a corner, not beside it", () => {
        const way = [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
        ];
        expect(onTrail({ x: 50, y: 10 }, way)).toBe(true);
        expect(onTrail({ x: 110, y: 60 }, way)).toBe(true);
        expect(onTrail({ x: 50, y: 40 }, way)).toBe(false);
        // A corner reaches a little farther, for its chip beside it
        expect(onTrail({ x: 120, y: -10 }, way, [{ x: 100, y: 0 }])).toBe(true);
        expect(onTrail({ x: 150, y: -40 }, way, [{ x: 100, y: 0 }])).toBe(
            false,
        );
    });
});
