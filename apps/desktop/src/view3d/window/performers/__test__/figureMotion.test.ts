import { describe, expect, it } from "vitest";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type { MarcherTimeline } from "@/utilities/Keyframes";
import { buildPerformerSlots, writePerformerPositions } from "../performerData";
import {
    buildStepClock,
    lerpAngle,
    stepPhaseAt,
    writeFigureMotion,
    type FigureRows,
} from "../figureMotion";

const field = FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;

/** Two pages of four half-second counts, the second starting at 2 s. */
const clock = buildStepClock([
    {
        beats: [0, 0.5, 1, 1.5].map((t) => ({ timestamp: t, duration: 0.5 })),
    },
    {
        beats: [2, 2.5, 3, 3.5].map((t) => ({ timestamp: t, duration: 0.5 })),
    },
]);

describe("stepPhaseAt", () => {
    it("lands the left foot on odd counts and the right on even", () => {
        expect(stepPhaseAt(clock, 0)).toBeCloseTo(0);
        expect(stepPhaseAt(clock, 500)).toBeCloseTo(0.5); // count 1: left
        expect(stepPhaseAt(clock, 1000)).toBeCloseTo(0); // count 2: right
        expect(stepPhaseAt(clock, 750)).toBeCloseTo(0.75);
    });

    it("restarts on each page, so count 1 is always the left foot", () => {
        expect(stepPhaseAt(clock, 2000)).toBeCloseTo(0);
        expect(stepPhaseAt(clock, 2500)).toBeCloseTo(0.5);
    });

    it("keeps stepping past the last beat and without beats", () => {
        const past = stepPhaseAt(clock, 4250);
        expect(past).toBeGreaterThanOrEqual(0);
        expect(past).toBeLessThan(1);
        const empty = buildStepClock([]);
        expect(stepPhaseAt(empty, 500)).toBeCloseTo(0.5);
    });
});

describe("lerpAngle", () => {
    it("turns the short way round", () => {
        expect(lerpAngle(0.1, -0.1, 0.5)).toBeCloseTo(0);
        expect(
            Math.abs(lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5)),
        ).toBeCloseTo(Math.PI);
    });
});

/** A marcher holding at pixel (x, y) and then moving +x in pixels. */
function timeline(points: [number, number, number][]): MarcherTimeline {
    return {
        pathMap: new Map(points.map(([t, x, y]) => [t, { x, y }])),
        sortedTimestamps: points.map(([t]) => t),
    };
}

const rows: FigureRows = { hold: 0, march: 1, marchSamples: 48 };

function run(ms: number, timelines: Map<number, MarcherTimeline>) {
    const slots = buildPerformerSlots([...timelines.keys()], timelines);
    const n = slots.ids.length;
    const xz = new Float32Array(n * 2);
    const placed = new Uint8Array(n);
    writePerformerPositions(
        slots,
        ms,
        field,
        new Uint8Array(n).fill(1),
        xz,
        placed,
    );
    const matrices = new Float32Array(n * 16);
    const anim = new Float32Array(n * 3);
    writeFigureMotion(slots, ms, field, xz, placed, 0.25, rows, matrices, anim);
    return { matrices, anim, xz };
}

describe("writeFigureMotion", () => {
    // Holds 0–1 s, moves 100 px toward side 2 (+x) over 1–3 s, then holds.
    const mover = timeline([
        [0, 500, 400],
        [1000, 500, 400],
        [3000, 600, 400],
        [5000, 600, 400],
    ]);
    const timelines = new Map([[1, mover]]);

    it("holds facing the front while still", () => {
        const { matrices, anim } = run(500, timelines);
        expect(anim[2]).toBe(0);
        expect(anim[0]).toBe(rows.hold);
        // Identity rotation: facing +Z.
        expect(matrices[0]).toBeCloseTo(1);
        expect(matrices[10]).toBeCloseTo(1);
        expect(matrices[15]).toBe(1);
    });

    it("marches facing the direction of travel mid-move", () => {
        const { matrices, anim, xz } = run(2000, timelines);
        expect(anim[2]).toBeCloseTo(1, 4);
        // Phase 0.25 of 48 samples, after the hold row.
        expect(anim[1]).toBe(rows.march + 12);
        // Facing +X: the model's +Z axis maps to +X.
        expect(matrices[8]).toBeCloseTo(1);
        expect(matrices[10]).toBeCloseTo(0);
        expect(matrices[12]).toBeCloseTo(xz[0]);
        expect(matrices[14]).toBeCloseTo(xz[1]);
    });

    it("eases in over the window as the move starts", () => {
        const weight = (ms: number) => run(ms, timelines).anim[2];
        expect(weight(1000 - 125)).toBeCloseTo(0, 2);
        expect(weight(1000 - 62.5)).toBeCloseTo(0.25, 2);
        expect(weight(1000)).toBeCloseTo(0.5, 2);
        expect(weight(1000 + 62.5)).toBeCloseTo(0.75, 2);
        expect(weight(1000 + 125)).toBeCloseTo(1, 2);
    });

    it("eases out as the move stops", () => {
        const weight = (ms: number) => run(ms, timelines).anim[2];
        expect(weight(3000 - 125)).toBeCloseTo(1, 2);
        expect(weight(3000)).toBeCloseTo(0.5, 2);
        expect(weight(3000 + 125)).toBeCloseTo(0, 2);
    });

    it("draws nothing for an unplaced performer", () => {
        const empty = new Map([[1, timeline([])]]);
        const { matrices } = run(500, empty);
        expect(matrices.every((v) => v === 0)).toBe(true);
    });
});
