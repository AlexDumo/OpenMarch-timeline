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
} from "../followAround";
import { usePathPenStore } from "../pathPenStore";
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

    it("opens going round: N is the spots a step a count reaches over the window, clockwise, the first round from the top corner leading", () => {
        const f = followOn();
        expect(goingRound(f)).toBe(true);
        // 8 counts at one step a count over spots 4 apart: 2 spots
        expect(f.around!.amount).toBe(2);
        expect(f.around!.reversed).toBe(false);
        const plan = aroundPlanOf(f)!;
        expect(aroundLine(f, plan)).toEqual([12, 13, 14, 15, 16, 17, 18, 11]);
        open(f);
        const s = now();
        expect(s.target.trail?.around).toBe(true);
        expect(s.target.trail?.members.at(-1)?.marcherId).toBe(11);
        // the real marchers stand where they stop: two places on
        const shown = followMarchersOf(s)!;
        shown.ids.forEach((id, q) => {
            const i = IDS.indexOf(id);
            expect(shown.spots[q]!.x).toBeCloseTo(PLACES[(i + 2) % 8]!.x, 9);
            expect(shown.spots[q]!.y).toBeCloseTo(PLACES[(i + 2) % 8]!.y, 9);
        });
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

    it("how far: +, −, typed, held to 1 and to as far as Finish allows (100 times around); spots to steps keeps the distance", () => {
        open(followOn());
        stepRoundAmount(1);
        expect(now().follow!.around!.amount).toBe(3);
        stepRoundAmount(-5);
        expect(now().follow!.around!.amount).toBe(1);
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
        const f = { ...followOn(), preview: true };
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
});
