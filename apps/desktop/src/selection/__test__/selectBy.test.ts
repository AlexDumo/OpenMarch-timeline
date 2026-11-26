import { describe, expect, it } from "vitest";
import {
    drillPrefixesOf,
    idsAmong,
    idsInFamily,
    idsInSameSections,
    idsInSections,
    idsWithDrillPrefix,
    sectionsOf,
    selectionWith,
} from "../selectBy";

/**
 * Picking a group of performers (#1359): the Select tab's "Select by" and the field menu's
 * Select submenu share these, so a group means the same people in both.
 */
const band = [
    { id: 1, section: "Trumpet", drill_prefix: "T" },
    { id: 2, section: "Trumpet", drill_prefix: "T" },
    { id: 3, section: "Mellophone", drill_prefix: "M" },
    { id: 4, section: "Flute", drill_prefix: "F" },
    { id: 5, section: "Snare", drill_prefix: "S" },
];

describe("selectBy", () => {
    it("lists the sections in use once each, in score order", () => {
        expect(sectionsOf(band).map((s) => s.name)).toEqual([
            "Flute",
            "Trumpet",
            "Mellophone",
            "Snare",
        ]);
    });

    it("picks a section, a family and a drill prefix", () => {
        expect(idsInSections(band, new Set(["Trumpet"]))).toEqual([1, 2]);
        expect(idsInFamily(band, "Brass")).toEqual([1, 2, 3]);
        expect(idsInFamily(band, "Guard")).toEqual([]);
        expect(idsWithDrillPrefix(band, "M")).toEqual([3]);
        expect(drillPrefixesOf(band)).toEqual(["F", "M", "S", "T"]);
    });

    it("Select same section: everyone in the selected performers' sections", () => {
        expect(idsInSameSections(band, [2])).toEqual([1, 2]);
        expect(idsInSameSections(band, [1, 4])).toEqual([1, 2, 4]);
        expect(idsInSameSections(band, [])).toEqual([]);
    });

    it("replaces the selection, or adds to it keeping what was selected first", () => {
        const [a, b, c, d] = band;
        expect(selectionWith(band, [d!], [1, 2], false)).toEqual([a, b]);
        expect(selectionWith(band, [d!, b!], [1, 2, 3], true)).toEqual([
            d,
            b,
            a,
            c,
        ]);
    });
});

describe("idsAmong", () => {
    it("keeps a tag's members that can be picked, leaving a locked prop out", () => {
        // 9 is a locked prop with the tag: not among the unlocked rows
        expect(idsAmong([2, 9, 4], band)).toEqual([2, 4]);
    });
});
