import { beforeEach, describe, expect, it } from "vitest";
import { fitOutline } from "@/db-functions/timelineTrailAround";
import type { XY } from "@/shapes/types";
import type { FollowDrag } from "../followDrag";
import { followMarchersOf } from "../followDrag";
import {
    aroundLine,
    aroundPlanOf,
    aroundTarget,
    flipRoundWay,
    goingRound,
    initialAround,
    setGoRound,
    setRoundAmount,
    roundMaxOf,
    setRoundUnit,
    stepRoundAmount,
    cancelRoundSlide,
    clearRoundTyped,
    endRoundSlide,
    eraseRoundDigit,
    roundChanged,
    roundHit,
    slideRound,
    snapRound,
    startRoundSlide,
    typeRoundDigit,
} from "../followAround";
import { usePathPenStore } from "../pathPenStore";
import { offCountTally, trailCornersOf } from "../trailCorners";
import type { PathTarget } from "../pathTarget";

/**
 * Go round in the Follow tool (pathways step 10, DO-1 to DO-8): the choices, the line round the
 * outline, the drawing's target and marchers, without a database (the write is
 * `timelineTrailAround.test.ts`'s).
 */

/** Eight on a square box outline of side 8 (corners and middles), ids 11 to 18, clockwise from the top left */
const PLACES: XY[] = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 8, y: 0 },
    { x: 8, y: 4 },
    { x: 8, y: 8 },
    { x: 4, y: 8 },
    { x: 0, y: 8 },
    { x: 0, y: 4 },
];
const IDS = [11, 12, 13, 14, 15, 16, 17, 18];
const outline = fitOutline(
    PLACES.map((p) => [p.x, p.y]),
    1,
)!;

function followOn(
    remembered: number[] | null = null,
    canDrag = true,
): FollowDrag {
    const base = {
        ids: IDS,
        starts: new Map(IDS.map((id, i) => [id, PLACES[i]!])),
        step: 1,
        window: { start: 9, end: 17 },
    };
    return {
        ...base,
        order: IDS,
        grabbed: null,
        spacing: { kind: "keep" },
        ends: "trail",
        keep: null,
        around: initialAround(base, outline, remembered, canDrag),
    };
}

const target: PathTarget = {
    timelineId: -1,
    transitionId: -1,
    marcherId: 18,
    start: 9,
    end: 17,
    from: PLACES[7]!,
    to: PLACES[7]!,
    routeId: null,
    points: [],
    ends: null,
    group: null,
    trail: {
        members: IDS.map((id, i) => ({
            marcherId: id,
            drill: `B${id}`,
            from: PLACES[i]!,
            to: PLACES[i]!,
        })),
        leaderId: 18,
        reverse: false,
    },
};

