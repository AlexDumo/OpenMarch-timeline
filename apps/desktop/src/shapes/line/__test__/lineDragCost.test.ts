import { describe, expect, it } from "vitest";
import {
    dragPoint,
    drawPoints,
    lineInterval,
    type LineParams,
} from "../lineGeometry";
import type { ToolEnv } from "../../tool/toolKind";

/**
 * Dragging an end of a curve measured straight across stays quick (#596): each pointer move
 * searches for where the interval comes out whole, and each try is a layout searched for straight
 * across. It took over a second a move for 64 marchers before. The bound is generous, so a slow CI
 * machine doesn't fail it; it catches a return to searching hundreds of layouts a move.
 */

const STEP = 10;
const half = STEP / 2;
const snapHalf = (v: number) => Math.round(v / half) * half;
const env: ToolEnv = {
    stepPx: STEP,
    snap: true,
    pull: true,
    constrain: false,
    gridSnap: (p) => ({ x: snapHalf(p.x), y: snapHalf(p.y) }),
    hitRadius: 3,
    pullRadius: 2,
    zoom: 1,
};

/** An 8-point curve, zigzagging, measured as `measured` says */
const curve = (measured?: "straight"): LineParams => {
    const points = Array.from({ length: 8 }, (_, i) => ({
        x: 100 + i * 40,
        y: 100 + (i % 2) * 60,
    }));
    const drawn = drawPoints(points, env, 1)!;
    return measured ? { ...drawn, measured } : drawn;
};

/** The mean time a pointer move takes, dragging the last point about */
function msPerMove(base: LineParams, n: number): number {
    const moves = 20;
    const drag = (i: number) =>
        dragPoint(base, n, 7, { x: 380 + i * 1.3, y: 170 + i }, env);
    // Warmed up first, so the timing isn't the compiler's
    for (let i = 0; i < 5; i++) drag(i);
    const start = performance.now();
    for (let i = 0; i < moves; i++) drag(i);
    return (performance.now() - start) / moves;
}

describe("dragging an end of a curve (#596)", () => {
    it.each([16, 64])(
        "straight across, %i marchers: well under a frame's budget a move",
        (n) => {
            expect(msPerMove(curve("straight"), n)).toBeLessThan(60);
        },
    );

    it("still snaps an end near the pointer so the interval comes out whole, straight across", () => {
        const to = { x: 381.3, y: 171 };
        const moved = dragPoint(curve("straight"), 16, 7, to, env);
        const end = moved.points[7]!;
        expect(Math.hypot(end.x - to.x, end.y - to.y)).toBeLessThan(6);
        expect(lineInterval(moved, 16)).toBeCloseTo(30, 9);
    });
});
