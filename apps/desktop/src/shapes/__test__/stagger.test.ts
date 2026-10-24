import { describe, expect, it } from "vitest";
import {
    parseStagger,
    snapStagger,
    staggerAmount,
    staggerReadout,
    stepStagger,
} from "../distribute/stagger";

/** The stagger slider's detents, readout and typed answers (#388) */

describe("snapping", () => {
    it("rests on 0, ±⅙, ±¼, ±⅓ and ±½", () => {
        expect(snapStagger(0.02, false)).toEqual([0, 1]);
        expect(snapStagger(0.15, false)).toEqual([1, 6]);
        expect(snapStagger(0.26, false)).toEqual([1, 4]);
        expect(snapStagger(-0.31, false)).toEqual([-1, 3]);
        expect(snapStagger(0.47, false)).toEqual([1, 2]);
        expect(snapStagger(-0.9, false)).toEqual([-1, 2]);
    });

    it("lands on hundredths with Alt, held to ±½", () => {
        expect(snapStagger(0.372, true)).toEqual([37, 100]);
        expect(snapStagger(0.25, true)).toEqual([1, 4]);
        expect(snapStagger(0.7, true)).toEqual([1, 2]);
        expect(snapStagger(-0.001, true)).toEqual([0, 1]);
    });

    it("steps to the next detent, or a hundredth with Alt", () => {
        expect(stepStagger([0, 1], 1, false)).toEqual([1, 6]);
        expect(stepStagger([1, 4], -1, false)).toEqual([1, 6]);
        expect(stepStagger([37, 100], 1, false)).toEqual([1, 2]);
        expect(stepStagger([37, 100], -1, false)).toEqual([1, 3]);
        expect(stepStagger([1, 2], 1, false)).toEqual([1, 2]);
        expect(stepStagger([1, 4], 1, true)).toEqual([13, 50]);
    });
});

describe("the readout", () => {
    it("says the side and how often the ranks line up", () => {
        expect(staggerReadout([1, 3])).toBe("⅓ right · lines up every 3 ranks");
        expect(staggerReadout([-1, 2])).toBe("½ left · lines up every 2 ranks");
        expect(staggerReadout([2, 12])).toBe(
            "⅙ right · lines up every 6 ranks",
        );
        expect(staggerReadout([5, 12])).toBe(
            "5/12 right · lines up every 12 ranks",
        );
        expect(staggerReadout([37, 100])).toBe("0.37 right");
        expect(staggerReadout([0, 1])).toBe("Straight");
    });
});

describe("typed answers", () => {
    it("reads fractions, glyphs, sides and decimals", () => {
        expect(parseStagger("1/3")).toEqual([1, 3]);
        expect(parseStagger("-1/2")).toEqual([-1, 2]);
        expect(parseStagger("2/6")).toEqual([1, 3]);
        expect(parseStagger("⅓ left")).toEqual([-1, 3]);
        expect(parseStagger("1/4 right")).toEqual([1, 4]);
        expect(parseStagger("0.33")).toEqual([1, 3]);
        expect(parseStagger("-.25")).toEqual([-1, 4]);
        expect(parseStagger("0.37")).toEqual([37, 100]);
        expect(parseStagger("0")).toEqual([0, 1]);
        expect(parseStagger("none")).toEqual([0, 1]);
    });

    it("refuses more than ½ and what isn't a stagger", () => {
        expect(parseStagger("2/3")).toBeNull();
        expect(parseStagger("0.6")).toBeNull();
        expect(parseStagger("1/0")).toBeNull();
        expect(parseStagger("-1/3 left")).toBeNull();
        expect(parseStagger("stagger")).toBeNull();
        expect(parseStagger("")).toBeNull();
    });

    it("reads back what the bar shows", () => {
        for (const f of [
            [1, 2],
            [-1, 3],
            [1, 6],
            [-37, 100],
            [0, 1],
        ] as const)
            expect(parseStagger(staggerAmount(f))).toEqual(f);
    });
});
