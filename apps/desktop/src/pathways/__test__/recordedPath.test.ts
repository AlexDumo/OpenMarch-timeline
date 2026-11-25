import { describe, expect, it } from "vitest";
import { checkExactPath, exactPointAt } from "@openmarch/core";
import {
    exactPathFromSamples,
    withEvenSpeed,
    type RecordedSample,
} from "../recordedPath";

const TOL = 0.1125; // 1/100 of a default step, in field units
const TICKS = 16 * 480;

/** A hand-like take: a wobble, a loop, a pause, uneven speed; a sample every 1/60 s at 120 BPM */
function take(): RecordedSample[] {
    const out: RecordedSample[] = [];
    for (let tick = 0; tick <= TICKS; tick += 16) {
        const t = tick / TICKS;
        const paused = t > 0.6 && t < 0.7;
        const u = paused ? 0.6 : t;
        out.push({
            tick,
            x: 100 + 300 * u + 20 * Math.sin(u * 40),
            y:
                200 +
                80 * Math.sin(u * Math.PI * 2) +
                (tick % 32 === 0 ? 0.05 : 0),
        });
    }
    return out;
}

describe("exactPathFromSamples (Record path)", () => {
    it("keeps the rules of an exact path", () => {
        const path = exactPathFromSamples(take(), TICKS, TOL)!;
        expect(checkExactPath(path)).toEqual([]);
        expect(path.keys.at(-1)!.tick).toBe(TICKS);
    });

    it("puts the marcher where it was dragged at every sample, within the tolerance", () => {
        const samples = take();
        const path = exactPathFromSamples(samples, TICKS, TOL)!;
        let worst = 0;
        for (const s of samples) {
            const [x, y] = exactPointAt(path, s.tick);
            worst = Math.max(worst, Math.hypot(x - s.x, y - s.y));
        }
        expect(worst).toBeLessThanOrEqual(TOL + 1e-9);
    });

    it("adds no easing: a steady straight drag is one leg at steady speed", () => {
        const samples: RecordedSample[] = [];
        for (let tick = 0; tick <= TICKS; tick += 16)
            samples.push({ tick, x: tick / 10, y: 50 });
        const path = exactPathFromSamples(samples, TICKS, TOL)!;
        expect(path.keys).toEqual([
            { tick: 0, u: 0 },
            { tick: TICKS, u: 1 },
        ]);
    });

    it("keeps a pause as a hold: two keys at one place", () => {
        const samples: RecordedSample[] = [
            { tick: 0, x: 0, y: 0 },
            { tick: 960, x: 50, y: 0 },
            { tick: 1920, x: 50, y: 0 },
            { tick: 3840, x: 50, y: 100 },
        ];
        const path = exactPathFromSamples(samples, 3840, TOL)!;
        expect(path.keys).toEqual([
            { tick: 0, u: 0 },
            { tick: 960, u: 1 },
            { tick: 1920, u: 1 },
            { tick: 3840, u: 2 },
        ]);
        expect(checkExactPath(path)).toEqual([]);
    });

    it("stretches a take that starts late or stops early over the whole move", () => {
        const path = exactPathFromSamples(
            [
                { tick: 300.4, x: 0, y: 0 },
                { tick: 2000, x: 40, y: 30 },
            ],
            4000,
            TOL,
        )!;
        expect(path.keys[0]).toEqual({ tick: 0, u: 0 });
        expect(path.keys.at(-1)).toEqual({ tick: 4000, u: 1 });
        expect(checkExactPath(path)).toEqual([]);
    });

    it("is null when the marcher never moved (EP-6)", () => {
        expect(
            exactPathFromSamples(
                [
                    { tick: 0, x: 5, y: 5 },
                    { tick: 900, x: 5, y: 5 },
                ],
                960,
                TOL,
            ),
        ).toBeNull();
    });
});

describe("withEvenSpeed (Make speed even)", () => {
    it("walks the same shape at one steady speed", () => {
        const path = exactPathFromSamples(take(), TICKS, TOL)!;
        const even = withEvenSpeed(path);
        expect(even.shapes).toBe(path.shapes);
        expect(even.keys).toEqual([
            { tick: 0, u: 0 },
            { tick: TICKS, u: path.keys.at(-1)!.u },
        ]);
        expect(checkExactPath(even)).toEqual([]);
    });
});
