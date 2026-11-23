import { describe, expect, it, vi } from "vitest";
import {
    EXACT_DEFAULT_TOLERANCE,
    TICKS_PER_BEAT,
    exactPlayer,
    type ExactMove,
    type ExactPath,
} from "@openmarch/core";
import {
    ExactPathListSchema,
    checkExactPath as checkOmExactPath,
    exactPlayer as omExactPlayer,
} from "@openmarch/schema";
import {
    exactPathEntryOf,
    exactToleranceFor,
    exportExactPaths,
    exactPathInSteps,
    toSteps,
    type StepAxes,
} from "../exact-paths-export";

/** The default field's mapping: 12 px a step, center at x 960, 85.33 steps deep */
const AXES: StepAxes = {
    centerXPixels: 960,
    fieldHeightSteps: 85.33,
    pixelsPerStep: 12,
};

/** A walk with one of each shape, in canvas pixels (y down) */
const MIXED: ExactPath = {
    v: 1,
    from: [600, 500],
    shapes: [
        {
            kind: "points",
            points: [
                [660, 500],
                [660, 440],
            ],
        },
        // a quarter turn bowing one way, then a shallow one bowing the other
        { kind: "arc", to: [720, 380], bend: (Math.SQRT2 - 1) / 2 },
        { kind: "arc", to: [800, 380], bend: -0.2 },
        { kind: "cubic", c1: [840, 300], c2: [900, 460], to: [940, 380] },
    ],
    keys: [
        { tick: 0, u: 0 },
        { tick: 480, u: 0.5 },
        { tick: 960, u: 0.5 },
        { tick: 2400, u: 3 },
        { tick: 3840, u: 5 },
    ],
};

const move = (start: number, end: number, path = MIXED): ExactMove => ({
    marcherId: 7,
    transitionId: 1,
    start,
    end,
    path,
});

describe("exactPathInSteps", () => {
    it("maps every point as the coordinates are mapped", () => {
        expect(toSteps(AXES, 960, 0)).toEqual([0, 85.33]);
        expect(toSteps(AXES, 984, 85.33 * 12)).toEqual([2, 0]);
        const out = exactPathInSteps(MIXED, AXES);
        expect(out.from).toEqual(toSteps(AXES, 600, 500));
        expect(out.shapes[0]).toEqual({
            kind: "points",
            points: [toSteps(AXES, 660, 500), toSteps(AXES, 660, 440)],
        });
        expect(out.shapes[3]).toEqual({
            kind: "cubic",
            c1: toSteps(AXES, 840, 300),
            c2: toSteps(AXES, 900, 460),
            to: toSteps(AXES, 940, 380),
        });
    });

    it("negates each arc's bend and keeps the keys", () => {
        const out = exactPathInSteps(MIXED, AXES);
        expect(out.shapes[1]).toMatchObject({ bend: -(Math.SQRT2 - 1) / 2 });
        expect(out.shapes[2]).toMatchObject({ bend: 0.2 });
        expect(out.keys).toEqual(MIXED.keys);
        expect(checkOmExactPath(out)).toEqual([]);
    });

    it("plays in the schema's reader where the app's path is, at every tick", () => {
        const app = exactPlayer(MIXED);
        const file = omExactPlayer(exactPathInSteps(MIXED, AXES));
        let worst = 0;
        for (let tick = 0; tick <= 3840; tick += 0.5) {
            const [x, y] = app.pointAt(tick);
            const [sx, sy] = toSteps(AXES, x, y);
            const [fx, fy] = file.pointAt(tick);
            worst = Math.max(worst, Math.hypot(fx - sx, fy - sy));
        }
        expect(worst).toBeLessThan(1e-9);
    });

    it("an arc whose bend kept its sign would bow to the wrong side", () => {
        const arc: ExactPath = {
            v: 1,
            from: [0, 0],
            shapes: [{ kind: "arc", to: [120, 0], bend: 0.25 }],
            keys: [
                { tick: 0, u: 0 },
                { tick: 960, u: 1 },
            ],
        };
        const out = exactPathInSteps(arc, AXES);
        // In the app the apex is at +90° from the chord in y-down axes: y = +30 px (down screen)
        const [, appApexY] = exactPlayer(arc).pointAt(480);
        expect(appApexY).toBeCloseTo(30, 9);
        // In the file that is 2.5 steps toward the front, below the chord's y
        const [, fileApexY] = omExactPlayer(out).pointAt(480);
        expect(fileApexY).toBeCloseTo(out.from[1] - 2.5, 9);
    });
});

