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
import { chipLayout } from "../../editor/chip";
import { SWAY_BAND } from "../../box/boxGeometry";
import {
    DEFAULT_ODD_GAP,
    readSavedDistribution,
    savedDistributionOf,
} from "../distribution";
import { shapeSteps } from "../../command/shapeSteps";
import { withMode } from "../modes";
import { leftoverSpacing } from "../outlineGap";
import { distribute } from "../distribute";
import type { ToolEnv } from "../../tool/toolKind";
import {
    edit,
    openTool,
    pointerMove,
    press,
    release,
    targetsOf,
} from "../../tool/toolMachine";
import type { ShapeContext, XY } from "../../types";

/**
 * Outline (#458, owner on #459): whatever is touched is held and the rest worked out once. A
 * spacing set holds that spacing and the other length, the split chosen so the other spacing
 * comes nearest; a drag moves only the dragged edge. A rectangle twice as long as deep gets about
 * twice as many on its long sides.
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

const LINES = { x: [-160, -80, 0, 80, 160, 240], y: [0, -280, -560] };
const lined = (over: Partial<ToolEnv> = {}): ToolEnv => ({
    ...env,
    fieldLines: LINES,
    pullRadius: 6,
    ...over,
});
const onLine = (p: XY) =>
    LINES.x.some((x) => Math.abs(p.x - x) < 1e-6) ||
    LINES.y.some((y) => Math.abs(p.y - y) < 1e-6);
const onHalves = (v: number) =>
    Math.abs(v / half - Math.round(v / half)) < 1e-9;
const edgesOf = (q: BoxParams, n: number) => {
    const cs = boxCorners(q, n);
    return {
        left: Math.min(...cs.map((c) => c.x)),
        right: Math.max(...cs.map((c) => c.x)),
        top: Math.min(...cs.map((c) => c.y)),
        bottom: Math.max(...cs.map((c) => c.y)),
    };
};
/** The frame's length one way: gaps times that way's spacing */
const lengthOf = (q: BoxParams, n: number, way: "across" | "deep") =>
    (onField(q, n)[way] - 1) * q[way];

