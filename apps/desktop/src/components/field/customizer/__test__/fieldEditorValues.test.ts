// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Checkpoint } from "@openmarch/core";
import {
    filterSignedNumber,
    filterUnsignedNumber,
    formatNumber,
    isRgbaColor,
    parseNumber,
    parseStepSize,
    sameColor,
    sortedCheckpoints,
} from "../fieldEditorValues";

const checkpoint = (id: number, steps: number): Checkpoint => ({
    id,
    name: `line ${id}`,
    terseName: `${id}`,
    axis: "x",
    stepsFromCenterFront: steps,
    useAsReference: true,
    visible: true,
});

describe("sortedCheckpoints", () => {
    it("sorts by steps on a copy, leaving the list it was given alone", () => {
        const list = Object.freeze([
            checkpoint(0, 8),
            checkpoint(1, -8),
            checkpoint(2, 0),
        ]);
        const sorted = sortedCheckpoints(list);
        expect(sorted.map((c) => c.id)).toEqual([1, 2, 0]);
        expect(list.map((c) => c.id)).toEqual([0, 1, 2]);
        expect(sorted).not.toBe(list);
    });
});

describe("parseStepSize", () => {
    it("takes a positive number", () => {
        expect(parseStepSize("22.5")).toBe(22.5);
        expect(parseStepSize(" 30 ")).toBe(30);
    });

    it("refuses 0, negatives, empty text and non-numbers", () => {
        expect(parseStepSize("0")).toBeUndefined();
        expect(parseStepSize("0.0")).toBeUndefined();
        expect(parseStepSize("-1")).toBeUndefined();
        expect(parseStepSize("")).toBeUndefined();
        expect(parseStepSize(".")).toBeUndefined();
    });
});

describe("number filters", () => {
    it("drops anything but digits and a decimal point", () => {
        expect(filterUnsignedNumber("2a2.5-")).toBe("22.5");
    });

    it("refuses a second decimal point", () => {
        expect(filterUnsignedNumber("1.2.3")).toBeNull();
        expect(filterUnsignedNumber("22..5")).toBeNull();
        expect(filterSignedNumber("-1.2.3")).toBeNull();
    });

    it("keeps a leading minus only", () => {
        expect(filterSignedNumber("--4-.5")).toBe("-4.5");
    });
});

describe("parseNumber", () => {
    it("reads plain decimals", () => {
        expect(parseNumber("57.15")).toBe(57.15);
        expect(parseNumber("-8")).toBe(-8);
        expect(parseNumber(".5")).toBe(0.5);
        expect(parseNumber("1.")).toBe(1);
    });

    it("refuses text that isn't one plain decimal", () => {
        expect(parseNumber("1.2.3")).toBeUndefined();
        expect(parseNumber("12abc")).toBeUndefined();
        expect(parseNumber("1e3")).toBeUndefined();
        expect(parseNumber("-")).toBeUndefined();
        expect(parseNumber("")).toBeUndefined();
    });
});

describe("formatNumber", () => {
    it("drops float noise from unit conversions", () => {
        expect(formatNumber(22.5 * 2.54)).toBe("57.15");
        expect(formatNumber(22.5)).toBe("22.5");
        expect(formatNumber(-8)).toBe("-8");
    });
});

describe("isRgbaColor", () => {
    it("accepts a full color", () => {
        expect(isRgbaColor({ r: 0, g: 128, b: 255, a: 0.5 })).toBe(true);
    });

    it("refuses missing or out-of-range channels", () => {
        expect(isRgbaColor({ r: 0, g: 0, b: 0 })).toBe(false);
        expect(isRgbaColor({ r: 256, g: 0, b: 0, a: 1 })).toBe(false);
        expect(isRgbaColor({ r: 0, g: 0, b: 0, a: 2 })).toBe(false);
        expect(isRgbaColor(undefined)).toBe(false);
    });

    it("compares colors by value", () => {
        expect(
            sameColor({ r: 1, g: 2, b: 3, a: 1 }, { r: 1, g: 2, b: 3, a: 1 }),
        ).toBe(true);
        expect(
            sameColor({ r: 1, g: 2, b: 3, a: 1 }, { r: 1, g: 2, b: 3, a: 0 }),
        ).toBe(false);
    });
});
