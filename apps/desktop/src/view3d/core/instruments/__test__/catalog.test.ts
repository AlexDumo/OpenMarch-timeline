import { describe, expect, it } from "vitest";
import { carryForSection } from "../catalog";

describe("section to instrument", () => {
    it("maps the brass sections", () => {
        expect(carryForSection("Trumpet")).toEqual({
            model: "trumpet",
            family: "brass",
        });
        expect(carryForSection("Mellophone")).toEqual({
            model: "mellophone",
            family: "brass",
        });
        expect(carryForSection("Baritone")).toEqual({
            model: "baritone",
            family: "brass",
        });
        expect(carryForSection("Euphonium")).toEqual({
            model: "euphonium",
            family: "brass",
        });
        expect(carryForSection("Trombone")).toEqual({
            model: "trombone",
            family: "trombone",
        });
        expect(carryForSection("Bass Trombone")).toEqual({
            model: "bassTrombone",
            family: "trombone",
        });
        expect(carryForSection("Tuba")).toEqual({
            model: "contra",
            family: "contra",
        });
    });

    it("is case and whitespace insensitive", () => {
        expect(carryForSection("  trumpet ")).toEqual({
            model: "trumpet",
            family: "brass",
        });
    });

    it("carries nothing for every other section", () => {
        for (const s of [
            "Flute",
            "Snare",
            "Color Guard",
            "Marimba",
            "Drum Major",
            "",
            "Cornet",
        ])
            expect(carryForSection(s)).toBeNull();
    });
});