describe("an outline: what's touched is held, the rest worked out once (owner on #459)", () => {
    it("a 2:1 rectangle of 100 switched to Outline keeps its frame, about twice as many on its long sides", () => {
        const files = drawBox({ x: 0, y: 0 }, { x: 400, y: 200 }, 100, env)!;
        const frame = boxTool.frameOf(files, 100);
        const aspect = frame.halfWidth / frame.halfDepth;
        expect(aspect).toBeGreaterThan(1.9);
        expect(aspect).toBeLessThan(2.3);
        const p = withMode(boxTool, files, 100, "outline", env) as BoxParams;
        const { back, front, left, right } = sideCounts(p, 100);
        expect(back).toBe(front);
        expect(left).toBe(right);
        expect(Math.abs((back - 1) / (left - 1) / aspect - 1)).toBeLessThan(
            0.15,
        );
        expect(back).toBeGreaterThan(30);
        expect(left).toBeLessThan(20);
        const kept = boxTool.frameOf(p, 100);
        expect(kept.halfWidth).toBeCloseTo(frame.halfWidth, 9);
        expect(kept.halfDepth).toBeCloseTo(frame.halfDepth, 9);
        expect(Math.abs(Math.log(p.deep / p.across))).toBeLessThan(0.15);
    });

    it("spaces the back and front at across and the sides at deep, with a marcher on every corner", () => {
        for (const [n, w, d] of [
            [100, 400, 200],
            [24, 120, 50],
            [40, 90, 90],
            [31, 70, 60],
        ] as const) {
            const p = outline(n, w, d);
            const { spots, bounds } = sideCounts(p, n);
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
            const gaps = spots.map((s, i) => {
                const t = spots[(i + 1) % spots.length]!;
                return Math.hypot(t.x - s.x, t.y - s.y);
            });
            const atAcross = gaps.filter(
                (g) => Math.abs(g - p.across) < 1e-6,
            ).length;
            const atDeep = gaps.filter(
                (g) => Math.abs(g - p.deep) < 1e-6,
            ).length;
            expect(atAcross + atDeep, `${n}`).toBeGreaterThanOrEqual(
                n % 2 === 0 ? n : n - Math.ceil(n / 2),
            );
        }
    });

    it("a drastic across edit (2 → 4) holds across, keeps the depth, chooses the counts again and works out deep, in one pass", () => {
        const p = withSpacing(outline(40, 120, 120), "across", 2, 40, env);
        expect(p.across).toBe(20);
        const depth = lengthOf(p, 40, "deep");
        const q = withSpacing(p, "across", 4, 40, env);
        expect(q.across).toBe(40);
        expect(lengthOf(q, 40, "deep")).toBeCloseTo(depth, 9);
        // Deep follows to about 4 steps over the same depth: fewer gaps down the sides, and the
        // back and front take the rest
        expect(onField(q, 40).deep).toBeLessThan(onField(p, 40).deep);
        expect(onField(q, 40).across).toBeGreaterThan(onField(p, 40).across);
        // Deep is the depth over its gaps, the count nearest 4 steps
        const b = onField(q, 40).deep - 1;
        expect(q.deep).toBeCloseTo(depth / b, 9);
        for (let other = 1; other < 20; other++)
            if (depth / other >= half)
                expect(Math.abs(Math.log(q.deep / 40))).toBeLessThanOrEqual(
                    Math.abs(Math.log(depth / other / 40)) + SWAY_BAND + 1e-9,
                );
        // The same edit again changes nothing
        expect(withSpacing(q, "across", 4, 40, env)).toEqual(q);
    });

    it("a deep edit holds deep and the width, and works out across", () => {
        const p = outline(24, 120, 50);
        const width = lengthOf(p, 24, "across");
        const q = withSpacing(p, "deep", 1.5, 24, env);
        expect(q.deep).toBe(15);
        expect(lengthOf(q, 24, "across")).toBeCloseTo(width, 9);
        expect(withSpacing(q, "deep", 1.5, 24, env)).toEqual(q);
    });

    for (const key of ["e", "w", "n", "s"] as const)
        for (const way of [1, -1])
            it(`dragging the ${key} edge ${way > 0 ? "out" : "in"} moves only that edge: the counts, the other spacing and the other edges stay exactly`, () => {
                const p = withSpacing(
                    outline(40, 100, 100),
                    "across",
                    2,
                    40,
                    env,
                );
                const counts = onField(p, 40);
                const was = edgesOf(p, 40);
                const h = boxTool.handles(p, 40).find((x) => x.key === key)!.at;
                const out =
                    key === "e" || key === "w"
                        ? { x: (key === "e" ? 1 : -1) * way, y: 0 }
                        : { x: 0, y: (key === "s" ? 1 : -1) * way };
                const moved =
                    key === "e"
                        ? "right"
                        : key === "w"
                          ? "left"
                          : key === "s"
                            ? "bottom"
                            : "top";
                const across = key === "e" || key === "w";
                let last: number | null = null;
                for (let px = 0.5; px <= 30; px += 0.5) {
                    const q = stretchBox(
                        p,
                        40,
                        key,
                        { x: h.x + out.x * px, y: h.y + out.y * px },
                        env,
                    );
                    expect(onField(q, 40)).toMatchObject({
                        across: counts.across,
                        deep: counts.deep,
                    });
                    expect(q[across ? "deep" : "across"]).toBe(
                        p[across ? "deep" : "across"],
                    );
                    const now = edgesOf(q, 40);
                    for (const edge of [
                        "left",
                        "right",
                        "top",
                        "bottom",
                    ] as const)
                        if (edge !== moved)
                            expect(
                                Math.abs(now[edge] - was[edge]),
                                edge,
                            ).toBeLessThan(1e-6);
                    // The dragged spacing follows smoothly, never under half a step
                    const spacing = q[across ? "across" : "deep"];
                    expect(spacing).toBeGreaterThanOrEqual(half - 1e-9);
                    if (last !== null)
                        expect(Math.abs(spacing - last)).toBeLessThan(0.5);
                    last = spacing;
                }
            });

    it("shows a spacing off the half steps as about so much; pressing it puts it on the nearest half step, as an edit of it", () => {
        const p = withSpacing(outline(24, 120, 50), "across", 2, 24, env);
        // A drag leaves across off the half steps
        const e = boxTool.handles(p, 24).find((h) => h.key === "e")!.at;
        const q = stretchBox(p, 24, "e", { x: e.x + 7.3, y: e.y }, env);
        expect(onHalves(q.across)).toBe(false);
        const layout = chipLayout(boxTool, q, 24, env);
        const across = layout.intervals.find((x) => x.param.key === "across")!;
        expect(across.derived).toBe(true);
        // The "≈" is the editor's button; the number shows plain
        expect(across.display.startsWith("≈")).toBe(false);
        expect(layout.ratioLock).toBe(false);
        const snapped = across.param.snap!(q, 24, env) as BoxParams;
        expect(onHalves(snapped.across)).toBe(true);
        expect(Math.abs(snapped.across - q.across)).toBeLessThanOrEqual(
            half / 2 + 1e-9,
        );
        expect(lengthOf(snapped, 24, "deep")).toBeCloseTo(
            lengthOf(q, 24, "deep"),
            9,
        );
        const after = chipLayout(boxTool, snapped, 24, env).intervals.find(
            (x) => x.param.key === "across",
        )!;
        expect(after.derived).toBe(false);
        // Pressing it again changes nothing
        expect(across.param.snap!(snapped, 24, env)).toEqual(snapped);
    });

    it("a count changed keeps both spacings, the lengths following", () => {
        const p = outline(24, 120, 50);
        const q = resizeFiles(p, 24, onField(p, 24).across - 1, env);
        expect([q.across, q.deep]).toEqual([p.across, p.deep]);
    });

    it('opens an outline stored before unchanged, the exact: "deep" a build of #459 wrote too', () => {
        const stored: BoxParams = {
            center: { x: 0, y: 0 },
            rotation: 0,
            files: 6,
            across: 15,
            deep: 25,
            distribution: { mode: "outline", oddGap: DEFAULT_ODD_GAP },
        };
        const withExact = {
            ...stored,
            distribution: { ...stored.distribution!, exact: "deep" },
        } as unknown as BoxParams;
        for (const q of [stored, withExact]) {
            const { spots } = sideCounts(q, 16);
            const xs = spots.map((s) => s.x);
            const ys = spots.map((s) => s.y);
            expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(75, 9);
            expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(75, 9);
            expect(boxDistribution(q)).not.toHaveProperty("exact");
            expect(boxTool.frameOf(q, 16)).toEqual(boxTool.frameOf(stored, 16));
        }
        expect(
            readSavedDistribution({
                mode: "outline",
                oddGap: DEFAULT_ODD_GAP,
                exact: "deep",
            }),
        ).not.toHaveProperty("exact");
        expect(
            savedDistributionOf(boxDistribution(withExact)),
        ).not.toHaveProperty("exact");
    });

    it("holds the split through a spacing a hair either side of a boundary", () => {
        const p = withSpacing(outline(40, 100, 100), "across", 2, 40, env);
        // Find a boundary: the first typed across where the split changes
        let q = p;
        let edge: number | null = null;
        for (let v = 2; v <= 5 && edge === null; v += 0.01) {
            const next = withSpacing(q, "across", v, 40, env, true);
            if (next.files !== q.files) edge = v;
            q = next;
        }
        expect(edge).not.toBeNull();
        const held = q.files;
        for (let k = 0; k < 20; k++) {
            const v = edge! + (k % 2 === 0 ? -0.005 : 0.005);
            q = withSpacing(q, "across", v, 40, env, true);
            expect(q.files).toBe(held);
        }
    });

    it("never takes a worked-out spacing under half a step, whatever the edit", () => {
        let q = outline(24, 120, 30);
        for (const [which, v] of [
            ["across", 0.5],
            ["deep", 4],
            ["across", 6],
            ["deep", 0.5],
            ["across", 3],
        ] as const) {
            q = withSpacing(q, which, v, 24, env);
            expect(Math.min(q.across, q.deep)).toBeGreaterThanOrEqual(
                half - 1e-9,
            );
        }
        for (const key of ["s", "e", "se", "n", "w"] as const) {
            const c = boxTool.frameOf(q, 24).center;
            const out = stretchBox(q, 24, key, { x: c.x, y: c.y }, env);
            expect(Math.min(out.across, out.deep), key).toBeGreaterThanOrEqual(
                half - 1e-9,
            );
        }
        for (let k = 0; k < 30; k++) {
            q = resizeFiles(q, 24, onField(q, 24).across - 1, env);
            expect(Math.min(q.across, q.deep)).toBeGreaterThanOrEqual(
                half - 1e-9,
            );
        }
    });

    for (const degrees of [15, 30, 60])
        for (const key of ["s", "e"] as const)
            it(`a turned ${degrees}° outline's ${key} drag lands a corner on a line within the radius`, () => {
                const p: BoxParams = {
                    ...outline(24, 120, 80),
                    center: { x: 40, y: -230 },
                    rotation: (degrees * Math.PI) / 180,
                    across: 15,
                    deep: 15,
                };
                const h = boxTool.handles(p, 24).find((x) => x.key === key)!.at;
                const dir =
                    key === "s"
                        ? { x: -Math.sin(p.rotation), y: Math.cos(p.rotation) }
                        : { x: Math.cos(p.rotation), y: Math.sin(p.rotation) };
                let pulled = 0;
                for (let px = -30; px <= 150; px += 0.5) {
                    const to = { x: h.x + px * dir.x, y: h.y + px * dir.y };
                    const out = stretchBox(p, 24, key, to, lined());
                    const free = stretchBox(
                        p,
                        24,
                        key,
                        to,
                        lined({ pull: false }),
                    );
                    if (out.across === free.across && out.deep === free.deep)
                        continue;
                    pulled++;
                    const corners = boxCorners(out, 24);
                    const was = boxCorners(free, 24);
                    const landed = corners
                        .map((c, k) => ({ c, k }))
                        .filter(({ c }) => onLine(c))
                        .map(({ c, k }) =>
                            Math.hypot(c.x - was[k]!.x, c.y - was[k]!.y),
                        );
                    expect(landed.length, `${px}`).toBeGreaterThan(0);
                    expect(Math.min(...landed)).toBeLessThanOrEqual(6 + 1e-6);
                }
                expect(pulled).toBeGreaterThan(0);
            });

    it("a spacing change that moves marchers between sides works out who goes where again: no walks cross", () => {
        const marchers = Array.from({ length: 24 }, (_, i) => ({
            id: i + 1,
            at: { x: -200 + (i % 8) * 30, y: 200 + Math.floor(i / 8) * 30 },
            drillRank: i,
        }));
        let t = openTool(boxTool, marchers);
        t = press(t, { x: 0, y: 0 }, env);
        t = pointerMove(t, { x: 70, y: 50 }, env);
        t = release(t, ctx);
        t = edit(t, withMode(boxTool, t.params, 24, "outline", env), ctx);
        const before = onField(t.params as BoxParams, 24);
        t = edit(
            t,
            withSpacing(t.params as BoxParams, "across", 0.5, 24, env),
            ctx,
        );
        const after = onField(t.params as BoxParams, 24);
        expect(after.across).not.toBe(before.across);
        const walks = targetsOf(t, ctx);
        const cross = (a: { from: XY; to: XY }, b: { from: XY; to: XY }) => {
            const side = (p: XY, q: XY, r: XY) =>
                Math.sign(
                    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x),
                );
            return (
                side(a.from, a.to, b.from) * side(a.from, a.to, b.to) < 0 &&
                side(b.from, b.to, a.from) * side(b.from, b.to, a.to) < 0
            );
        };
        for (let i = 0; i < walks.length; i++)
            for (let j = i + 1; j < walks.length; j++)
                expect(cross(walks[i]!, walks[j]!), `${i} × ${j}`).toBe(false);
    });

    it("the command bar asks both spacings", () => {
        const p = outline(24, 120, 50);
        const keys = shapeSteps(boxTool, p, 24, env, []).steps.map(
            (st) => st.param.key,
        );
        expect(keys).toEqual(expect.arrayContaining(["across", "deep"]));
    });
});

