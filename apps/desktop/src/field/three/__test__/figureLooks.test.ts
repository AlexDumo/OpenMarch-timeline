import { describe, expect, it } from "vitest";
import {
    canonicalJson,
    showFigureLooks,
    type FigurePerformer,
} from "../figures/figureLooks";
import { sectionUniform } from "@/view3d/core/marchers/looks";
import { UNIFORM_PRESET_IDS } from "@/view3d/core/marchers/uniformPresets";

const band = (...sections: string[]): FigurePerformer[] =>
    sections.map((section, i) => ({ id: i + 1, section }));

const fingerprints = (
    performers: FigurePerformer[],
    settings?: Parameters<typeof showFigureLooks>[1],
) => {
    const { byPerformer } = showFigureLooks(performers, settings);
    return performers.map((p) => byPerformer.get(p.id)!);
};

describe("showFigureLooks", () => {
    it("gives performers carrying the same thing one figure", () => {
        const { byPerformer, looks } = showFigureLooks(
            band("Trumpet", "Trumpet", "Mellophone"),
            null,
        );
        expect(looks.size).toBe(2);
        expect(byPerformer.get(1)).toBe(byPerformer.get(2));
        expect(byPerformer.get(1)).not.toBe(byPerformer.get(3));
        expect(byPerformer.get(1)).toMatch(/^[0-9a-f]{64}$/);
    });

    it("follows the Tuba section's horn", () => {
        const [contra] = fingerprints(band("Tuba"), { tuba: "contra" });
        const [sousaphone] = fingerprints(band("Tuba"), {
            tuba: "sousaphone",
        });
        expect(contra).not.toBe(sousaphone);
        // nothing set is the marching tuba
        expect(fingerprints(band("Tuba"))[0]).toBe(contra);
    });

    it("follows the brass finish for brass only", () => {
        const gold = fingerprints(band("Trumpet", "Snare"), {
            brassFinish: "brass",
        });
        const silver = fingerprints(band("Trumpet", "Snare"), {
            brassFinish: "silver",
        });
        expect(silver[0]).not.toBe(gold[0]);
        expect(silver[1]).toBe(gold[1]);
    });

    it("gives each bass drum size its own figure", () => {
        const bass = fingerprints(
            band("Bass Drum", "Bass Drum", "Bass Drum", "Bass Drum"),
        );
        expect(new Set(bass).size).toBe(4);
    });

    it("doesn't change with what doesn't draw a figure", () => {
        const a = fingerprints(band("Trumpet", "Color Guard"));
        // other ids, another order, settings that don't touch these
        const b = showFigureLooks(
            [
                { id: 40, section: "Color Guard" },
                { id: 7, section: "Trumpet" },
            ],
            { tuba: "sousaphone" },
        );
        expect(b.byPerformer.get(7)).toBe(a[0]);
        expect(b.byPerformer.get(40)).toBe(a[1]);
    });

    it("wears the show's uniform, as the 3D View dresses it", () => {
        const look = (uniforms?: string) =>
            [
                ...showFigureLooks(band("Trumpet"), {
                    uniforms,
                }).looks.values(),
            ][0]!;
        expect(look().colors).toEqual(sectionUniform("Trumpet").colors);
        expect(
            fingerprints(band("Trumpet"), {
                uniforms: UNIFORM_PRESET_IDS[1],
            })[0],
        ).not.toBe(fingerprints(band("Trumpet"))[0]);
    });

    it("colors drum shells with the section's fill, as the 3D View does", () => {
        const plain = fingerprints(band("Snare"));
        const red = fingerprints([{ id: 1, section: "Snare", fill: 0xff0000 }]);
        expect(red[0]).not.toBe(plain[0]);
        expect(
            [
                ...showFigureLooks(
                    [{ id: 1, section: "Snare", fill: 0xff0000 }],
                    null,
                ).looks.values(),
            ][0]!.options.carryColor,
        ).toBe(0xff0000);
    });

    it("gives a performer with no section the plain figure", () => {
        const [none, missing] = fingerprints([
            { id: 1, section: "" },
            { id: 2, section: null },
        ]);
        expect(none).toBe(missing);
    });
});

describe("canonicalJson", () => {
    it("writes keys in order and leaves out undefined", () => {
        expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe(
            '{"a":[{"d":2}],"b":1}',
        );
    });
});
