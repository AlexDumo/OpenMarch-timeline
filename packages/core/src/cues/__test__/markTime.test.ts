import { describe, expect, it } from "vitest";
import {
    compileCues,
    holdStyleAt,
    type CompileInput,
    type CueInput,
    type CueMarcher,
    type HoldStyleSpan,
} from "../index";

/** 16 counts; beat ids 201.. so ids never equal counts. */
const beats = Array.from({ length: 16 }, (_, i) => ({
    id: 201 + i,
    duration: 0.5,
}));
const performer = (id: number): CueMarcher => ({
    id,
    section: "Trumpet",
    carries: "winds",
});
const snare = performer(1);
const trumpet = performer(2);
const prop: CueMarcher = { ...performer(3), type: "prop" };

/** The snare holds all show; the trumpet moves on counts 4–7 and 12–13. */
const travels = (id: number, c: number) =>
    id === trumpet.id && ((c >= 4 && c < 8) || c === 12 || c === 13);

const onHoldsAt = (spans: readonly HoldStyleSpan[], c: number) =>
    holdStyleAt(spans, c);

const compile = (extra: Partial<CompileInput> = {}) =>
    compileCues({
        beats,
        marchers: [snare, trumpet, prop],
        cues: [],
        travels,
        ...extra,
    });

describe("automatic mark time (the show's hold style)", () => {
    it("marks time on counts where anyone travels, and stands while the whole band holds", () => {
        const feet = compile().holdStyle(snare.id);
        expect(onHoldsAt(feet, 0)).toBe("stand");
        expect(onHoldsAt(feet, 3)).toBe("stand");
        expect(onHoldsAt(feet, 4)).toBe("markTime");
        expect(onHoldsAt(feet, 7)).toBe("markTime");
        expect(onHoldsAt(feet, 8)).toBe("stand");
        expect(onHoldsAt(feet, 12)).toBe("markTime");
        expect(onHoldsAt(feet, 14)).toBe("stand");
        // the spans cover the show, one per change
        expect(feet.map((s) => [s.from, s.to])).toEqual([
            [0, 4],
            [4, 8],
            [8, 12],
            [12, 14],
            [14, 16],
        ]);
        // every performer gets the same style
        expect(compile().holdStyle(trumpet.id)).toEqual(feet);
    });

    it("doesn't count a prop's travel as the band moving", () => {
        const feet = compile({
            travels: (id) => id === prop.id,
        }).holdStyle(snare.id);
        expect(feet).toHaveLength(1);
        expect(onHoldsAt(feet, 5)).toBe("stand");
    });

    it("reads bandTravels when given, over travels", () => {
        const feet = compile({ bandTravels: (c) => c === 2 }).holdStyle(
            snare.id,
        );
        expect(onHoldsAt(feet, 2)).toBe("markTime");
        expect(onHoldsAt(feet, 5)).toBe("stand");
    });

    it("takes the show's own hold technique, or stands throughout", () => {
        const high = compile({
            showDefaults: { holdWhileBandMoves: "highMarkTime" },
        }).holdStyle(snare.id);
        expect(onHoldsAt(high, 5)).toBe("highMarkTime");
        const stand = compile({
            showDefaults: { holdWhileBandMoves: "stand" },
        }).holdStyle(snare.id);
        expect(stand).toHaveLength(1);
        expect(onHoldsAt(stand, 5)).toBe("stand");
    });

    it("stands everywhere without travel information", () => {
        const feet = compile({ travels: undefined }).holdStyle(snare.id);
        expect(feet).toHaveLength(1);
        expect(onHoldsAt(feet, 5)).toBe("stand");
    });

    it("is no cue's business: a cue of any type leaves it alone (ADR 0015 D-1)", () => {
        const kneel: CueInput = {
            id: 9,
            type: "posture",
            beatId: 201 + 2,
            value: "builtin:posture.kneel",
            marcherIds: [snare.id],
        };
        const feet = compile({ cues: [kneel] }).holdStyle(snare.id);
        expect(feet).toEqual(compile().holdStyle(snare.id));
    });

    it("covers a show with no counts", () => {
        expect(compile({ beats: [] }).holdStyle(snare.id)).toEqual([
            { from: 0, to: 0, style: "stand" },
        ]);
    });
});
