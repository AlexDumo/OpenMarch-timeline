import { describe, expect, it } from "vitest";
import { boxTool } from "../../box/boxTool";
import {
    boxCorners,
    boxDistribution,
    drawBox,
    onField,
    resizeFiles,
    exactOf,
    stretchBox,
    withOutlineExact,
    type BoxParams,
} from "../../box/boxGeometry";
import { withSpacing } from "../../editor/boxEdits";
import { chipLayout } from "../../editor/chip";
import {
    DEFAULT_ODD_GAP,
    readSavedDistribution,
    savedDistributionOf,
    type OutlineDistribution,
} from "../distribution";
import { shapeSteps } from "../../command/shapeSteps";
import { withMode } from "../modes";
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

describe("an outline: across is the designer's interval, deep follows the frame (owner on #459)", () => {
    it("a 2:1 rectangle of 100 has about twice as many on its long sides, the frame kept", () => {
        const files = drawBox({ x: 0, y: 0 }, { x: 400, y: 200 }, 100, env)!;
        const frame = boxTool.frameOf(files, 100);
        const aspect = frame.halfWidth / frame.halfDepth;
        // Drawn on half steps, the box is about 2:1 (405 × 180 here)
        expect(aspect).toBeGreaterThan(1.9);
        expect(aspect).toBeLessThan(2.3);
        const p = withMode(boxTool, files, 100, "outline", env) as BoxParams;
        const { back, front, left, right } = sideCounts(p, 100);
        expect(back).toBe(front);
        expect(left).toBe(right);
        // Intervals along each side follow its length: the long side about twice the short one
        expect(Math.abs((back - 1) / (left - 1) / aspect - 1)).toBeLessThan(
            0.15,
        );
        // Not 25 a side
        expect(back).toBeGreaterThan(30);
        expect(left).toBeLessThan(20);
        // The frame kept, to 600ths of a step per interval
        const kept = boxTool.frameOf(p, 100);
        expect(Math.abs(kept.halfWidth - frame.halfWidth)).toBeLessThan(0.5);
        expect(kept.halfDepth).toBeCloseTo(frame.halfDepth, 9);
        // The sides' spacing near the across interval
        expect(Math.abs(Math.log(p.deep / p.across))).toBeLessThan(0.15);
    });

    it("spaces the back and front at across and the sides evenly at deep, with a marcher on every corner", () => {
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
            // Every neighbor pair an interval apart, but for an odd count's spread side
            expect(atAcross + atDeep, `${n}`).toBeGreaterThanOrEqual(
                n % 2 === 0 ? n : n - Math.ceil(n / 2),
            );
        }
    });

    for (const exact of ["across", "deep"] as const)
        it(`with ${exact} exact, dragging the other way changes only that length: the exact interval, the counts and every other edge stay exactly (owner on #459)`, () => {
            // On half steps first: the first edit after a switch puts the exact interval there
            const switched = withOutlineExact(outline(40, 100, 100), exact);
            const exactKey = exact === "across" ? "e" : "s";
            const h = boxTool
                .handles(switched, 40)
                .find((x) => x.key === exactKey)!.at;
            const p = stretchBox(switched, 40, exactKey, h, env);
            const interval = p[exact];
            expect(interval % half).toBe(0);
            const counts = onField(p, 40);
            const edges = (q: BoxParams) => {
                const cs = boxCorners(q, 40);
                return {
                    left: Math.min(...cs.map((c) => c.x)),
                    right: Math.max(...cs.map((c) => c.x)),
                    top: Math.min(...cs.map((c) => c.y)),
                    bottom: Math.max(...cs.map((c) => c.y)),
                };
            };
            const was = edges(p);
            // The other way's handle: s (front) when across is exact, e when deep is
            const otherKey = exact === "across" ? "s" : "e";
            const o = boxTool
                .handles(p, 40)
                .find((x) => x.key === otherKey)!.at;
            const follows = exact === "across" ? "deep" : "across";
            let last: number | null = null;
            for (let px = -30; px <= 80; px += 0.5) {
                const to =
                    otherKey === "s"
                        ? { x: o.x, y: o.y + px }
                        : { x: o.x + px, y: o.y };
                const out = stretchBox(p, 40, otherKey, to, env);
                expect(out[exact]).toBe(interval);
                expect(onField(out, 40)).toMatchObject({
                    across: counts.across,
                    deep: counts.deep,
                });
                const now = edges(out);
                if (otherKey === "s") {
                    expect(Math.abs(now.left - was.left)).toBeLessThan(1e-6);
                    expect(Math.abs(now.right - was.right)).toBeLessThan(1e-6);
                    expect(Math.abs(now.top - was.top)).toBeLessThan(1e-6);
                } else {
                    expect(Math.abs(now.top - was.top)).toBeLessThan(1e-6);
                    expect(Math.abs(now.bottom - was.bottom)).toBeLessThan(
                        1e-6,
                    );
                    expect(Math.abs(now.left - was.left)).toBeLessThan(1e-6);
                }
                // Smooth, and never under half a step
                expect(out[follows]).toBeGreaterThanOrEqual(half - 1e-9);
                if (last !== null)
                    expect(Math.abs(out[follows] - last)).toBeLessThan(0.5);
                last = out[follows];
            }
        });

    it("takes more across as a handle widens it, across on half steps", () => {
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
        expect(wide.across % half).toBe(0);
        expect(onField(wide, 40).across).toBeGreaterThan(before);
        expect(boxDistribution(wide).mode).toBe("outline");
    });

    it("sets across when it's changed, the depth kept and deep following; deep isn't set", () => {
        const p = outline(24, 120, 50);
        const depth = (onField(p, 24).deep - 1) * p.deep;
        const q = withSpacing(p, "across", 2.5, 24, env);
        expect(q.across).toBe(25);
        expect((onField(q, 24).deep - 1) * q.deep).toBeCloseTo(depth, 9);
        expect(withSpacing(p, "deep", 1.5, 24, env, true)).toBe(p);
    });

    it("shows the deep spacing as about so much, not to be changed, and no proportion lock", () => {
        const p = outline(24, 120, 50);
        const layout = chipLayout(boxTool, p, 24, env);
        const deep = layout.intervals.find((x) => x.param.key === "deep")!;
        expect(deep.derived).toBe(true);
        expect(deep.display.startsWith("≈")).toBe(true);
        const across = layout.intervals.find((x) => x.param.key === "across")!;
        expect(across.derived).toBe(false);
        expect(layout.ratioLock).toBe(false);
    });

    it("opens an outline stored before unchanged, and a count change keeps its depth", () => {
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
        expect(fewer.across).toBe(15);
        expect((onField(fewer, 16).deep - 1) * fewer.deep).toBeCloseTo(75, 9);
        expect((boxDistribution(fewer) as OutlineDistribution).mode).toBe(
            "outline",
        );
    });
});