function open(follow: FollowDrag) {
    usePathPenStore.setState({
        session: {
            phase: "drawing",
            target: aroundTarget(
                target,
                follow,
                new Map(IDS.map((id) => [id, `B${id}`])),
            ),
            drill: "8",
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
const now = () => usePathPenStore.getState().session!;

describe("Go round in the Follow tool (step 10)", () => {
    beforeEach(() => usePathPenStore.setState({ session: null }));

    it("opens going round with nobody moved (owner, 2026-11-22), clockwise, the first round from the top corner leading", () => {
        const f = followOn();
        expect(goingRound(f)).toBe(true);
        expect(f.around!.amount).toBe(0);
        expect(f.around!.reversed).toBe(false);
        const plan = aroundPlanOf(f)!;
        expect(aroundLine(f, plan)).toEqual([12, 13, 14, 15, 16, 17, 18, 11]);
        open(f);
        const s = now();
        expect(s.target.trail?.around).toBe(true);
        expect(s.target.trail?.members.at(-1)?.marcherId).toBe(11);
        // the real marchers stand where they are
        const shown = followMarchersOf(s)!;
        shown.ids.forEach((id, q) => {
            const i = IDS.indexOf(id);
            expect(shown.spots[q]!.x).toBeCloseTo(PLACES[i]!.x, 9);
            expect(shown.spots[q]!.y).toBeCloseTo(PLACES[i]!.y, 9);
        });
        // nothing to write
        expect(roundChanged(now().follow!.around)).toBe(false);
    });

    it("a remembered order that runs round the other way sets the way round and the leader", () => {
        // tail first, counterclockwise from 12, so 13 leads going counterclockwise
        const remembered = [12, 11, 18, 17, 16, 15, 14, 13];
        const f = followOn(remembered);
        expect(f.around!.reversed).toBe(true);
        expect(f.around!.leader).toBe(13);
        expect(aroundLine(f, aroundPlanOf(f)!)).toEqual(remembered);
    });

    it("Reverse leader goes the other way round, the one at the back leading; again comes back", () => {
        open(followOn());
        flipRoundWay();
        const f = now().follow!;
        expect(f.around!.reversed).toBe(true);
        const line = aroundLine(f, aroundPlanOf(f)!);
        expect(line.at(-1)).toBe(12);
        expect(now().target.trail?.members.at(-1)?.marcherId).toBe(12);
        flipRoundWay();
        expect(
            aroundLine(now().follow!, aroundPlanOf(now().follow!)!).at(-1),
        ).toBe(11);
    });

    it("how far: +, −, typed, held to 0 and to as far as Finish allows (100 times around); spots to steps keeps the distance", () => {
        open(followOn());
        stepRoundAmount(3);
        expect(now().follow!.around!.amount).toBe(3);
        stepRoundAmount(-5);
        expect(now().follow!.around!.amount).toBe(0);
        // nobody moved stays nobody moved in steps
        setRoundUnit("steps");
        expect(now().follow!.around!.amount).toBe(0);
        setRoundUnit("spots");
        setRoundAmount(12);
        expect(aroundPlanOf(now().follow!)!.laps).toBe(1);
        // eight places: 101 × 8 − 1 spots is 100 times around and seven places, the most Finish takes
        expect(roundMaxOf(now().follow)).toBe(807);
        setRoundAmount(5000);
        expect(now().follow!.around!.amount).toBe(807);
        expect(aroundPlanOf(now().follow!)!.laps).toBe(100);
        setRoundAmount(12);
        setRoundUnit("steps");
        expect(now().follow!.around!.unit).toBe("steps");
        expect(now().follow!.around!.amount).toBe(48);
    });

    it("Drag out and back: only when the line can be dragged out", () => {
        open(followOn());
        setGoRound(false);
        expect(goingRound(now().follow)).toBe(false);
        expect(now().target.trail?.around).toBeUndefined();
        setGoRound(true);
        expect(goingRound(now().follow)).toBe(true);
        open(followOn(null, false));
        setGoRound(false);
        expect(goingRound(now().follow)).toBe(true);
    });

    it("▶ Preview walks them round at the plan's own pace", () => {
        const base = followOn();
        const f = {
            ...base,
            around: { ...base.around!, amount: 2 },
            preview: true,
        };
        open(f);
        const shown = followMarchersOf(now())!;
        const half = shown.walk!(0.5);
        // half way, each is one place on
        shown.ids.forEach((id, q) => {
            const i = IDS.indexOf(id);
            expect(half[q]!.x).toBeCloseTo(PLACES[(i + 1) % 8]!.x, 9);
            expect(half[q]!.y).toBeCloseTo(PLACES[(i + 1) % 8]!.y, 9);
        });
    });

    /** The point `d` round the square clockwise from the top left (side 8, length 32) */
    const round = (d: number): XY => {
        const x = ((d % 32) + 32) % 32;
        if (x <= 8) return { x, y: 0 };
        if (x <= 16) return { x: 8, y: x - 8 };
        if (x <= 24) return { x: 24 - x, y: 8 };
        return { x: 0, y: 32 - x };
    };
    /** Drags the pointer from `from` to `to` round the square in small moves, as a hand does */
    const dragRound = (from: number, to: number) => {
        const n = Math.max(1, Math.ceil(Math.abs(to - from)));
        for (let k = 1; k <= n; k++)
            slideRound(round(from + ((to - from) * k) / n));
    };
    const stops = () => {
        const shown = followMarchersOf(now())!;
        return new Map(shown.ids.map((id, q) => [id, shown.spots[q]!]));
    };

    it("drag the leader round: the whole line slides, snapped to whole spots, live; let go writes, Escape puts it back", () => {
        open(followOn());
        // the leader, 11, stands at the top left (0 round); the press is on it
        expect(roundHit(now().follow!, { x: 0.2, y: 0 }, 0.5)).toBe(7);
        expect(startRoundSlide({ x: 0.2, y: 0 }, 0.5)).toBe(true);
        // 9.5 round is nearest the place at 8 (two places on): two spots, snapped
        dragRound(0.2, 9.5);
        expect(now().follow!.around!.amount).toBe(2);
        expect(now().follow!.around!.reversed).toBe(false);
        const at = stops();
        IDS.forEach((id, i) => {
            expect(at.get(id)!.x).toBeCloseTo(PLACES[(i + 2) % 8]!.x, 9);
            expect(at.get(id)!.y).toBeCloseTo(PLACES[(i + 2) % 8]!.y, 9);
        });
        // on round, past once around: 32 + 4 is nine places on
        dragRound(9.5, 36.4);
        expect(now().follow!.around!.amount).toBe(9);
        expect(aroundPlanOf(now().follow!)!.laps).toBe(1);
        // Escape: back as it was, nobody moved
        expect(cancelRoundSlide()).toBe(true);
        expect(now().follow!.around!.amount).toBe(0);
        expect(now().follow!.roundSlide).toBeNull();
        // again, and let go: written (the caller writes when it's true)
        startRoundSlide({ x: 0, y: 0 }, 0.5);
        dragRound(0, 4.2);
        expect(now().follow!.around!.amount).toBe(1);
        expect(endRoundSlide()).toBe(true);
        expect(now().follow!.roundSlide).toBeNull();
        expect(roundChanged(now().follow!.around)).toBe(true);
    });

    it("dragged back past where it started, the line goes the other way round, the one at the back leading", () => {
        open(followOn());
        // pressed on 13, the top right corner (8 round)
        expect(startRoundSlide({ x: 8, y: 0.1 }, 0.5)).toBe(true);
        dragRound(8, -0.3);
        const a = now().follow!.around!;
        expect(a.reversed).toBe(true);
        expect(a.amount).toBe(2);
        expect(a.leader).toBe(12);
        const at = stops();
        IDS.forEach((id, i) => {
            expect(at.get(id)!.x).toBeCloseTo(PLACES[(i + 6) % 8]!.x, 9);
            expect(at.get(id)!.y).toBeCloseTo(PLACES[(i + 6) % 8]!.y, 9);
        });
        // and forward again past the start: clockwise, 11 leading
        dragRound(-0.3, 12.2);
        expect(now().follow!.around!.reversed).toBe(false);
        expect(now().follow!.around!.amount).toBe(1);
    });

    it("let go where it started: nothing to write, the choices as they were", () => {
        open(followOn());
        startRoundSlide({ x: 0, y: 0 }, 0.5);
        dragRound(0, 5);
        dragRound(5, 0.4);
        expect(endRoundSlide()).toBe(false);
        expect(now().follow!.around!.amount).toBe(0);
        // a press away from the line and the outline grabs nothing
        expect(startRoundSlide({ x: 4, y: 4 }, 0.5)).toBe(false);
    });

    it("the outline itself grabs the line, the leader's stop counting", () => {
        open(followOn());
        // halfway along the left side, between 18 (0, 4) and 11: on the outline, 2 from 18
        expect(roundHit(now().follow!, { x: 0, y: 2 }, 0.5)).toBe(7);
    });

    it("by steps: whole steps", () => {
        open(followOn());
        setRoundUnit("steps");
        startRoundSlide({ x: 0, y: 0 }, 0.5);
        dragRound(0, 6.6);
        expect(now().follow!.around!.unit).toBe("steps");
        expect(now().follow!.around!.amount).toBe(7);
    });

    it("snapRound counts uneven spacing and gaps by the outline's places", () => {
        // places at 0, 1, 2 and a gap of two missing places before 5 (L = 6): ring 0 1 2 3 4 5
        const plan = {
            ring: [0, 1, 2, 3, 4, 5],
            memberSpot: [0, 1, 2, 5],
            loop: { L: 6 },
        } as unknown as Parameters<typeof snapRound>[0];
        expect(snapRound(plan, "spots", 1, 2, 1.4, 100)).toBe(1);
        expect(snapRound(plan, "spots", 1, 2, 6.2, 100)).toBe(6);
        expect(snapRound(plan, "spots", 1, 2, -2.6, 100)).toBe(-3);
        expect(snapRound(plan, "spots", 1, 2, 1000, 10)).toBe(10);
    });

    it("typed digits set how far exactly, live; Backspace and Escape take them back", () => {
        open(followOn());
        expect(typeRoundDigit("1")).toBe(true);
        expect(typeRoundDigit("2")).toBe(true);
        expect(now().follow!.around!.amount).toBe(12);
        expect(now().follow!.roundTyped?.text).toBe("12");
        expect(eraseRoundDigit()).toBe(true);
        expect(now().follow!.around!.amount).toBe(1);
        expect(eraseRoundDigit()).toBe(true);
        // every digit gone: back to before them
        expect(now().follow!.around!.amount).toBe(0);
        expect(now().follow!.roundTyped).toBeNull();
        expect(eraseRoundDigit()).toBe(false);
        typeRoundDigit("5");
        expect(clearRoundTyped()).toBe(true);
        expect(now().follow!.around!.amount).toBe(0);
        // held to as far as Finish allows
        for (const d of "99999") typeRoundDigit(d);
        expect(now().follow!.around!.amount).toBe(807);
    });

    it("digits typed while the line is held wait for Enter: let go writes nothing", () => {
        open(followOn());
        startRoundSlide({ x: 0, y: 0 }, 0.5);
        dragRound(0, 4);
        typeRoundDigit("3");
        expect(now().follow!.around!.amount).toBe(3);
        expect(endRoundSlide()).toBe(false);
        expect(now().follow!.around!.amount).toBe(3);
        expect(roundChanged(now().follow!.around)).toBe(true);
    });

    it("digits typed while held hold however the pointer drifts (review)", () => {
        open(followOn());
        startRoundSlide({ x: 0, y: 0 }, 0.5);
        dragRound(0, 4);
        typeRoundDigit("3");
        dragRound(4, 9);
        expect(now().follow!.around!.amount).toBe(3);
        expect(endRoundSlide()).toBe(false);
        expect(now().follow!.around!.amount).toBe(3);
    });

    it("Drag out drops digits typed, so Backspace and Escape are the drawing's again (review)", () => {
        open(followOn());
        typeRoundDigit("4");
        setGoRound(false);
        expect(goingRound(now().follow)).toBe(false);
        expect(now().follow!.roundTyped).toBeNull();
        expect(eraseRoundDigit()).toBe(false);
        expect(clearRoundTyped()).toBe(false);
        // and − or + on the bar ends digits typed too
        setGoRound(true);
        typeRoundDigit("2");
        stepRoundAmount(1);
        expect(now().follow!.roundTyped).toBeNull();
        expect(now().follow!.around!.amount).toBe(3);
    });

    it("going round again: Finish with what's stored writes nothing", () => {
        const base = followOn();
        const a = {
            ...base.around!,
            amount: 3,
            again: true,
            stored: { amount: 3, unit: "spots" as const, reversed: false },
        };
        expect(roundChanged(a)).toBe(false);
        expect(roundChanged({ ...a, amount: 4 })).toBe(true);
        expect(roundChanged({ ...a, reversed: true })).toBe(true);
    });

    it("corner counts going round (owner, 2026-11-22): a box outline's corners only, live", () => {
        open(followOn());
        // nobody moved: nobody turns
        expect(trailCornersOf(now())?.corners).toEqual([]);
        // two places on in 8 counts: each middle marcher turns at the corner ahead on count 4
        setRoundAmount(2);
        const view = trailCornersOf(now())!;
        expect(view.corners.map((c) => c.at)).toEqual([
            [0, 0],
            [8, 0],
            [8, 8],
            [0, 8],
        ]);
        for (const c of view.corners) {
            expect(c.turns.map((t) => t.count)).toEqual([4]);
            expect(c.offCount).toBe(false);
        }
        // three places on: off the counts, so the bar warns
        setRoundAmount(3);
        expect(offCountTally(trailCornersOf(now())).turns).toBeGreaterThan(0);
    });

    it("corner counts going round a circle (owner, 2026-11-22): none at all, however far", () => {
        const n = 15;
        const places: XY[] = Array.from({ length: n }, (_, i) => {
            const a = (2 * Math.PI * i) / n;
            return { x: 7.6 * Math.cos(a), y: 7.6 * Math.sin(a) };
        });
        const ids = places.map((_, i) => 100 + i);
        const circle = fitOutline(
            places.map((p) => [p.x, p.y]),
            1,
        )!;
        expect(circle.kind).toBe("circle");
        const base = {
            ids,
            starts: new Map(ids.map((id, i) => [id, places[i]!])),
            step: 1,
            window: { start: 0, end: 8 },
        };
        const f: FollowDrag = {
            ...base,
            order: ids,
            grabbed: null,
            spacing: { kind: "keep" },
            ends: "trail",
            keep: null,
            around: initialAround(base, circle, null, true),
        };
        usePathPenStore.setState({
            session: {
                phase: "drawing",
                target: aroundTarget(
                    { ...target, trail: { ...target.trail!, members: [] } },
                    f,
                    new Map(ids.map((id) => [id, `G${id}`])),
                ),
                drill: "15",
                points: [],
                pointer: null,
                selected: null,
                dragging: null,
                object: false,
                byRoute: false,
                follow: f,
            },
        });
        for (const amount of [1, 4, 7, 15, 31]) {
            setRoundAmount(amount);
            expect(trailCornersOf(now())?.corners, `${amount}`).toEqual([]);
        }
    });
});
