import { describe, expect, it } from "vitest";
import {
    compileCues,
    cueLibraryValue,
    facingAt,
    facingDegreesAt,
    facingTargetDegrees,
    nearestEquivalentDegrees,
    type CueInput,
    type CueMarcher,
    type CueSegment,
} from "../index";

/** 32 counts; beat ids 101.. so ids never equal counts. */
const beats = Array.from({ length: 32 }, (_, i) => ({
    id: 101 + i,
    duration: 0.5,
}));
const beatAt = (c: number) => 101 + c;

const trumpet: CueMarcher = { id: 1, section: "Trumpet", carries: "winds" };
const flag: CueMarcher = { id: 2, section: "Flag", carries: "flag" };
const prop: CueMarcher = {
    id: 3,
    section: "Prop",
    carries: "none",
    type: "prop",
};

const facing = (
    id: number,
    count: number,
    value: string,
    marcherIds: readonly number[],
    extra: Partial<CueInput> = {},
): CueInput => ({
    id,
    type: "facing",
    beatId: beatAt(count),
    value: `builtin:facing.${value}`,
    marcherIds,
    ...extra,
});
const angle = (
    id: number,
    count: number,
    degrees: number,
    marcherIds: readonly number[],
    turn?: number,
) =>
    facing(id, count, "angle", marcherIds, {
        settings: { degrees },
        ...(turn !== undefined ? { transition: turn } : {}),
    });

const compile = (cues: readonly CueInput[]) =>
    compileCues({ beats, marchers: [trumpet, flag, prop], cues });

/** A performer's Facing segments as `[from, to, kind, fromDegrees, degrees]`. */
const shape = (segments: readonly CueSegment[]) =>
    segments.map((s) => [s.from, s.to, s.kind, s.fromDegrees, s.degrees]);

describe("Facing angles (#993)", () => {
    it("faces front, 0°, before a performer's first Facing cue", () => {
        const compiled = compile([]);
        expect(facingAt(compiled, 1, 0)).toBe(0);
        expect(facingAt(compiled, 1, 20)).toBe(0);
        expect(compiled.segments(1, "facing")[0]!.degrees).toBe(0);
    });

    it("keeps angles unwrapped: 360° is a spin, −270° ends where 90° does", () => {
        const compiled = compile([
            angle(10, 4, 360, [1], 4),
            angle(11, 4, -270, [2], 4),
        ]);
        expect(facingAt(compiled, 1, 8)).toBe(360);
        expect(facingAt(compiled, 2, 8)).toBe(-270);
        // halfway through, the spin is at 180° and the long way round at −135°
        expect(facingAt(compiled, 1, 6)).toBe(180);
        expect(facingAt(compiled, 2, 6)).toBe(-135);
    });

    it("starts the turn on the cue's count and runs it for its counts", () => {
        const compiled = compile([
            facing(10, 8, "side2", [1], { transition: 2 }),
        ]);
        expect(shape(compiled.segments(1, "facing"))).toEqual([
            [0, 8, "default", undefined, 0],
            [8, 10, "transition", 0, 90],
            [10, 32, "lasting", 90, 90],
        ]);
        expect(facingAt(compiled, 1, 8)).toBe(0);
        expect(facingAt(compiled, 1, 10)).toBe(90);
    });

    it("turns at an even speed: each count turns as far as the last", () => {
        const compiled = compile([
            facing(10, 8, "back", [1], { transition: 4 }),
        ]);
        expect([8, 9, 10, 11, 12].map((c) => facingAt(compiled, 1, c))).toEqual(
            [0, 45, 90, 135, 180],
        );
        expect(facingAt(compiled, 1, 8.5)).toBe(22.5);
    });

    it("is instant until it's given counts", () => {
        const compiled = compile([facing(10, 8, "back", [1])]);
        expect(shape(compiled.segments(1, "facing"))).toEqual([
            [0, 8, "default", undefined, 0],
            [8, 8, "transition", 0, 180],
            [8, 32, "lasting", 180, 180],
        ]);
        expect(compiled.segments(1, "facing")[1]!.snap).toBe(true);
        expect(facingAt(compiled, 1, 7.99)).toBe(0);
        expect(facingAt(compiled, 1, 8)).toBe(180);
    });

    it("turns each performer from their own angle", () => {
        const compiled = compile([
            facing(10, 2, "side2", [1]),
            facing(11, 8, "back", [1, 2], { transition: 2 }),
            facing(12, 16, "turnLeft", [1, 2]),
        ]);
        expect(shape(compiled.segments(1, "facing")).slice(-4, -1)).toEqual([
            [8, 10, "transition", 90, 180],
            [10, 16, "lasting", 180, 180],
            [16, 16, "transition", 180, 225],
        ]);
        expect(shape(compiled.segments(2, "facing")).slice(1, 3)).toEqual([
            [8, 10, "transition", 0, 180],
            [10, 16, "lasting", 180, 180],
        ]);
        expect(facingAt(compiled, 2, 20)).toBe(225);
    });

    it("turns right 45° the other way round", () => {
        const compiled = compile([facing(10, 4, "turnRight", [1])]);
        expect(facingAt(compiled, 1, 8)).toBe(-45);
    });

    it("goes to the nearest equivalent angle from where the performer is", () => {
        const compiled = compile([
            angle(10, 2, 360, [1], 2),
            facing(11, 8, "front", [1]),
            angle(12, 2, 350, [2]),
            facing(13, 8, "side2", [2]),
            facing(14, 12, "back", [2]),
        ]);
        // after a spin, Front stays at 360°: no turn back
        expect(facingAt(compiled, 1, 10)).toBe(360);
        // from 350°, side 2 is 450°, a quarter turn on; then the back is 540°, not 180°
        expect(facingAt(compiled, 2, 10)).toBe(450);
        expect(facingAt(compiled, 2, 14)).toBe(540);
    });

    it("cuts a turn the next cue starts inside, and turns on from where it got to", () => {
        const compiled = compile([
            facing(10, 8, "back", [1], { transition: 4 }),
            facing(11, 10, "front", [1], { transition: 2 }),
        ]);
        expect(shape(compiled.segments(1, "facing"))).toEqual([
            [0, 8, "default", undefined, 0],
            [8, 10, "transition", 0, 90],
            [10, 12, "transition", 90, 0],
            [12, 32, "lasting", 0, 0],
        ]);
        expect(compiled.flags).toEqual([
            { kind: "transition_cut", cueIds: [10, 11], marcherIds: [1] },
        ]);
    });

    it("is lasting only: a momentary Facing cue is ignored and flagged", () => {
        const compiled = compile([facing(10, 8, "back", [1], { length: 2 })]);
        expect(facingAt(compiled, 1, 9)).toBe(0);
        expect(compiled.flags).toEqual([
            { kind: "kind_not_allowed", cueIds: [10], marcherIds: [1] },
        ]);
        expect(cueLibraryValue("builtin:facing.front")).toMatchObject({
            locked: true,
        });
    });

    it("never turns an item", () => {
        const compiled = compile([facing(10, 8, "back", [3])]);
        expect(compiled.segments(3, "facing")).toEqual([]);
    });
});

