// @vitest-environment node
// cspell:ignore Panini hfov vfov
import { describe, expect, it } from "vitest";
import {
    centerSharpness,
    eyeLiftGain,
    mixLens,
    paniniColumnTable,
    paniniForward,
    paniniFrame,
    paniniInverse,
    paniniSourceSize,
    rectilinearHfovDeg,
    screenToSource,
    sourceToScreen,
} from "../panini";
import { SEAT_VIEW_DEFAULTS } from "../seatViewPass";

const DEG = Math.PI / 180;
const LENSES = [
    { d: 0, s: 0 },
    { d: 0.5, s: 0 },
    { d: 1, s: 0 },
    { d: 1, s: 0.25 },
    { d: 1, s: 1 },
    { d: 0.7, s: 0.5 },
];

describe("Panini projection", () => {
    it("round-trips forward and inverse across a wide view", () => {
        for (const lens of LENSES)
            for (let az = -75; az <= 75; az += 5)
                for (let el = -50; el <= 50; el += 10) {
                    const u = Math.tan(az * DEG);
                    const v = Math.tan(el * DEG) / Math.cos(az * DEG);
                    const [x, y] = paniniForward(u, v, lens);
                    const [u2, v2] = paniniInverse(x, y, lens);
                    expect(u2).toBeCloseTo(u, 9);
                    expect(v2).toBeCloseTo(v, 9);
                }
    });

    it("keeps scale 1 at the middle", () => {
        const h = 1e-5;
        for (const lens of LENSES) {
            const [x] = paniniForward(h, 0, lens);
            const [, y] = paniniForward(0, h, lens);
            expect(x / h).toBeCloseTo(1, 6);
            expect(y / h).toBeCloseTo(1, 6);
        }
    });

    it("is rectilinear at d = 0, s = 0", () => {
        const [x, y] = paniniForward(1.3, -0.4, { d: 0, s: 0 });
        expect(x).toBeCloseTo(1.3, 12);
        expect(y).toBeCloseTo(-0.4, 12);
    });

    it("keeps verticals straight", () => {
        // A vertical world line at azimuth 50°: every point lands on one x.
        const lens = { d: 1, s: 0.25 };
        const u = Math.tan(50 * DEG);
        const xs = [-0.8, -0.2, 0, 0.5, 1.1].map(
            (v) => paniniForward(u, v, lens)[0],
        );
        for (const x of xs) expect(x).toBeCloseTo(xs[0], 12);
    });

    it("compresses the sides less than a wide rectilinear camera stretches them", () => {
        // Horizontal scale at 50° off center, relative to the middle.
        const lens = { d: 1, s: 0 };
        const az = 50 * DEG;
        const h = 1e-5;
        const at = (a: number) => paniniForward(Math.tan(a), 0, lens)[0];
        const panini = (at(az + h) - at(az - h)) / (2 * h);
        const rectilinear = 1 / Math.cos(az) ** 2;
        expect(panini).toBeGreaterThan(1);
        expect(panini).toBeLessThan(1.5);
        expect(rectilinear).toBeGreaterThan(2.4);
    });
});

