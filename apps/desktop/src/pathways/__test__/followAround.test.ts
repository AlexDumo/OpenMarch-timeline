import { beforeEach, describe, expect, it } from "vitest";
import { fitOutline } from "@/db-functions/timelineTrailAround";
import type { XY } from "@/shapes/types";
import type { FollowDrag } from "../followDrag";
import {
    cancelFollowDrawing,
    followDrawnPlanOf,
    followMarchersOf,
    trailLine,
} from "../followDrag";
import {
    aroundLine,
    aroundPlanOf,
    aroundTarget,
    carryRoundSlide,
    flipRoundWay,
    goingRound,
    guessAround,
    loopAround,
    outlineStretch,
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
import {
    addPoint,
    finishDrawing,
    setDrawingSmooth,
    setPointer,
    usePathPenStore,
} from "../pathPenStore";
import { offCountTally, trailCornersOf } from "../trailCorners";
import type { PathTarget } from "../pathTarget";

/**
 * The Follow tool on a closed outline (pathways step 10, owner 2026-11-22): one gesture. Any
 * marcher grabbed leads; dragged along the outline the line slides round it, dragged off it the
 * leader is pulled out into a trail. A set march order sets who leads and the way round, and with
 * none set their places round the outline do. The choices, the line round the outline, the
 * drawing's target and marchers, without a database (the writes are `timelineTrailAround.test.ts`'s
 * and `timelineTrailDrag.test.ts`'s).
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

/** The march order clockwise round the box, tail first: 12 at the back, 11 leading */
const CLOCKWISE = [12, 13, 14, 15, 16, 17, 18, 11];

const BASE = {
    ids: IDS,
    starts: new Map(IDS.map((id, i) => [id, PLACES[i]!])),
    step: 1,
    window: { start: 9, end: 17 },
};

/** The Follow tool opened with the march order `order` (tail first) */
function followOn(order: readonly number[] = CLOCKWISE): FollowDrag {
    const around = loopAround(BASE, outline, order);
    expect(around).not.toBeNull();
    return {
        ...BASE,
        order: [...order],
        grabbed: null,
        spacing: { kind: "keep" },
        ends: "trail",
        keep: null,
        around,
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

describe("Follow round a closed outline in the march order (step 10)", () => {
    beforeEach(() => usePathPenStore.setState({ session: null }));

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

    it("an order running round the outline closes the loop, nobody moved (owner, 2026-11-22), its leader leading", () => {
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

    it("a set order that runs round the other way sets the way round and the leader", () => {
        // tail first, counterclockwise from 12, so 13 leads going counterclockwise
        const order = [12, 11, 18, 17, 16, 15, 14, 13];
        const f = followOn(order);
        expect(f.around!.reversed).toBe(true);
        expect(f.around!.leader).toBe(13);
        expect(aroundLine(f, aroundPlanOf(f)!)).toEqual(order);
    });

    it("BUG (owner, 2026-11-22): a set order that isn't clockwise is the one walked, each marcher onto the spot of the one ahead of them in it", () => {
        // counterclockwise, 16 leading: not clockwise, and not the member with most room ahead
        const order = [15, 14, 13, 12, 11, 18, 17, 16];
        open(followOn(order));
        const f = now().follow!;
        expect(f.around!.reversed).toBe(true);
        expect(f.around!.leader).toBe(16);
        expect(now().target.trail?.members.map((m) => m.marcherId)).toEqual(
            order,
        );
        setRoundAmount(1);
        const at = stops();
        order.forEach((id, q) => {
            // the leader walks on towards the tail's spot: the loop closes
            const ahead = order[(q + 1) % order.length]!;
            const spot = PLACES[IDS.indexOf(ahead)]!;
            expect(at.get(id)!.x, `${id}`).toBeCloseTo(spot.x, 9);
            expect(at.get(id)!.y, `${id}`).toBeCloseTo(spot.y, 9);
        });
    });

    it("a set order that doesn't run round the outline makes no loop: never a guessed way round instead", () => {
        // every other marcher, then the rest: neighbors in the order aren't neighbors on the box
        expect(
            loopAround(BASE, outline, [11, 13, 15, 17, 12, 14, 16, 18]),
        ).toBeNull();
        // round the box but not every member: no loop either
        expect(loopAround(BASE, outline, CLOCKWISE.slice(1))).toBeNull();
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

    it("dragged back past where it started, the line goes the other way round, the one grabbed leading", () => {
        open(followOn());
        // pressed on 13, the top right corner (8 round)
        expect(startRoundSlide({ x: 8, y: 0.1 }, 0.5)).toBe(true);
        dragRound(8, -0.3);
        const a = now().follow!.around!;
        expect(a.reversed).toBe(true);
        expect(a.amount).toBe(2);
        expect(a.leader).toBe(13);
        const at = stops();
        IDS.forEach((id, i) => {
            expect(at.get(id)!.x).toBeCloseTo(PLACES[(i + 6) % 8]!.x, 9);
            expect(at.get(id)!.y).toBeCloseTo(PLACES[(i + 6) % 8]!.y, 9);
        });
        // and forward again past the start: clockwise, 13 still leading
        dragRound(-0.3, 12.2);
        expect(now().follow!.around!.reversed).toBe(false);
        expect(now().follow!.around!.amount).toBe(1);
        expect(now().follow!.around!.leader).toBe(13);
    });

    it("the outline grabbed (no marcher) and dragged back: the other way round, the one at the back leading", () => {
        open(followOn());
        // halfway between 11 (0 round) and 12 (4 round), on the outline
        expect(startRoundSlide({ x: 2, y: 0 }, 0.5)).toBe(true);
        expect(now().follow!.roundSlide!.lead).toBeNull();
        dragRound(2, -2.2);
        const a = now().follow!.around!;
        expect(a.reversed).toBe(true);
        expect(a.amount).toBe(1);
        expect(a.leader).toBe(12);
    });

    it("a marcher pressed and let go leads from here on, nothing written", () => {
        open(followOn());
        expect(startRoundSlide({ x: 8, y: 8 }, 0.5)).toBe(true);
        expect(endRoundSlide()).toBe(false);
        const f = now().follow!;
        expect(f.around!.leader).toBe(15);
        expect(f.around!.amount).toBe(0);
        expect(aroundLine(f, aroundPlanOf(f)!).at(-1)).toBe(15);
        expect(now().target.trail?.leaderId).toBe(15);
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

    it("− or + on the bar ends digits typed (review)", () => {
        open(followOn());
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
            stored: {
                amount: 3,
                unit: "spots" as const,
                reversed: false,
                leader: base.around!.leader,
            },
        };
        expect(roundChanged(a)).toBe(false);
        expect(roundChanged({ ...a, amount: 4 })).toBe(true);
        expect(roundChanged({ ...a, reversed: true })).toBe(true);
        expect(roundChanged({ ...a, leader: 14 })).toBe(true);
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
            // the march order round the circle, as placed
            around: loopAround(base, circle, ids),
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

/**
 * One Follow tool, one gesture (owner, 2026-11-22: "I wanted the spread-out tool and wrap-around
 * tool to be effectively the same thing. I should be able to drag it around the circle or drag it
 * out of the circle. Also it should guess in order first or at least in a circle. It should let me
 * pretty much pick any marker I want.")
 */
describe("Follow on a circle: grab any marcher, drag it around or out (owner, 2026-11-22)", () => {
    /** Twelve round a circle of radius 6 about (20, 20), ids 1 to 12, clockwise on the field from its top */
    const N = 12;
    const R = 6;
    const C = { x: 20, y: 20 };
    const angle = (k: number) => -Math.PI / 2 + (2 * Math.PI * k) / N;
    const onCircle = (a: number, r = R): XY => ({
        x: C.x + r * Math.cos(a),
        y: C.y + r * Math.sin(a),
    });
    const places = Array.from({ length: N }, (_, k) => onCircle(angle(k)));
    const ids = places.map((_, k) => k + 1);
    const circle = fitOutline(
        places.map((p) => [p.x, p.y]),
        1,
    )!;
    const base = {
        ids,
        starts: new Map(ids.map((id, k) => [id, places[k]!])),
        step: 1,
        window: { start: 0, end: 8 },
    };
    /** How far off the circle the pointer may stray before the leader is pulled out */
    const BAND = 1.5;
    /** The place `n` on from marcher `id`'s, clockwise */
    const placeFrom = (id: number, n: number) =>
        places[(((id - 1 + n) % N) + N) % N]!;

    /** The Follow tool opened on the circle: in the set order `order` (tail first), or with none set */
    function openOn(order: readonly number[] | null = null) {
        const around = order
            ? loopAround(base, circle, order)!
            : guessAround(base, circle);
        const f: FollowDrag = {
            ...base,
            order: [],
            grabbed: null,
            spacing: { kind: "keep" },
            ends: "trail",
            keep: null,
            around,
        };
        const line = aroundLine(f, aroundPlanOf(f)!);
        const follow = { ...f, order: line };
        usePathPenStore.setState({
            session: {
                phase: "drawing",
                target: aroundTarget(
                    { ...target, trail: { ...target.trail!, members: [] } },
                    follow,
                    new Map(ids.map((id) => [id, `T${id}`])),
                ),
                drill: `${N}`,
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
    /** Presses marcher `id` where it stands */
    const press = (id: number) => startRoundSlide(placeFrom(id, 0), 0.5, BAND);
    /** Drags the pointer along the circle from marcher `id`'s place by `spots` places (clockwise positive), in small moves */
    const dragAlong = (id: number, from: number, to: number) => {
        const n = Math.max(1, Math.ceil(Math.abs(to - from) * 4));
        let where: ReturnType<typeof slideRound> = null;
        for (let k = 1; k <= n; k++)
            where = slideRound(
                onCircle(angle(id - 1 + from + ((to - from) * k) / n)),
            );
        return where;
    };
    const stops = () => {
        const shown = followMarchersOf(now())!;
        return new Map(shown.ids.map((id, q) => [id, shown.spots[q]!]));
    };
    const near = (a: XY, b: XY, digits = 6) => {
        expect(a.x).toBeCloseTo(b.x, digits);
        expect(a.y).toBeCloseTo(b.y, digits);
    };

    beforeEach(() => usePathPenStore.setState({ session: null }));

    it("fits a circle, and with no order set opens anyway: nobody moved, their places round it the order", () => {
        expect(circle.kind).toBe("circle");
        openOn();
        const f = now().follow!;
        expect(goingRound(f)).toBe(true);
        expect(f.around!.amount).toBe(0);
        // the ring in its places: each one's neighbor round the circle next in the line
        const line = aroundLine(f, aroundPlanOf(f)!);
        line.forEach((id, q) => {
            const next = line[(q + 1) % N]!;
            expect((next - id + N) % N).toBe(1);
        });
        for (const id of ids) near(stops().get(id)!, placeFrom(id, 0));
    });

    it("no order: grab any marcher and drag it counterclockwise, and they walk counterclockwise behind it", () => {
        openOn();
        expect(press(5)).toBe(true);
        expect(dragAlong(5, 0, -3)).toBe("round");
        const a = now().follow!.around!;
        expect(a.leader).toBe(5);
        expect(a.reversed).toBe(true);
        expect(a.amount).toBe(3);
        // everyone three places on counterclockwise, onto the spots of the ones ahead
        for (const id of ids) near(stops().get(id)!, placeFrom(id, -3));
        // the one grabbed leads: last in the line, the one clockwise of it right behind
        const line = aroundLine(now().follow!, aroundPlanOf(now().follow!)!);
        expect(line.at(-1)).toBe(5);
        expect(line.at(-2)).toBe(6);
        // let go: written as shown
        expect(endRoundSlide()).toBe(true);
        expect(roundChanged(now().follow!.around)).toBe(true);
    });

    it("no order: the same marcher dragged clockwise, and they walk clockwise behind it", () => {
        openOn();
        expect(press(5)).toBe(true);
        expect(dragAlong(5, 0, 2)).toBe("round");
        const a = now().follow!.around!;
        expect(a.leader).toBe(5);
        expect(a.reversed).toBe(false);
        expect(a.amount).toBe(2);
        for (const id of ids) near(stops().get(id)!, placeFrom(id, 2));
        const line = aroundLine(now().follow!, aroundPlanOf(now().follow!)!);
        expect(line.at(-1)).toBe(5);
        expect(line.at(-2)).toBe(4);
        expect(endRoundSlide()).toBe(true);
    });

    it("a set order wins: it opens the order's way round with its leader, and a typed count walks that way", () => {
        // set counterclockwise, 9 leading: tail first, each one's follower before them
        const order = [8, 7, 6, 5, 4, 3, 2, 1, 12, 11, 10, 9];
        openOn(order);
        const a = now().follow!.around!;
        expect(a.leader).toBe(9);
        expect(a.reversed).toBe(true);
        expect(aroundLine(now().follow!, aroundPlanOf(now().follow!)!)).toEqual(
            order,
        );
        expect(typeRoundDigit("2")).toBe(true);
        for (const id of ids) near(stops().get(id)!, placeFrom(id, -2));
        // 9 walks on towards the tail's spot (8's): counterclockwise
        expect(now().target.trail?.leaderId).toBe(9);
    });

    it("dragging off the circle spreads them into a trail: the one grabbed leads it, the rest follow round and out", () => {
        openOn();
        expect(press(4)).toBe(true);
        // straight out from the circle, leaning clockwise (4 stands at the right, clockwise is down)
        const out = onCircle(angle(3) + 0.25, R + 8);
        expect(slideRound(onCircle(angle(3) + 0.02, R + 0.6))).toBe("round");
        expect(slideRound(out)).toBe("out");
        const f = now().follow!;
        expect(goingRound(f)).toBe(false);
        expect(f.grabbed).toBe(4);
        // the ring from the one behind the leader: 4 leads, 3 right behind, 5 the tail
        expect(trailLine(f)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4]);
        expect(now().points).toEqual([]);
        expect(now().target.trail?.around).toBeUndefined();
        expect(now().target.trail?.leaderId).toBe(4);
        // the trail's first leg to the pointer: the leader on it, the rest that far along the ring
        setPointer(out);
        const plan = followDrawnPlanOf(now())!;
        const leg = Math.hypot(
            out.x - placeFrom(4, 0).x,
            out.y - placeFrom(4, 0).y,
        );
        expect(plan.drawn).toBeCloseTo(leg, 6);
        const at = stops();
        near(at.get(4)!, out);
        // everyone walked forward as far as the leader, nobody stands where they started
        for (const id of ids) {
            const p = at.get(id)!;
            const from = placeFrom(id, 0);
            expect(Math.hypot(p.x - from.x, p.y - from.y)).toBeGreaterThan(1);
        }
        // the one right behind the leader has left the circle too, the tail hasn't
        const off = (p: XY) => Math.abs(Math.hypot(p.x - C.x, p.y - C.y) - R);
        expect(off(at.get(3)!)).toBeGreaterThan(1);
        expect(off(at.get(5)!)).toBeLessThan(0.5);
        // let go: nothing written yet (the caller places the first point, the drawing goes on)
        expect(endRoundSlide()).toBe(false);
        expect(now().follow!.grabbed).toBe(4);
        expect(now().follow!.roundSlide).toBeNull();
        addPoint(out);
        expect(now().points).toHaveLength(1);
    });

    it("pulled straight out leaning the other way, the line follows the other way round", () => {
        openOn();
        press(4);
        expect(slideRound(onCircle(angle(3) - 0.25, R + 8))).toBe("out");
        // counterclockwise of 4 is up: 5 right behind the leader, 3 the tail
        expect(trailLine(now().follow!)).toEqual([
            3, 2, 1, 12, 11, 10, 9, 8, 7, 6, 5, 4,
        ]);
        // and leaning back the first way while still out: turned again, live
        expect(slideRound(onCircle(angle(3) + 0.3, R + 8))).toBe("out");
        expect(trailLine(now().follow!).at(-2)).toBe(3);
    });

    it("around, then out: the trail runs round the circle as far as the line had slid, then off it", () => {
        openOn();
        press(1);
        expect(dragAlong(1, 0, 3)).toBe("round");
        expect(now().follow!.around!.amount).toBe(3);
        // off the circle from three places on
        const out = onCircle(angle(3), R + 5);
        expect(slideRound(out)).toBe("out");
        const f = now().follow!;
        expect(f.grabbed).toBe(1);
        expect(trailLine(f).at(-1)).toBe(1);
        expect(trailLine(f).at(-2)).toBe(12);
        // the stretch walked is the trail's first points: a quarter of the circle, an arc
        const points = now().points;
        expect(points.length).toBeGreaterThanOrEqual(1);
        near(points.at(-1)!.at, placeFrom(1, 3));
        expect(points.every((p) => !!p.bulge)).toBe(true);
        // so the line goes on from where the slide showed it: with nothing more drawn, the
        // leader three places on, the rest within a tenth of a step of it (they walk the
        // line-up's straight legs between places, a hair shorter than the circle's arcs)
        const slid = followMarchersOf(now())!;
        near(slid.spots.at(-1)!, placeFrom(1, 3), 6);
        slid.ids.forEach((id, q) => {
            const to = placeFrom(id, 3);
            const p = slid.spots[q]!;
            expect(Math.hypot(p.x - to.x, p.y - to.y), `${id}`).toBeLessThan(
                0.12,
            );
        });
        // and with the leg to the pointer, the leader out there, everyone 5 further
        setPointer(out);
        const plan = followDrawnPlanOf(now())!;
        expect(plan.drawn).toBeCloseTo((2 * Math.PI * R * 3) / N + 5, 3);
        near(stops().get(1)!, out);
    });

    it("back on the circle it slides again, the trail gone; Escape while out puts everything back", () => {
        openOn();
        press(1);
        dragAlong(1, 0, 2);
        expect(slideRound(onCircle(angle(2), R + 5))).toBe("out");
        expect(now().points.length).toBeGreaterThan(0);
        // not yet: still more than half the band off
        expect(slideRound(onCircle(angle(2), R + 1))).toBe("out");
        expect(slideRound(onCircle(angle(2), R + 0.5))).toBe("round");
        let f = now().follow!;
        expect(f.grabbed).toBeNull();
        expect(goingRound(f)).toBe(true);
        expect(now().points).toEqual([]);
        expect(f.around!.amount).toBe(2);
        expect(now().target.trail?.around).toBe(true);
        // out again, and Escape: the line as it was when pressed, nobody moved
        expect(slideRound(onCircle(angle(2), R + 5))).toBe("out");
        expect(cancelFollowDrawing()).toBe(true);
        f = now().follow!;
        expect(f.grabbed).toBeNull();
        expect(f.roundSlide).toBeNull();
        expect(f.peel).toBeNull();
        expect(f.around!.amount).toBe(0);
        expect(now().points).toEqual([]);
        expect(goingRound(f)).toBe(true);
        for (const id of ids) near(stops().get(id)!, placeFrom(id, 0));
    });

    it("the outline itself pressed can't be pulled out: there's nobody to lead a trail", () => {
        openOn();
        // between two marchers, on the circle
        expect(startRoundSlide(onCircle(angle(0.5)), 0.3, BAND)).toBe(true);
        expect(now().follow!.roundSlide!.lead).toBeNull();
        expect(slideRound(onCircle(angle(0.5), R + 6))).toBe("round");
        expect(now().follow!.grabbed).toBeNull();
    });

    it("click, let go, then move (owner, 2026-11-23): a click carries the line with no button held; the next click keeps it, Escape puts it back", () => {
        openOn();
        // a click on 5: pressed and let go where it stands
        expect(press(5)).toBe(true);
        expect(carryRoundSlide()).toBe(true);
        let f = now().follow!;
        expect(f.roundSlide?.loose).toBe(true);
        expect(f.around!.amount).toBe(0);
        // the pointer moves with no button held: the line slides with it, live
        expect(dragAlong(5, 0, -2)).toBe("round");
        f = now().follow!;
        expect(f.around!.leader).toBe(5);
        expect(f.around!.reversed).toBe(true);
        expect(f.around!.amount).toBe(2);
        for (const id of ids) near(stops().get(id)!, placeFrom(id, -2));
        // the next click ends it as letting go of a drag does: written
        expect(endRoundSlide()).toBe(true);
        expect(now().follow!.roundSlide).toBeNull();
        // carried again, and Escape: back as it was, nothing held
        press(5);
        carryRoundSlide();
        dragAlong(5, 0, 3);
        expect(cancelRoundSlide()).toBe(true);
        expect(now().follow!.roundSlide).toBeNull();
        expect(now().follow!.around!.amount).toBe(2);
        // nothing held: nothing to carry
        expect(carryRoundSlide()).toBe(false);
    });

    it("carried out of the circle with no button held: the trail follows the pointer, and Enter ends it there", async () => {
        openOn();
        press(4);
        carryRoundSlide();
        const out = onCircle(angle(3) + 0.25, R + 8);
        expect(slideRound(out)).toBe("out");
        expect(now().follow!.grabbed).toBe(4);
        expect(now().follow!.roundSlide?.loose).toBe(true);
        setPointer(out);
        near(stops().get(4)!, out);
        // Enter: the carry ends where the pointer is, the trail's point placed there (the write
        // itself needs a show, and is refused here: the drawing is what's checked)
        const done = finishDrawing().catch(() => undefined);
        const placed = usePathPenStore.getState().session;
        expect(placed?.follow?.roundSlide ?? null).toBeNull();
        expect(placed?.points.at(-1)?.at).toEqual(out);
        await done;
    });

    it("Straight | Curved while a trail is drawn (owner, 2026-11-23): clicks place corners or smooth points, the outline's arcs kept", () => {
        openOn();
        press(1);
        dragAlong(1, 0, 3);
        const out = onCircle(angle(3), R + 5);
        expect(slideRound(out)).toBe("out");
        endRoundSlide();
        const carried = now().points.length;
        expect(carried).toBeGreaterThan(0);
        // Straight is the default: a click places a corner
        addPoint(out);
        expect(now().points.at(-1)!.tension).toBeUndefined();
        // Curved: the points placed turn smooth, but not the stretch of outline (arcs' ends
        // stay corners), and the next click places a smooth point
        setDrawingSmooth(true);
        expect(now().smooth).toBe(true);
        now()
            .points.slice(0, carried)
            .forEach((p) => {
                expect(p.bulge).toBeTruthy();
                expect(p.tension).toBeUndefined();
            });
        expect(now().points[carried]!.tension).toBeGreaterThan(0);
        const next = { x: out.x + 4, y: out.y + 3 };
        addPoint(next);
        expect(now().points.at(-1)!.tension).toBeGreaterThan(0);
        // and the line's plan follows the curve: it still ends at the last point
        const plan = followDrawnPlanOf(now())!;
        near({ x: plan.spots.at(-1)![0], y: plan.spots.at(-1)![1] }, next, 6);
        // Straight again: corners, the arcs untouched
        setDrawingSmooth(false);
        expect(now().smooth).toBe(false);
        expect(now().points.every((p) => !p.tension)).toBe(true);
        expect(
            now()
                .points.slice(0, carried)
                .every((p) => !!p.bulge),
        ).toBe(true);
    });

    it("outlineStretch: a box's corners passed are points, a circle's arcs keep their bulge", () => {
        // the square of the first tests, clockwise from its top left: 3 on from 6 round passes one corner
        const box = outlineStretch(outline.loop, 6, 5);
        expect(box.map((p) => [p.at.x, p.at.y])).toEqual([
            [8, 0],
            [8, 3],
        ]);
        expect(box.every((p) => !p.bulge)).toBe(true);
        // a third of the circle from its top: a whole quarter and part of the next, both arcs,
        // ending a third of the way round
        const L = circle.loop.L;
        const arc = outlineStretch(circle.loop, 0, L / 3);
        expect(arc).toHaveLength(2);
        near(arc[0]!.at, onCircle(0), 6);
        near(arc[1]!.at, onCircle(-Math.PI / 2 + (2 * Math.PI) / 3), 6);
        expect(Math.abs(arc[0]!.bulge!)).toBeCloseTo(
            Math.tan(Math.PI / 8) / 2,
            9,
        );
        // 30° of arc: tan(30° / 4) / 2
        expect(Math.abs(arc[1]!.bulge!)).toBeCloseTo(
            Math.tan(Math.PI / 24) / 2,
            9,
        );
        expect(Math.sign(arc[1]!.bulge!)).toBe(Math.sign(arc[0]!.bulge!));
    });
});