describe("Facing targets (#993)", () => {
    it("picks the nearest equivalent angle, and the larger one on a tie", () => {
        expect(nearestEquivalentDegrees(0, 0)).toBe(0);
        expect(nearestEquivalentDegrees(0, 359)).toBe(360);
        expect(nearestEquivalentDegrees(90, -100)).toBe(-270);
        expect(nearestEquivalentDegrees(270, 10)).toBe(-90);
        // half a turn either way: the larger, a turn to the left
        expect(nearestEquivalentDegrees(180, 0)).toBe(180);
        expect(nearestEquivalentDegrees(0, 180)).toBe(360);
    });

    it("resolves each value from the angle the performer is at", () => {
        const at = (value: string, from: number, degrees?: number) =>
            facingTargetDegrees(
                `builtin:facing.${value}`,
                degrees === undefined ? {} : { degrees },
                from,
            );
        expect(at("front", 350)).toBe(360);
        expect(at("back", 10)).toBe(180);
        expect(at("side1", 0)).toBe(-90);
        expect(at("side2", 0)).toBe(90);
        expect(at("turnLeft", 90)).toBe(135);
        expect(at("turnRight", 90)).toBe(45);
        expect(at("angle", 90, -270)).toBe(-270);
        // not offered yet: the performer keeps their angle
        expect(at("travel", 30)).toBe(30);
        expect(at("point", 30)).toBe(30);
    });

    it("reads a performer's angle at any time in their segments", () => {
        const segments = compile([
            facing(10, 8, "back", [1], { transition: 4 }),
        ]).segments(1, "facing");
        expect(facingDegreesAt(segments, 0)).toBe(0);
        expect(facingDegreesAt(segments, 10)).toBe(90);
        expect(facingDegreesAt(segments, 40)).toBe(180);
        expect(facingDegreesAt([], 4)).toBe(0);
    });
});