describe("the review of #459", () => {
    /** Yard lines every 8 steps, front sideline and hashes, as the field's lines */
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

    for (const degrees of [15, 30])
        it(`a 24 outline turned ${degrees}°: a pulled stretch puts a corner exactly on a line, no farther than the radius`, () => {
            const flat = outline(24, 120, 80);
            const p: BoxParams = {
                ...flat,
                center: { x: 40, y: -140 },
                rotation: (degrees * Math.PI) / 180,
                across: 15,
                deep: 15,
            };
            const e = boxTool.handles(p, 24).find((h) => h.key === "e")!.at;
            const dir = { x: Math.cos(p.rotation), y: Math.sin(p.rotation) };
            let pulled = 0;
            for (let px = 0; px <= 80; px += 0.5) {
                // The east side dragged out along the box's own across
                const to = { x: e.x + px * dir.x, y: e.y + px * dir.y };
                const out = stretchBox(p, 24, "e", to, lined());
                if (onHalves(out.across)) continue;
                pulled++;
                const corners = boxCorners(out, 24);
                expect(corners.some(onLine), `${px}`).toBe(true);
                const free = boxCorners(
                    stretchBox(p, 24, "e", to, lined({ pull: false })),
                    24,
                );
                const landed = corners
                    .map((c, k) => ({ c, k }))
                    .filter(({ c }) => onLine(c))
                    .map(({ c, k }) =>
                        Math.hypot(c.x - free[k]!.x, c.y - free[k]!.y),
                    );
                // Within the radius of the drag's own interval, plus the ladder's rounding
                expect(Math.min(...landed)).toBeLessThanOrEqual(6 + 3 * half);
            }
            expect(pulled).toBeGreaterThan(0);
        });

    it("a stretch that moves marchers between sides works out who goes where again: no walks cross", () => {
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
        const e = boxTool.handles(t.params, 24).find((h) => h.key === "e")!.at;
        t = press(t, e, env);
        t = pointerMove(t, { x: e.x + 90, y: e.y }, env);
        t = release(t, ctx);
        const after = onField(t.params as BoxParams, 24);
        // The split changed: more across now
        expect(after.across).toBeGreaterThan(before.across);
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

    it("a side handle keeps the other axis's first corner where it was", () => {
        // On half steps first: a switch keeps the space, and the first edit puts it on the grid
        const kept = outline(24, 120, 80);
        const first = boxTool.handles(kept, 24).find((h) => h.key === "e")!.at;
        const p = stretchBox(kept, 24, "e", first, env);
        const top = Math.min(...boxCorners(p, 24).map((c) => c.y));
        const e = boxTool.handles(p, 24).find((h) => h.key === "e")!.at;
        const out = stretchBox(p, 24, "e", { x: e.x + 37, y: e.y }, env);
        expect(Math.min(...boxCorners(out, 24).map((c) => c.y))).toBeCloseTo(
            top,
            9,
        );
    });
});

describe("swapping which way is exact, and the review of the sway build (owner on #459)", () => {
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

    it("the ≈ number makes its way exact, the frame as it was, and the other follows", () => {
        const p = outline(24, 120, 50);
        const before = boxTool.frameOf(p, 24);
        const deep = boxTool.params.find((q) => q.key === "deep")!;
        expect(deep.derived?.(p, 24)).toBe(true);
        const swapped = deep.makeExact!.apply(p, 24) as BoxParams;
        expect(deep.makeExact!.label).toBe("Make front to back exact");
        expect(exactOf(swapped)).toBe("deep");
        expect(boxTool.frameOf(swapped, 24)).toEqual(before);
        const layout = chipLayout(boxTool, swapped, 24, env);
        const shown = (key: string) =>
            layout.intervals.find((x) => x.param.key === key)!;
        expect(shown("deep").derived).toBe(false);
        expect(shown("across").derived).toBe(true);
        expect(shown("across").display.startsWith("≈")).toBe(true);
        // Deep set now: across follows the width, kept
        const width = (onField(swapped, 24).across - 1) * swapped.across;
        const q = withSpacing(swapped, "deep", 2, 24, env);
        expect(q.deep).toBe(20);
        expect((onField(q, 24).across - 1) * q.across).toBeCloseTo(width, 9);
        expect(withSpacing(swapped, "across", 2, 24, env)).toBe(swapped);
        // And back
        const back = boxTool.params
            .find((x) => x.key === "across")!
            .makeExact!.apply(swapped, 24) as BoxParams;
        expect(exactOf(back)).toBe("across");
        expect(boxDistribution(back)).toEqual(boxDistribution(p));
    });

    it("keeps which way is exact through a mode switch and back, and in a saved shape", () => {
        const p = withOutlineExact(outline(24, 120, 50), "deep");
        const files = withMode(boxTool, p, 24, "files", env) as BoxParams;
        const again = withMode(boxTool, files, 24, "outline", env) as BoxParams;
        expect(exactOf(again)).toBe("deep");
        const saved = savedDistributionOf(boxDistribution(p));
        const read = readSavedDistribution(JSON.parse(JSON.stringify(saved)));
        expect(read).toMatchObject({ mode: "outline", exact: "deep" });
        // An outline stored before reads as across
        expect(
            readSavedDistribution({ mode: "outline", oddGap: DEFAULT_ODD_GAP }),
        ).not.toHaveProperty("exact");
    });

    it("holds the split through a wobble at a boundary while the drag goes on", () => {
        const p = outline(40, 100, 100);
        const e = boxTool.handles(p, 40).find((h) => h.key === "e")!.at;
        // Find a boundary: the first px where the split changes
        let last = stretchBox(p, 40, "e", e, env);
        let edge: number | null = null;
        for (let px = 0; px <= 200 && edge === null; px += 0.25) {
            const out = stretchBox(
                p,
                40,
                "e",
                { x: e.x + px, y: e.y },
                env,
                last,
            );
            if (out.files !== last.files) edge = px;
            last = out;
        }
        expect(edge).not.toBeNull();
        // Wobbling 0.05 px either side of it, the split it has now holds
        const held = last.files;
        for (let k = 0; k < 20; k++) {
            const px = edge! + (k % 2 === 0 ? -0.05 : 0.05);
            last = stretchBox(p, 40, "e", { x: e.x + px, y: e.y }, env, last);
            expect(last.files).toBe(held);
        }
    });

    it("never takes the following spacing under half a step, whatever the edit", () => {
        const follows = (q: BoxParams) =>
            q[exactOf(q) === "across" ? "deep" : "across"];
        for (const exact of ["across", "deep"] as const) {
            let q = withOutlineExact(outline(24, 120, 30), exact);
            for (let k = 0; k < 30; k++) {
                // The size's − and + over and over, then spacings, then handles
                q = resizeFiles(q, 24, onField(q, 24).across - 1, env);
                expect(follows(q), `− ${k}`).toBeGreaterThanOrEqual(
                    half - 1e-9,
                );
            }
            for (let k = 0; k < 30; k++) {
                q = resizeFiles(q, 24, onField(q, 24).across + 1, env);
                expect(follows(q), `+ ${k}`).toBeGreaterThanOrEqual(
                    half - 1e-9,
                );
            }
            for (const v of [0.5, 4, 0.5, 3]) {
                q = withSpacing(q, exact, v, 24, env);
                expect(follows(q)).toBeGreaterThanOrEqual(half - 1e-9);
            }
            for (const key of ["s", "e", "se", "n", "w"] as const) {
                const h = boxTool.handles(q, 24).find((x) => x.key === key)!.at;
                const c = boxTool.frameOf(q, 24).center;
                // Pulled right in toward the middle, past it
                const out = stretchBox(q, 24, key, { x: c.x, y: c.y }, env);
                expect(follows(out), key).toBeGreaterThanOrEqual(half - 1e-9);
                const away = stretchBox(
                    q,
                    24,
                    key,
                    { x: h.x + (h.x - c.x), y: h.y + (h.y - c.y) },
                    env,
                );
                expect(follows(away), key).toBeGreaterThanOrEqual(half - 1e-9);
            }
        }
    });

    for (const degrees of [15, 30, 60])
        it(`a turned ${degrees}° outline's depth drag lands a corner on a line within the radius`, () => {
            const p: BoxParams = {
                ...outline(24, 120, 80),
                center: { x: 40, y: -230 },
                rotation: (degrees * Math.PI) / 180,
                across: 15,
                deep: 15,
            };
            const s = boxTool.handles(p, 24).find((h) => h.key === "s")!.at;
            const dir = { x: -Math.sin(p.rotation), y: Math.cos(p.rotation) };
            let pulled = 0;
            for (let px = -30; px <= 60; px += 0.5) {
                const to = { x: s.x + px * dir.x, y: s.y + px * dir.y };
                const out = stretchBox(p, 24, "s", to, lined());
                const free = stretchBox(p, 24, "s", to, lined({ pull: false }));
                if (Math.abs(out.deep - free.deep) < 1e-9) continue;
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

    it("the command bar doesn't ask the ≈ spacing, and marks one typed for it as not applying", () => {
        const p = outline(24, 120, 50);
        const keys = shapeSteps(boxTool, p, 24, env, []).steps.map(
            (st) => st.param.key,
        );
        expect(keys).not.toContain("deep");
        const asked = shapeSteps(boxTool, p, 24, env, ["", "", "", "1.5"]);
        const deep = asked.steps.find((st) => st.param.key === "deep");
        expect(deep?.invalid).toBe(true);
        expect((asked.params as BoxParams).deep).toBe(p.deep);
    });
});
