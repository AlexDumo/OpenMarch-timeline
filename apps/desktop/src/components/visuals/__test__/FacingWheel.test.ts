import { describe, expect, it } from "vitest";
import { wheelAngle } from "../FacingWheel";

describe("wheelAngle", () => {
    it("reads the wheel as the field: audience down, side 2 right", () => {
        expect(wheelAngle(0, 10)).toBe(0);
        expect(wheelAngle(10, 0)).toBe(90);
        expect(wheelAngle(0, -10)).toBe(180);
        expect(wheelAngle(-10, 0)).toBe(270);
    });

    it("steps when asked", () => {
        expect(wheelAngle(10, 9, 45)).toBe(45);
        expect(wheelAngle(-1, 10, 45)).toBe(0);
    });
});
