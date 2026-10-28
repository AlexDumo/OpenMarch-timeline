import { describe, expect, it } from "vitest";
import { boxTool } from "../../box/boxTool";
import {
    boxCorners,
    boxDistribution,
    drawBox,
    onField,
    resizeFiles,
    stretchBox,
    type BoxParams,
} from "../../box/boxGeometry";
import { withSpacing } from "../../editor/boxEdits";
import { DEFAULT_ODD_GAP, type OutlineDistribution } from "../distribution";
import { withMode } from "../modes";
import { distribute } from "../distribute";
import type { ToolEnv } from "../../tool/toolKind";
import type { XY } from "../../types";

/**
 * Outline with one interval all the way round (#458): each side holds as many marchers as its
 * length, so a rectangle twice as long as deep has about twice as many on its long sides.
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

/** `n` marchers drawn in a `w` × `d` box, switched to Outline */
function outline(n: number, w: number, d: number): BoxParams {
    const files = drawBox({ x: 0, y: 0 }, { x: w, y: d }, n, env)!;
    return withMode(boxTool, files, n, "outline", env) as BoxParams;
}

/** The spots, in the box's own frame (x across, y deep) */
const spotsOf = (p: BoxParams, n: number) =>
    boxTool.closed!.layouts!.resolved(p, n) === null
        ? distribute({
              n,
              region: boxTool.closed!.region(p, n),
              across: p.across,
              deep: p.deep,
              distribution: boxDistribution(p),
          })
        : [];

/** How many spots stand on each side, corners counted on both */
function sideCounts(p: BoxParams, n: number) {
    const spots = spotsOf(p, n);
    const xs = spots.map((s) => s.x);
    const ys = spots.map((s) => s.y);
    const [l, r, t, b] = [
        Math.min(...xs),
        Math.max(...xs),
        Math.min(...ys),
        Math.max(...ys),
    ];
    const on = (f: (s: XY) => boolean) => spots.filter(f).length;
    const near = (u: number, v: number) => Math.abs(u - v) < 1e-6;
    return {
        back: on((s) => near(s.y, t)),
        front: on((s) => near(s.y, b)),
        left: on((s) => near(s.x, l)),
        right: on((s) => near(s.x, r)),
        spots,
        bounds: { l, r, t, b },
    };
}

describe("an outline with one interval all round", () => {
    it("a 2:1 rectangle of 100 has about twice as many on its long sides", () => {
        const files = drawBox({ x: 0, y: 0 }, { x: 400, y: 200 }, 100, env)!;
        const frame = boxTool.frameOf(files, 100);
        const aspect = frame.halfWidth / frame.halfDepth;
        // Drawn on half steps, the box is about 2:1 (405 × 180 here)
        expect(aspect).toBeGreaterThan(1.9);
        expect(aspect).toBeLessThan(2.3);
        const p = withMode(boxTool, files, 100, "outline", env) as BoxParams;
        expect(p.across).toBe(p.deep);
        const { back, front, left, right } = sideCounts(p, 100);
        expect(back).toBe(front);
        expect(left).toBe(right);
        // Intervals along each side follow its length: the long side about twice the short one
        const ratio = (back - 1) / (left - 1);
        expect(Math.abs(ratio / aspect - 1)).toBeLessThan(0.1);
        // Not 25 a side
        expect(back).toBeGreaterThan(30);
        expect(left).toBeLessThan(20);
    });

    it("spaces every side the same, with a marcher on every corner", () => {
        for (const [n, w, d] of [
            [100, 400, 200],
            [24, 120, 50],
            [40, 90, 90],
            [31, 70, 60],
        ] as const) {
            const p = outline(n, w, d);
            const { spots, bounds } = sideCounts(p, n);
            expect(p.across).toBe(p.deep);
            // A marcher on each corner
            for (const c of [
                { x: bounds.l, y: bounds.t },
                { x: bounds.r, y: bounds.t },
                { x: bounds.l, y: bounds.b },
                { x: bounds.r, y: bounds.b },
            ])
                expect(
                    spots.some((s) => Math.hypot(s.x - c.x, s.y - c.y) < 1e-6),
                    `${n}: corner`,
                ).toBe(true);
            // Neighbors round the loop one interval apart, but for an odd count's spread side
            const loop = spots.map((s) => ({ x: s.x, y: s.y }));
            const gaps = loop.map((s, i) => {
                const t = loop[(i + 1) % loop.length]!;
                return Math.hypot(t.x - s.x, t.y - s.y);
            });
            const even = gaps.filter(
                (g) => Math.abs(g - p.across) < 1e-6,
            ).length;
            // An odd count spreads one side's spots a little wider (the Leftover rule)
            expect(even).toBeGreaterThanOrEqual(
                n % 2 === 0 ? n : n - Math.ceil(n / 2),
            );
        }
    });

    it("takes more across as a handle widens it, the interval the same both ways", () => {
        const p = outline(40, 100, 100);
        const before = onField(p, 40).across;
        const e = boxCorners(p, 40).reduce((a, b) => (b.x > a.x ? b : a));
        const wide = stretchBox(
            p,
            40,
            "e",
            { x: e.x + 80, y: boxTool.frameOf(p, 40).center.y },
            env,
        );
        expect(wide.across).toBe(wide.deep);
        expect(onField(wide, 40).across).toBeGreaterThan(before);
        expect(boxDistribution(wide).mode).toBe("outline");
    });

    it("sets both spacings when one is changed", () => {
        const p = outline(24, 120, 50);
        const q = withSpacing(p, "across", 2.5, 24, env);
        expect([q.across, q.deep]).toEqual([25, 25]);
        const r = withSpacing(p, "deep", 1.5, 24, env, true);
        expect([r.across, r.deep]).toEqual([15, 15]);
    });

    it("opens an outline stored with two intervals unchanged, and evens it on a count change", () => {
        // As #390 stored them: sides from the file count, each axis its own interval
        const stored: BoxParams = {
            center: { x: 0, y: 0 },
            rotation: 0,
            files: 6,
            across: 15,
            deep: 25,
            distribution: { mode: "outline", oddGap: DEFAULT_ODD_GAP },
        };
        const { spots } = sideCounts(stored, 16);
        const xs = [...new Set(spots.map((s) => s.x.toFixed(6)))].map(Number);
        const ys = [...new Set(spots.map((s) => s.y.toFixed(6)))].map(Number);
        // 5 intervals across at 15, 3 deep at 25: as it was drawn
        expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(75, 9);
        expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(75, 9);
        const fewer = resizeFiles(stored, 16, 5, env);
        expect([fewer.across, fewer.deep]).toEqual([15, 15]);
        expect((boxDistribution(fewer) as OutlineDistribution).mode).toBe(
            "outline",
        );
    });
});
