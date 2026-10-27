import { describe, expect, it } from "vitest";
import { boxTool } from "../box/boxTool";
import { circleTool } from "../circle/circleTool";
import {
    distributionOf,
    reshuffle,
    withMode,
    withSeed,
} from "../distribute/modes";
import type { SpreadDistribution } from "../distribute/distribution";
import { fieldToFrame } from "../frame/frame";
import type { AnyToolKind, ToolEnv } from "../tool/toolKind";
import {
    edit,
    openTool,
    pointerMove,
    press,
    release,
    slotsOf,
    type ToolState,
} from "../tool/toolMachine";
import type { ShapeContext, XY } from "../types";

/**
 * A spread fills the frame the designer drew (#439): the frame (center, size, turn) is the
 * shape's, and Reshuffle only picks another even arrangement inside it. It never moves, grows or
 * shrinks the frame or its outline, and the marchers use the whole frame for every seed.
 */

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
const marchers = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        at: { x: 300 + i * 7, y: 300 },
        drillRank: i,
    }));

function spreadDrawn(kind: AnyToolKind, n: number, from: XY, to: XY) {
    let t = openTool(kind, marchers(n));
    t = press(t, from, env);
    t = pointerMove(t, to, env);
    t = release(t, ctx);
    return edit(t, withMode(t.kind, t.params, t.spots, "spread", env), ctx);
}

/** The shape reshuffled `times` times, as the Reshuffle button does it */
function reshuffledTimes(t: ToolState, times: number): ToolState {
    for (let i = 0; i < times; i++)
        t = edit(t, reshuffle(t.kind, t.params, t.spots, env), ctx);
    return t;
}

const seedOf = (t: ToolState) =>
    (distributionOf(t.kind, t.params, t.spots) as SpreadDistribution).seed;

const SHAPES: Record<string, (n: number) => ToolState> = {
    box: (n) => spreadDrawn(boxTool, n, { x: 0, y: 0 }, { x: 90, y: 40 }),
    circle: (n) => spreadDrawn(circleTool, n, { x: 0, y: 0 }, { x: 50, y: 0 }),
};

describe.each(Object.entries(SHAPES))("a %s in Spread", (_, drawn) => {
    describe.each([12, 24, 48])("at %i marchers", (n) => {
        it("keeps its frame and outline through every Reshuffle", () => {
            const s = drawn(n);
            const frame = s.kind.frameOf(s.params, n);
            const outline = s.kind.outline?.(s.params, n);
            for (let times = 1; times <= 6; times++) {
                const r = reshuffledTimes(s, times);
                expect(seedOf(r)).toBe(seedOf(s) + times);
                expect(r.kind.frameOf(r.params, n)).toEqual(frame);
                expect(r.kind.outline?.(r.params, n)).toEqual(outline);
            }
        });

        it("keeps its frame and outline for a typed seed, near or far (#437)", () => {
            const s = drawn(n);
            const frame = s.kind.frameOf(s.params, n);
            const outline = s.kind.outline?.(s.params, n);
            for (const seed of [1, 9, 4242, 2 ** 31 - 1]) {
                const typed = edit(
                    s,
                    withSeed(s.kind, s.params, s.spots, seed, env),
                    ctx,
                );
                expect(seedOf(typed)).toBe(seed);
                expect(typed.kind.frameOf(typed.params, n)).toEqual(frame);
                expect(typed.kind.outline?.(typed.params, n)).toEqual(outline);
            }
        });

        it("fills its frame for every seed: marchers inside, near every side", () => {
            const s = drawn(n);
            const frame = s.kind.frameOf(s.params, n);
            for (let times = 0; times < 20; times++) {
                const r = reshuffledTimes(s, times);
                const local = slotsOf(r, ctx).map((p) =>
                    fieldToFrame(frame, p),
                );
                const xs = local.map((p) => p.x);
                const ys = local.map((p) => p.y);
                for (const p of local) {
                    expect(Math.abs(p.x)).toBeLessThanOrEqual(frame.halfWidth);
                    expect(Math.abs(p.y)).toBeLessThanOrEqual(frame.halfDepth);
                }
                // No empty band along a side wider than an interval
                const interval =
                    (r.params as { across?: number; interval?: number })
                        .across ?? (r.params as { interval: number }).interval;
                expect(frame.halfWidth - Math.max(...xs)).toBeLessThan(
                    interval,
                );
                expect(frame.halfWidth + Math.min(...xs)).toBeLessThan(
                    interval,
                );
                expect(frame.halfDepth - Math.max(...ys)).toBeLessThan(
                    interval,
                );
                expect(frame.halfDepth + Math.min(...ys)).toBeLessThan(
                    interval,
                );
            }
        });
    });
});
