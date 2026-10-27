import { describe, expect, it } from "vitest";
import { boxTool } from "../box/boxTool";
import { circleTool } from "../circle/circleTool";
import { withMode } from "../distribute/modes";
import type { DistributionMode } from "../distribute/distribution";
import type { ShapeFrame } from "../frame/frame";
import type { AnyToolKind, ToolEnv } from "../tool/toolKind";
import {
    edit,
    openTool,
    pointerMove,
    press,
    release,
    type ToolState,
} from "../tool/toolMachine";
import type { ShapeContext, XY } from "../types";

/**
 * Every mode switch keeps the frame the designer drew (#449, after #439): the center exactly, the
 * size within half a step per side (Grid and Outline stand on half-step intervals), and Grid →
 * Spread → Grid is the box it was.
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

function drawn(kind: AnyToolKind, n: number, from: XY, to: XY): ToolState {
    let t = openTool(kind, marchers(n));
    t = press(t, from, env);
    t = pointerMove(t, to, env);
    return release(t, ctx);
}

const switched = (t: ToolState, mode: DistributionMode) =>
    edit(t, withMode(t.kind, t.params, t.spots, mode, env), ctx);

const frameOf = (t: ToolState): ShapeFrame => t.kind.frameOf(t.params, t.spots);

function expectKept(
    now: ShapeFrame,
    was: ShapeFrame,
    what: string,
    /** Switches made: each may move a side up to half a step */
    switches = 1,
) {
    expect(now.center.x, `${what}: center`).toBeCloseTo(was.center.x, 9);
    expect(now.center.y, `${what}: center`).toBeCloseTo(was.center.y, 9);
    expect(now.rotation, `${what}: turn`).toBe(was.rotation);
    expect(
        Math.abs(now.halfWidth - was.halfWidth),
        `${what}: width ${2 * was.halfWidth} → ${2 * now.halfWidth}`,
    ).toBeLessThanOrEqual(switches * half + 1e-9);
    expect(
        Math.abs(now.halfDepth - was.halfDepth),
        `${what}: depth ${2 * was.halfDepth} → ${2 * now.halfDepth}`,
    ).toBeLessThanOrEqual(switches * half + 1e-9);
}

const COUNTS = [7, 12, 15, 24, 48];
const BOX_MODES: DistributionMode[] = ["files", "outline", "spread"];
/** Boxes as drawn: wide, square-ish, deep */
const DRAWS: [XY, XY][] = [
    [
        { x: 0, y: 0 },
        { x: 120, y: 50 },
    ],
    [
        { x: 0, y: 0 },
        { x: 70, y: 60 },
    ],
    [
        { x: 0, y: 0 },
        { x: 40, y: 110 },
    ],
];

describe("a box keeps its frame through every mode switch (#449)", () => {
    describe.each(COUNTS)("at %i marchers", (n) => {
        it.each(
            BOX_MODES.flatMap((a) =>
                BOX_MODES.filter((b) => b !== a).map((b) => [a, b] as const),
            ),
        )("%s → %s", (a, b) => {
            for (const [from, to] of DRAWS) {
                const start = switched(drawn(boxTool, n, from, to), a);
                const was = frameOf(start);
                // A frame with no area (a line) has nothing to keep
                if (!(was.halfWidth > 0) || !(was.halfDepth > 0)) continue;
                const now = switched(start, b);
                expectKept(
                    frameOf(now),
                    was,
                    `${a} → ${b} drawn to ${to.x},${to.y}`,
                );
            }
        });
    });

    it.each(COUNTS)(
        "Grid → Spread → Grid is the box drawn, and Grid → Outline → Grid within half a step a side each way, at %i",
        (n) => {
            for (const [from, to] of DRAWS) {
                const grid = drawn(boxTool, n, from, to);
                const viaSpread = switched(switched(grid, "spread"), "files");
                expect(viaSpread.params).toEqual(
                    expect.objectContaining({
                        center: (grid.params as { center: XY }).center,
                        files: (grid.params as { files: number }).files,
                        across: (grid.params as { across: number }).across,
                        deep: (grid.params as { deep: number }).deep,
                    }),
                );
                const viaOutline = switched(switched(grid, "outline"), "files");
                expectKept(
                    frameOf(viaOutline),
                    frameOf(grid),
                    "via outline",
                    2,
                );
            }
        },
    );
});

describe("a circle keeps its radius through every mode switch (#449)", () => {
    it.each(COUNTS)("Outline ↔ Spread at %i", (n) => {
        const outline = drawn(circleTool, n, { x: 0, y: 0 }, { x: 60, y: 0 });
        const spread = switched(outline, "spread");
        expectKept(frameOf(spread), frameOf(outline), "outline → spread");
        expectKept(
            frameOf(switched(spread, "outline")),
            frameOf(outline),
            "and back",
        );
    });
});
