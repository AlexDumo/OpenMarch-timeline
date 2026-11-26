// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cueSectionsOf } from "../cueSections";

describe("cueSectionsOf", () => {
    it("gives a section whose performers all carry one model that model's catalog item", () => {
        const sections = cueSectionsOf([
            { section: "Trumpet", model: "trumpet" },
            { section: "Color Guard", model: "flag6" },
            { section: "Color Guard", model: "flag6" },
            { section: "Swing", model: "swingFlag" },
            { section: "Tuba", model: "contra" },
            { section: "Mixed", model: "flag6" },
            { section: "Mixed", model: "rifle" },
            { section: "Drum Major", model: null },
        ]);

        expect(sections.map((s) => [s.name, s.equipment?.id])).toEqual([
            ["Trumpet", "builtin:equipment.trumpet"],
            ["Color Guard", "builtin:equipment.flag"],
            ["Swing", "builtin:equipment.swingFlag"],
            ["Tuba", "builtin:equipment.tuba"],
        ]);
        expect(sections[1]!.equipment).toMatchObject({ holds: "flag" });
        expect(sections[0]!.equipment).toMatchObject({ holds: "winds" });
    });

    it("gives bass drum sections their side 2 Facing default, with or without one usual equipment", () => {
        const sections = cueSectionsOf([
            { section: "Bass Drum", model: "bass" },
            { section: "Bass Drum", model: "bass" },
            { section: "Flub Drum", model: "bass" },
            { section: "Trumpet", model: "trumpet" },
        ]);

        expect(sections.map((s) => [s.name, s.facing])).toEqual([
            ["Bass Drum", "builtin:facing.side2"],
            ["Flub Drum", "builtin:facing.side2"],
            ["Trumpet", undefined],
        ]);
        expect(sections[2]!.equipment?.id).toBe("builtin:equipment.trumpet");
    });

    it("gives a bass section its Facing default even when its performers mix models", () => {
        const sections = cueSectionsOf([
            { section: "bass drum", model: "bass" },
            { section: "Bass Drum", model: null },
        ]);

        expect(sections).toEqual([
            { name: "bass drum", facing: "builtin:facing.side2" },
        ]);
    });
});
