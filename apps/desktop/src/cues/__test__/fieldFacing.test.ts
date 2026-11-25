// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DatabaseCue } from "@/db-functions/cues";
import { marcherCueInputs } from "@/view3d/core/marchers/cueInputs";
import { compileShowCues } from "../showCues";
import { facingAt } from "@openmarch/core";
import {
    cueClockAtBeat,
    facingVector,
    writeFacingDirections,
} from "../fieldFacing";

/** Three trumpets over 16 counts. Beat 0 is the fixed first beat; counts 0–15 are ids 100–115. */
const MARCHERS = [1, 2, 3].map((id) => ({ id, section: "Trumpet" }));
const BEATS = [
    { id: 1, position: 0, duration: 0 },
    ...Array.from({ length: 16 }, (_, c) => ({
        id: 100 + c,
        position: c + 1,
        duration: 0.5,
    })),
];
const beatOf = (count: number) => 100 + count;

let nextId = 1;
const facing = (
    count: number,
    value: string,
    marcherIds: number[],
    extra: Partial<DatabaseCue> = {},
): DatabaseCue => ({
    id: nextId++,
    type: "facing",
    beatId: beatOf(count),
    value,
    settings: {},
    length: null,
    transition: null,
    marcherIds,
    label: null,
    notes: null,
    createdAt: "",
    updatedAt: "",
    ...extra,
});

/** Performer 1 turns to Back over 4 counts landing on count 8; 2 snaps to Side 2 on count 4. */
const show = compileShowCues(MARCHERS, BEATS, [
    facing(8, "builtin:facing.back", [1], { transition: 4 }),
    facing(4, "builtin:facing.side2", [2]),
]);
const clockAt = (beat: number) => cueClockAtBeat(BEATS, show.countOfBeat, beat);

describe("the field's count clock (#1316)", () => {
    it("starts count 0 at spec beat 1, after the zero-length beat 0", () => {
        expect(clockAt(0)).toBe(0);
        expect(clockAt(0.5)).toBe(0);
        expect(clockAt(1)).toBe(0);
        expect(clockAt(1.5)).toBe(0.5);
        expect(clockAt(9)).toBe(8);
    });

    it("runs on past the stored beats", () => {
        expect(clockAt(BEATS.length)).toBe(16);
        expect(clockAt(BEATS.length + 2.5)).toBe(18.5);
    });
});

/** The facing the field's arrow shows for performer `id` at spec beat `beat`, in degrees. */
const degreesAt = (id: number, beat: number) =>
    facingAt(show.compiled, id, clockAt(beat));

describe("facing on the field (#1316)", () => {
    it("faces front before a performer's first cue, and with no cue at all", () => {
        expect(degreesAt(1, 2)).toBe(0);
        expect(degreesAt(3, 9)).toBe(0);
    });

    it("turns evenly through a transition and lands on the cue's count", () => {
        // the cue is on count 8, spec beat 9
        expect(degreesAt(1, 9)).toBe(180);
        expect(degreesAt(1, 15)).toBe(180);
        const mid = degreesAt(1, 7.5);
        expect(mid).toBeGreaterThan(0);
        expect(mid).toBeLessThan(180);
        // part way is between its neighbors
        expect(degreesAt(1, 7)).toBeLessThan(mid);
        expect(degreesAt(1, 8)).toBeGreaterThan(mid);
    });

    it("lands an instant cue on its count", () => {
        expect(degreesAt(2, 4.9)).toBe(0);
        expect(degreesAt(2, 5)).toBe(90);
    });

    it("agrees with the 3D View's headings at every count", () => {
        const K = 16;
        const positions = new Float64Array((K + 1) * 2);
        for (const id of [1, 2]) {
            const { heading } = marcherCueInputs(show.compiled, id, positions);
            for (let b = 1; b <= K; b++)
                expect(degreesAt(id, b) * (Math.PI / 180)).toBeCloseTo(
                    heading[b],
                    9,
                );
        }
    });
});

describe("drawing it", () => {
    it("points 0° at the audience (down the screen) and 90° at side 2 (screen right)", () => {
        const [fx, fy] = facingVector(0);
        expect(fx).toBeCloseTo(0);
        expect(fy).toBeCloseTo(1);
        const [sx, sy] = facingVector(90);
        expect(sx).toBeCloseTo(1);
        expect(sy).toBeCloseTo(0);
        const [bx, by] = facingVector(180);
        expect(bx).toBeCloseTo(0);
        expect(by).toBeCloseTo(-1);
    });

    it("writes a direction per id, front included, and zero for those that can't face", () => {
        const out = new Float32Array(6).fill(9);
        writeFacingDirections({
            compiled: show.compiled,
            ids: [1, 2, 3],
            clock: clockAt(9),
            include: (id) => id !== 2,
            out,
        });
        // 1 faces back (up the screen), 2 is left out, 3 faces front (down the screen)
        expect(out[0]).toBeCloseTo(0);
        expect(out[1]).toBeCloseTo(-1);
        expect([...out.slice(2, 4)]).toEqual([0, 0]);
        expect(out[4]).toBeCloseTo(0);
        expect(out[5]).toBeCloseTo(1);
    });
});
