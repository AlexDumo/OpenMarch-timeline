import { describe, expect, it } from "vitest";
import { blockKind } from "../kinds/block";
import { drawBox, filesOf } from "../box/boxGeometry";
import {
    liveFiles,
    liveNudge,
    liveTargets,
    moveLive,
    openLive,
    pressLive,
    releaseLive,
} from "../placed/liveBox";
import { withoutMembers, type PlacedBox } from "../placed/placedBox";
import type { ToolEnv } from "../tool/toolKind";
import type { ShapeContext } from "../types";

const STEP = 10;
const half = STEP / 2;
const snapHalf = (v: number) => Math.round(v / half) * half;
const env: ToolEnv = {
    stepPx: STEP,
    snap: true,
    shift: false,
    gridSnap: (p) => ({ x: snapHalf(p.x), y: snapHalf(p.y) }),
    hitRadius: 3,
};
const ctx: ShapeContext = { stepPx: STEP, snapPoint: (p) => p };

/** A placed 2 × 2 box, 20 apart, from (0,0) to (20,20); marchers 1..4 */
function placed(): PlacedBox {
    const params = drawBox({ x: 0, y: 0 }, { x: 20, y: 20 }, 4, env)!;
    const slots = blockKind.generate(params, 4, ctx);
    return {
        recipe: {
            id: 7,
            timelineId: 3,
            kind: "block",
            kindVersion: 1,
            params: { ...params, spots: 4 },
            orderMode: "nearest",
            reverse: false,
            members: slots.map((s, i) => ({
                marcherId: i + 1,
                slot: i,
                x: s.x,
                y: s.y,
            })),
        },
        params,
        spots: 4,
        endBeat: 8,
    };
}

describe("a selected placed box", () => {
    it("takes presses on its handles and inside, and lets the rest through", () => {
        const live = openLive(placed());
        expect(pressLive(live, { x: 21, y: 21 }, env)?.gesture).toMatchObject({
            type: "handle",
            key: "se",
        });
        expect(pressLive(live, { x: 10, y: 10 }, env)?.gesture?.type).toBe(
            "move",
        );
        expect(pressLive(live, { x: 80, y: 80 }, env)).toBe(null);
    });

    it("a handle stretches the box, each member keeping its spot in it", () => {
        let live = pressLive(openLive(placed()), { x: 20, y: 20 }, env)!;
        live = moveLive(live, { x: 40, y: 30 }, env);
        const out = releaseLive(live);
        expect(out.changed).toBe(true);
        const to = liveTargets(out.live.box, out.live.params, ctx);
        expect(to.map((t) => [t.marcherId, t.x, t.y])).toEqual([
            [1, 0, 0],
            [2, 40, 0],
            [3, 0, 30],
            [4, 40, 30],
        ]);
    });

    it("a drag inside moves it on the half-step grid", () => {
        let live = pressLive(openLive(placed()), { x: 10, y: 10 }, env)!;
        live = moveLive(live, { x: 21.6, y: 10 }, env);
        const out = releaseLive(live);
        // 11.6 to the right: the back-left marcher snaps from 11.6 to 10
        expect(out.live.params.center.x).toBe(20);
    });

    it("a press without a drag changes nothing", () => {
        const live = pressLive(openLive(placed()), { x: 10, y: 10 }, env)!;
        expect(releaseLive(live).changed).toBe(false);
    });

    it("keeps holes where they are", () => {
        const box = placed();
        const holed: PlacedBox = {
            ...box,
            recipe: withoutMembers(box.recipe, [2]),
        };
        let live = pressLive(openLive(holed), { x: 20, y: 20 }, env)!;
        live = moveLive(live, { x: 40, y: 20 }, env);
        const to = liveTargets(holed, releaseLive(live).live.params, ctx);
        expect(to.map((t) => t.marcherId)).toEqual([1, 3, 4]);
        // Nobody stands on slot 1, the hole (40, 0)
        expect(to.some((t) => t.x === 40 && t.y === 0)).toBe(false);
    });

    it("changes the file count, keeping the intervals", () => {
        const params = liveFiles(placed(), 1, env);
        expect(filesOf(params)).toBe(3);
        expect(params.across).toBe(20);
    });

    it("a nudge moves the whole box, not snapped, so it stays a box", () => {
        const params = liveNudge(placed().params, { x: 0, y: -2.5 });
        expect(params.center.y).toBe(placed().params.center.y - 2.5);
    });
});