describe("exactPathEntryOf", () => {
    it("places the path by its span's beats on the show's tick scale", () => {
        const entry = exactPathEntryOf(move(10, 18), AXES)!;
        expect(entry).toMatchObject({
            marcherId: "7",
            startTick: 10 * TICKS_PER_BEAT,
            endTick: 18 * TICKS_PER_BEAT,
        });
        expect(entry.path.keys).toEqual(MIXED.keys);
    });

    it("rounds beats off the tick grid and stretches the keys to fit", () => {
        // 1/7 of a beat is not a whole tick: 68.57 and 3908.57 ticks
        const entry = exactPathEntryOf(move(1 / 7, 8 + 1 / 7), AXES)!;
        expect(entry.startTick).toBe(69);
        expect(entry.endTick).toBe(3909);
        const keys = entry.path.keys;
        expect(keys[keys.length - 1]!.tick).toBe(
            entry.endTick - entry.startTick,
        );
        expect(checkOmExactPath(entry.path)).toEqual([]);
    });

    it("moves that meet share their tick, and the list passes EP-P1 to EP-P3", () => {
        const third = 1 / 3;
        const moves = [
            move(2 + third, 10 + third),
            move(10 + third, 18 + third),
        ];
        const entries = moves.map((m) => exactPathEntryOf(m, AXES)!);
        expect(entries[0]!.endTick).toBe(entries[1]!.startTick);
        expect(ExactPathListSchema.safeParse(entries).success).toBe(true);
    });

    it("leaves out a move shorter than a tick", () => {
        expect(exactPathEntryOf(move(4, 4 + 1 / 2000), AXES)).toBeNull();
    });
});

describe("exportExactPaths", () => {
    /** A walk of `length` canvas pixels to the right, over 8 beats */
    const walkOf = (length: number): ExactPath => ({
        v: 1,
        from: [600, 500],
        shapes: [{ kind: "points", points: [[600 + length, 500]] }],
        keys: [
            { tick: 0, u: 0 },
            { tick: 8 * TICKS_PER_BEAT, u: 1 },
        ],
    });
    const exportWith = (
        movesOf: (marcherId: number) => ExactMove[],
        seen?: { tolerance?: number },
    ) =>
        exportExactPaths(
            { host: {} as never, resolver: {} as never },
            [1, 2, 3],
            AXES,
            {
                makeConverter: (_host, _resolver, options) => {
                    if (seen) seen.tolerance = options.tolerance;
                    return { movesOf };
                },
            },
        );

    it("gives a marcher whose walk can't be converted no paths, and keeps the others", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const entries = await exportWith((marcherId) => {
            if (marcherId === 2) throw new Error("walk doesn't join");
            return [{ ...move(0, 8), marcherId }];
        });
        expect(entries.map((e) => e.marcherId)).toEqual(["1", "3"]);
        expect(errors).toHaveBeenCalledOnce();
        errors.mockRestore();
    });

    it("leaves out a walk too short for the file (EP-6 in steps), keeping the marcher's others", async () => {
        // over the converter's 1e-9 canvas pixels, under the file's 1e-9 steps (12 px a step)
        const entries = await exportWith((marcherId) => [
            { ...move(0, 8, walkOf(5e-9)), marcherId },
            { ...move(8, 16, walkOf(24)), marcherId },
        ]);
        expect(entries.map((e) => [e.marcherId, e.startTick])).toEqual([
            ["1", 8 * TICKS_PER_BEAT],
            ["2", 8 * TICKS_PER_BEAT],
            ["3", 8 * TICKS_PER_BEAT],
        ]);
        expect(ExactPathListSchema.safeParse(entries).success).toBe(true);
    });

    it("gives a marcher whose path the file would refuse no paths, so the show still exports", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const broken: ExactPath = {
            ...walkOf(24),
            keys: [
                { tick: 0, u: 0 },
                { tick: 480, u: 0.8 },
                { tick: 960, u: 0.4 },
                { tick: 3840, u: 1 },
            ],
        };
        const entries = await exportWith((marcherId) => [
            { ...move(0, 8, marcherId === 3 ? broken : walkOf(24)), marcherId },
        ]);
        expect(entries.map((e) => e.marcherId)).toEqual(["1", "2"]);
        expect(errors).toHaveBeenCalledOnce();
        errors.mockRestore();
    });

    it("converts within 1/100 of the show's own step when it's smaller than the default", async () => {
        const seen: { tolerance?: number } = {};
        await exportWith(() => [], seen);
        expect(exactToleranceFor(AXES)).toBe(EXACT_DEFAULT_TOLERANCE);
        expect(seen.tolerance).toBe(EXACT_DEFAULT_TOLERANCE);
        const small = { ...AXES, pixelsPerStep: 6 };
        expect(exactToleranceFor(small)).toBe(0.06);
    });
});