describe("an odd outline: the full sides are the reference, the leftover side adjusts (owner on #459)", () => {
    /** 15 round 6 × 4 (5 gaps across, 3 deep), the back leaving its spot out */
    const fifteen = (
        across: number,
        side: "back" | "front" | "left" | "right" = "back",
        style: "spread" | "gap" = "spread",
    ): BoxParams => ({
        center: { x: 0, y: 0 },
        rotation: 0,
        files: 6,
        across,
        deep: 30,
        distribution: { mode: "outline", oddGap: { side, at: null, style } },
    });
    /** The spots along one side, in order */
    const sideSpots = (q: BoxParams, n: number, side: string) => {
        const { spots, bounds } = sideCounts(q, n);
        const near = (u: number, v: number) => Math.abs(u - v) < 1e-6;
        const on =
            side === "back"
                ? (s: XY) => near(s.y, bounds.t)
                : side === "front"
                  ? (s: XY) => near(s.y, bounds.b)
                  : side === "left"
                    ? (s: XY) => near(s.x, bounds.l)
                    : (s: XY) => near(s.x, bounds.r);
        const across = side === "back" || side === "front";
        return spots
            .filter(on)
            .map((s) => (across ? s.x : s.y))
            .sort((a, b) => a - b);
    };
    const gapsOf = (xs: number[]) => xs.slice(1).map((v, i) => v - xs[i]!);

    it("the chip has the full sides' spacing (the front's ≈3.2), the back a clean 4 that the Leftover pill shows", () => {
        const p = fifteen(32);
        const across = chipLayout(boxTool, p, 15, env).intervals.find(
            (x) => x.param.key === "across",
        )!;
        expect(across.display).toBe("3.2");
        expect(across.derived).toBe(true);
        for (const g of gapsOf(sideSpots(p, 15, "front")))
            expect(g).toBeCloseTo(32, 9);
        for (const g of gapsOf(sideSpots(p, 15, "back")))
            expect(g).toBeCloseTo(40, 9);
        expect(leftoverSpacing(boxTool, p, 15)).toBeCloseTo(40, 9);
    });

    it("an across edit holds the full sides' spacing on its half step, the back following (≈3¾), and again changes nothing", () => {
        const p = fifteen(32);
        const q = withSpacing(p, "across", 3, 15, env);
        expect(q.across).toBe(30);
        for (const g of gapsOf(sideSpots(q, 15, "front")))
            expect(g).toBeCloseTo(30, 9);
        const left = leftoverSpacing(boxTool, q, 15)!;
        expect(left).toBeCloseTo(
            (30 * onFieldGaps(q)) / (onFieldGaps(q) - 1),
            9,
        );
        expect(left).toBeGreaterThanOrEqual(half - 1e-9);
        expect(withSpacing(q, "across", 3, 15, env)).toEqual(q);
    });

    it("leaving a gap, the back's marchers keep the full spacing and one spot is empty", () => {
        const p = fifteen(30, "back", "gap");
        expect(leftoverSpacing(boxTool, p, 15)).toBeNull();
        const back = sideSpots(p, 15, "back");
        expect(back).toHaveLength(5);
        const gaps = gapsOf(back);
        // Every gap the full spacing, but for the one spot left out (twice as wide)
        expect(gaps.filter((g) => Math.abs(g - 30) < 1e-6)).toHaveLength(3);
        expect(gaps.filter((g) => Math.abs(g - 60) < 1e-6)).toHaveLength(1);
    });

    for (const side of ["back", "front", "left", "right"] as const)
        it(`spreading on the ${side}, that side's marchers share its length and the rest keep the full spacing`, () => {
            const p = fifteen(30, side);
            const across = side === "back" || side === "front";
            const len = across ? 5 : 3;
            const full = across ? 30 : 30;
            const spread = leftoverSpacing(boxTool, p, 15)!;
            expect(spread).toBeCloseTo((len * full) / (len - 1), 9);
            for (const g of gapsOf(sideSpots(p, 15, side)))
                expect(g).toBeCloseTo(spread, 9);
            const opposite =
                side === "back"
                    ? "front"
                    : side === "front"
                      ? "back"
                      : side === "left"
                        ? "right"
                        : "left";
            for (const g of gapsOf(sideSpots(p, 15, opposite)))
                expect(g).toBeCloseTo(full, 9);
        });

    it("an even count (22) has no leftover side", () => {
        const p = outline(22, 160, 100);
        expect(leftoverSpacing(boxTool, p, 22)).toBeNull();
        expect(sideCounts(p, 22).back).toBe(sideCounts(p, 22).front);
    });
});

/** Gaps along the back and front of a 15-spot outline (a) */
function onFieldGaps(q: BoxParams): number {
    return onField(q, 15).across - 1;
}
