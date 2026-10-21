import { describe, expect, it } from "vitest";
import { tempoSegments } from "../tempoMath";
import { tempoRegions } from "../tempoSummary";

/** Beat-indexed tempos (beat 0 unused) from runs of [count, bpm] */
const runs = (...parts: [number, number][]) => [
    0,
    ...parts.flatMap(([n, bpm]) => Array<number>(n).fill(bpm)),
];
const regionsOf = (bpms: number[], from = 1, to = bpms.length) =>
    tempoRegions(
        bpms,
        tempoSegments(
            bpms.map((b) => (b > 0 ? 60 / b : 0)),
            1.2,
        ),
        from,
        to,
    ).map((r) => [r.from, r.to, Math.round(r.bpm)]);

describe("tempoRegions", () => {
    it("finds one tempo change", () => {
        expect(regionsOf(runs([160, 138], [152, 112]))).toEqual([
            [1, 161, 138],
            [161, 313, 112],
        ]);
    });

    it("merges the small wobbles a fit to a recording leaves", () => {
        const bpms = runs([40, 138]);
        // a few counts a little off here and there
        bpms[5] = 141;
        bpms[6] = 135.5;
        bpms[20] = 139.8;
        bpms[21] = 136;
        expect(regionsOf(bpms)).toEqual([[1, 41, 138]]);
    });

    it("folds a one-count bump into the tempo around it", () => {
        const bpms = runs([20, 176]);
        bpms[10] = 163;
        expect(regionsOf(bpms)).toEqual([[1, 21, 176]]);
    });

    it("leaves holds out of the tempo", () => {
        const bpms = runs([8, 72], [1, NaN], [8, 72]);
        expect(regionsOf(bpms)).toEqual([[1, 18, 72]]);
    });

    it("keeps to the stretch asked about", () => {
        expect(regionsOf(runs([16, 120], [16, 90]), 5, 21)).toEqual([
            [5, 17, 120],
            [17, 21, 90],
        ]);
    });
});
