// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { hasAutoNames } from "@/field/edits/naming";
import GridFieldTemplates, {
    createGridXCheckpoints,
    createGridYCheckpoints,
    gridLineLetters,
} from "../GridFields";

const byPosition = <T extends { stepsFromCenterFront: number }>(list: T[]) =>
    [...list].sort((a, b) => a.stepsFromCenterFront - b.stepsFromCenterFront);

describe("createGridXCheckpoints", () => {
    it("should throw error when xSteps is less than 4", () => {
        expect(() => createGridXCheckpoints({ xSteps: 3 })).toThrow(
            "xSteps must be at least 4",
        );
    });

    it("should create correct checkpoints for minimum xSteps (4)", () => {
        let checkpoints = createGridXCheckpoints({ xSteps: 4 }).sort(
            (a, b) => a.stepsFromCenterFront - b.stepsFromCenterFront,
        );
        expect(checkpoints).toHaveLength(3);
        expect(checkpoints[0].stepsFromCenterFront).toBe(-2);
        expect(checkpoints[1].stepsFromCenterFront).toBe(0);
        expect(checkpoints[2].stepsFromCenterFront).toBe(2);
    });

    it("should create correct checkpoints for 8 steps", () => {
        const checkpoints = createGridXCheckpoints({ xSteps: 8 }).sort(
            (a, b) => a.stepsFromCenterFront - b.stepsFromCenterFront,
        );
        expect(checkpoints).toHaveLength(3);
        expect(checkpoints[0].stepsFromCenterFront).toBe(-4);
        expect(checkpoints[1].stepsFromCenterFront).toBe(0);
        expect(checkpoints[2].stepsFromCenterFront).toBe(4);
    });

    it("should create correct checkpoints for 12 steps", () => {
        const checkpoints = createGridXCheckpoints({ xSteps: 12 }).sort(
            (a, b) => a.stepsFromCenterFront - b.stepsFromCenterFront,
        );
        expect(checkpoints).toHaveLength(5);
        expect(checkpoints.map((c) => c.stepsFromCenterFront)).toEqual([
            -6, -4, 0, 4, 6,
        ]);
        expect(checkpoints.map((c) => c.terseName)).toEqual([
            "LE",
            "4",
            "5",
            "4",
            "RE",
        ]);
    });

    it("should handle non-divisible-by-4 steps", () => {
        const checkpoints = createGridXCheckpoints({ xSteps: 10 });
        expect(checkpoints).toHaveLength(5);
        expect(
            checkpoints
                .map((c) => c.stepsFromCenterFront)
                .sort((a, b) => a - b),
        ).toEqual([-5, -4, 0, 4, 5]);
    });
});
describe("createGridYCheckpoints", () => {
    it("should throw error when ySteps is less than 4", () => {
        expect(() => createGridYCheckpoints({ ySteps: 3 })).toThrow(
            "ySteps must be at least 4",
        );
    });

    it("should create correct checkpoints for minimum ySteps (4)", () => {
        const checkpoints = createGridYCheckpoints({ ySteps: 4 });
        expect(checkpoints).toHaveLength(2);
        expect(checkpoints[0]).toEqual({
            id: 0,
            name: "A line",
            axis: "y",
            terseName: "A",
            stepsFromCenterFront: 0,
            useAsReference: true,
            visible: true,
        });
        expect(checkpoints[1]).toEqual({
            id: 1,
            name: "B line",
            axis: "y",
            terseName: "B",
            stepsFromCenterFront: -4,
            useAsReference: true,
            visible: true,
        });
    });

    it("should create correct checkpoints for 8 steps", () => {
        const checkpoints = createGridYCheckpoints({ ySteps: 8 });
        expect(checkpoints).toHaveLength(3);
        expect(
            checkpoints
                .map((c) => c.stepsFromCenterFront)
                .sort((a, b) => b - a),
        ).toEqual([0, -4, -8]);
        expect(checkpoints.map((c) => c.terseName)).toEqual(["A", "B", "C"]);
    });

    it("should create correct checkpoints for 16 steps", () => {
        const checkpoints = createGridYCheckpoints({ ySteps: 16 });
        expect(checkpoints).toHaveLength(5);
        expect(
            checkpoints
                .map((c) => c.stepsFromCenterFront)
                .sort((a, b) => b - a),
        ).toEqual([0, -4, -8, -12, -16]);
        expect(checkpoints.map((c) => c.name)).toEqual([
            "A line",
            "B line",
            "C line",
            "D line",
            "E line",
        ]);
        expect(checkpoints.map((c) => c.terseName)).toEqual([
            "A",
            "B",
            "C",
            "D",
            "E",
        ]);
    });

    it("should create correct checkpoints for 18 steps", () => {
        const checkpoints = createGridYCheckpoints({ ySteps: 18 });
        expect(checkpoints).toHaveLength(7);
        expect(
            checkpoints
                .map((c) => c.stepsFromCenterFront)
                .sort((a, b) => b - a),
        ).toEqual([0, -1, -5, -9, -13, -17, -18]);
        expect(checkpoints.map((c) => c.name)).toEqual([
            "Front edge",
            "Back edge",
            "A line",
            "B line",
            "C line",
            "D line",
            "E line",
        ]);
    });

    it("should handle non-divisible-by-4 steps with correct warning", () => {
        const consoleSpy = vi.spyOn(console, "warn");
        const checkpoints = createGridYCheckpoints({ ySteps: 6 });
        expect(checkpoints).toHaveLength(4);
        expect(
            checkpoints
                .map((c) => c.stepsFromCenterFront)
                .sort((a, b) => b - a),
        ).toEqual([0, -1, -5, -6]);
        consoleSpy.mockRestore();
    });
});

