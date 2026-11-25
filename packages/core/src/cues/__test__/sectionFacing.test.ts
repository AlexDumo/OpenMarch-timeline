import { describe, expect, it } from "vitest";
import {
    compileCues,
    facingAt,
    traceCue,
    type CueInput,
    type CueMarcher,
} from "../index";

/** 16 counts; beat ids 101.. so ids never equal counts. */
const beats = Array.from({ length: 16 }, (_, i) => ({
    id: 101 + i,
    duration: 0.5,
}));
const beatAt = (c: number) => 101 + c;

const bass: CueMarcher = { id: 1, section: "Bass Drum", carries: "battery" };
const trumpet: CueMarcher = { id: 2, section: "Trumpet", carries: "winds" };

const facingCue = (
    id: number,
    count: number,
    value: string,
    marcherIds: readonly number[],
): CueInput => ({
    id,
    type: "facing",
    beatId: beatAt(count),
    value: `builtin:facing.${value}`,
    marcherIds,
});

const sections = [{ name: "Bass Drum", facing: "builtin:facing.side2" }];

describe("section Facing defaults (ADR 0015 D-2)", () => {
    it("has a section's performers face its default before their first Facing cue", () => {
        const compiled = compileCues({
            beats,
            marchers: [bass],
            cues: [],
            sections,
        });
        expect(facingAt(compiled, 1, 0)).toBe(90);
        expect(facingAt(compiled, 1, 10)).toBe(90);
        expect(compiled.segments(1, "facing")[0]!.degrees).toBe(90);
    });

    it("names the section in the trace of a default it shows", () => {
        const compiled = compileCues({
            beats,
            marchers: [bass],
            cues: [],
            sections,
        });
        expect(traceCue(compiled, 1, "facing", 3)).toMatchObject({
            default: {
                source: "section_facing",
                value: "builtin:facing.side2",
                section: "Bass Drum",
            },
        });
    });

    it("keeps front for a section without a default", () => {
        const compiled = compileCues({
            beats,
            marchers: [trumpet],
            cues: [],
            sections,
        });
        expect(facingAt(compiled, 2, 0)).toBe(0);
        expect(traceCue(compiled, 2, "facing", 3).default).toMatchObject({
            source: "library",
            value: "builtin:facing.front",
        });
    });

    it("turns a performer from their section's default when a Facing cue sets it", () => {
        const compiled = compileCues({
            beats,
            marchers: [bass],
            cues: [facingCue(1, 4, "front", [1])],
            sections,
        });
        expect(facingAt(compiled, 1, 3)).toBe(90);
        expect(facingAt(compiled, 1, 4)).toBe(0);
    });

    it("keeps the shorter way from the default for Back", () => {
        const compiled = compileCues({
            beats,
            marchers: [bass],
            cues: [facingCue(1, 4, "back", [1])],
            sections,
        });
        expect(facingAt(compiled, 1, 4)).toBe(180);
    });
});