describe("paniniFrame", () => {
    it("matches a plain camera when the lens is off", () => {
        const aspect = 1.6;
        const hfov = rectilinearHfovDeg(45, aspect);
        const f = paniniFrame({ hfovDeg: hfov, aspect, d: 0, s: 0 });
        expect(f.halfY).toBeCloseTo(Math.tan(22.5 * DEG), 9);
        expect(f.sourceTanX).toBeCloseTo(f.halfX, 9);
        expect(f.sourceTanY).toBeCloseTo(f.halfY, 9);
        const [nx, ny] = sourceToScreen(0.3, -0.2, f);
        expect(nx).toBeCloseTo(0.3 / f.halfX, 9);
        expect(ny).toBeCloseTo(-0.2 / f.halfY, 9);
    });

    it("covers the whole picture with its source", () => {
        const f = paniniFrame({ hfovDeg: 105, aspect: 1.6, d: 1, s: 0.25 });
        for (let i = -10; i <= 10; i++)
            for (let j = -10; j <= 10; j++) {
                const [u, v] = screenToSource(i / 10, j / 10, f);
                expect(Math.abs(u)).toBeLessThanOrEqual(f.sourceTanX + 1e-9);
                expect(Math.abs(v)).toBeLessThanOrEqual(f.sourceTanY + 1e-9);
            }
        expect(f.sourceTanX).toBeCloseTo(Math.tan(52.5 * DEG), 9);
    });

    it("maps picture points to source directions and back", () => {
        const f = paniniFrame({ hfovDeg: 105, aspect: 1.6, d: 1, s: 0.25 });
        for (const [nx, ny] of [
            [0, 0],
            [0.9, 0.1],
            [-0.6, -0.95],
            [1, 1],
        ]) {
            const [u, v] = screenToSource(nx, ny, f);
            const [bx, by] = sourceToScreen(u, v, f);
            expect(bx).toBeCloseTo(nx, 9);
            expect(by).toBeCloseTo(ny, 9);
        }
    });

    it("narrows the view in a tall window rather than look too far up and down", () => {
        const f = paniniFrame({
            hfovDeg: 105,
            aspect: 0.6,
            d: 1,
            s: 0,
            maxVfovDeg: 85,
        });
        expect(Math.atan(f.halfY) * 2).toBeCloseTo(85 * DEG, 9);
        expect(f.halfX / f.halfY).toBeCloseTo(0.6, 9);
    });

    it("sizes the source so the middle is as sharp as a plain camera", () => {
        const f = paniniFrame({ hfovDeg: 105, aspect: 1.6, d: 1, s: 0.25 });
        const [w, h] = paniniSourceSize(1600, 1000, f, 1, 8192);
        expect(centerSharpness(1600, w, f)).toBeGreaterThanOrEqual(1);
        expect(centerSharpness(1600, w, f)).toBeLessThan(1.01);
        expect(w / h).toBeCloseTo(f.sourceTanX / f.sourceTanY, 2);
        const [w2] = paniniSourceSize(1600, 1000, f, 0.8, 8192);
        expect(centerSharpness(1600, w2, f)).toBeCloseTo(0.8, 2);
        const [w3, h3] = paniniSourceSize(1600, 1000, f, 1, 1024);
        expect(Math.max(w3, h3)).toBeLessThanOrEqual(1024);
    });
});

describe("paniniColumnTable", () => {
    it("gives each pixel the source point the closed form does", () => {
        const f = paniniFrame({ hfovDeg: 105, aspect: 1.6, d: 1, s: 0.25 });
        const width = 320;
        const table = paniniColumnTable(width, f);
        for (const i of [0, 37, 160, 250, 319])
            for (const ndcY of [-1, -0.3, 0.6, 1]) {
                const ndcX = ((i + 0.5) / width) * 2 - 1;
                const [u, v] = screenToSource(ndcX, ndcY, f);
                const sx = table[i * 4];
                const sy = 0.5 + ndcY * table[i * 4 + 1];
                expect(sx).toBeCloseTo((u / f.sourceTanX) * 0.5 + 0.5, 6);
                expect(sy).toBeCloseTo((v / f.sourceTanY) * 0.5 + 0.5, 6);
            }
        // The step to the next column, for the footprint.
        expect(table[37 * 4 + 2]).toBeCloseTo(table[38 * 4] - table[37 * 4], 6);
    });
});

describe("mixLens and the eye lift", () => {
    it("blends from a plain camera to the lens", () => {
        expect(mixLens({ d: 1, s: 0.25 }, 0)).toEqual({ d: 0, s: 0 });
        expect(mixLens({ d: 1, s: 0.25 }, 0.5)).toEqual({ d: 0.5, s: 0.125 });
    });

    it("lifts shadows and leaves the bright field nearly as it was", () => {
        const { lift, liftKnee } = SEAT_VIEW_DEFAULTS;
        expect(eyeLiftGain(0, lift, liftKnee)).toBeCloseTo(1 + lift, 9);
        expect(eyeLiftGain(0.01, lift, liftKnee)).toBeGreaterThan(1.3);
        expect(eyeLiftGain(0.5, lift, liftKnee)).toBeLessThan(1.05);
        expect(eyeLiftGain(0.5, 0, liftKnee)).toBe(1);
    });
});