describe("grid line names past the 0 line and past Z (#1296)", () => {
    it("names side-to-side lines past the 0 line by steps from center on their side", () => {
        // A 100 ft floor at 24-inch steps: 50 steps, 25 to each side
        const lines = byPosition(createGridXCheckpoints({ xSteps: 50 })).filter(
            (c) => c.visible,
        );
        expect(lines.map((c) => c.terseName)).toEqual([
            "S1 24",
            "0",
            "1",
            "2",
            "3",
            "4",
            "5",
            "4",
            "3",
            "2",
            "1",
            "0",
            "S2 24",
        ]);
        expect(lines[0].name).toBe("Side 1 24 steps from center");
        expect(lines.at(-1)!.name).toBe("Side 2 24 steps from center");
    });

    it("never names a line with a negative number, even on the widest floor", () => {
        // 200 ft at 12-inch steps, the widest the custom floor allows
        const lines = createGridXCheckpoints({ xSteps: 200 });
        expect(lines.filter((c) => /-/.test(c.name))).toEqual([]);
        // Past the 0 line, every name is its own (inside it, the sides mirror: two 4 lines)
        const outside = lines.filter(
            (c) => Math.abs(c.stepsFromCenterFront) > 20,
        );
        expect(outside).toHaveLength(40);
        expect(new Set(outside.map((c) => c.name)).size).toBe(outside.length);
    });

    it("gives side-to-side lines the names the field editor would, so they follow a moved line", () => {
        for (const line of createGridXCheckpoints({ xSteps: 200 }))
            if (line.visible)
                expect(
                    hasAutoNames({ useHashes: false }, line),
                    line.name,
                ).toBe(true);
    });

    it("letters front-to-back lines A to Z, then AA, AB…", () => {
        // 200 ft deep at 12-inch steps: a line every 4 steps, 51 lines
        const lines = createGridYCheckpoints({ ySteps: 200 });
        const letters = lines.map((c) => c.terseName);
        expect(letters).toHaveLength(51);
        expect(letters.slice(24, 28)).toEqual(["Y", "Z", "AA", "AB"]);
        expect(letters.at(-1)).toBe("AY");
        expect(lines[26].name).toBe("AA line");
        expect(lines.every((c) => /^[A-Z]+ line$/.test(c.name))).toBe(true);
    });

    it("counts letters as spreadsheet columns do", () => {
        expect(
            [0, 1, 25, 26, 27, 51, 52, 701, 702].map(gridLineLetters),
        ).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
    });

    it("leaves every stock floor's names as they were", () => {
        // No stock floor reaches past the 0 line or past Z, so saved shows and new ones match
        for (const template of Object.values(GridFieldTemplates)) {
            for (const c of template.xCheckpoints)
                expect(["5", "4", "3", "2", "1", "0", "LE", "RE"]).toContain(
                    c.terseName,
                );
            for (const c of template.yCheckpoints)
                expect(c.terseName).toMatch(/^([A-I]|FE|BE)$/);
        }
    });
});
