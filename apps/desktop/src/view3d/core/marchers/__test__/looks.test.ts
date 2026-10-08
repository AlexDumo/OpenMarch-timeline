import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
    BODY_TYPES,
    HEIGHT_CLASSES,
    SKIN_TONES,
    classSuffix,
    classTag,
    defaultPerformerBody,
    heightClassFor,
    instrumentForSection,
    partVisible,
    sectionUniform,
    uniformKey,
} from "../looks";

const assets = path.resolve(__dirname, "../../../assets/om-pose");
const manifest = JSON.parse(
    fs.readFileSync(path.join(assets, "manifest.json"), "utf8"),
) as { clips: { name: string; base: string; height: number }[] };

describe("performer bodies", () => {
    it("derives the same body for the same marcher every time", () => {
        expect(defaultPerformerBody(42)).toEqual(defaultPerformerBody(42));
    });

    it("spreads 2,000 marchers over every body type and skin tone", () => {
        const types = new Map<string, number>();
        const tones = new Map<number, number>();
        for (let id = 1; id <= 2000; id++) {
            const b = defaultPerformerBody(id);
            types.set(b.bodyType, (types.get(b.bodyType) ?? 0) + 1);
            tones.set(b.skinTone, (tones.get(b.skinTone) ?? 0) + 1);
            expect(b.heightClass).toBe(1); // the low tier: one height
        }
        expect(types.size).toBe(BODY_TYPES.length);
        expect(tones.size).toBe(SKIN_TONES.length);
        // roughly even: every type within 30% of 2000 / 7
        for (const n of types.values())
            expect(Math.abs(n - 2000 / 7)).toBeLessThan((0.3 * 2000) / 7);
    });

    it("varies heights a quarter short, half middle, a quarter tall at high quality", () => {
        const n = new Map<number, number>();
        for (let id = 1; id <= 2000; id++) {
            const h = defaultPerformerBody(id, {
                varyHeight: true,
            }).heightClass;
            n.set(h, (n.get(h) ?? 0) + 1);
        }
        expect([...n.keys()].sort()).toEqual([0.95, 1, 1.05]);
        expect(Math.abs(n.get(0.95)! / 2000 - 0.25)).toBeLessThan(0.03);
        expect(Math.abs(n.get(1)! / 2000 - 0.5)).toBeLessThan(0.03);
        expect(Math.abs(n.get(1.05)! / 2000 - 0.25)).toBeLessThan(0.03);
    });

    it("keeps a marcher's body type and skin tone whatever the tier", () => {
        for (let id = 1; id <= 50; id++) {
            const low = defaultPerformerBody(id);
            const high = defaultPerformerBody(id, { varyHeight: true });
            expect(high.bodyType).toBe(low.bodyType);
            expect(high.skinTone).toBe(low.skinTone);
        }
    });

    it("picks the height class nearest height / 1.80 m", () => {
        expect(heightClassFor(1.8)).toBe(1);
        expect(heightClassFor(1.62)).toBe(0.9);
        expect(heightClassFor(1.5)).toBe(0.9);
        expect(heightClassFor(1.71)).toBe(0.95);
        expect(heightClassFor(1.89)).toBe(1.05);
        expect(heightClassFor(2.1)).toBe(1.1);
    });

    it("names every class's clips the way the manifest does", () => {
        for (const h of HEIGHT_CLASSES) {
            const name = `attention${classSuffix(h)}`;
            const clip = manifest.clips.find((c) => c.name === name);
            expect(clip?.height).toBe(h);
        }
        expect(classTag(0.9)).toBe("h090");
        expect(classTag(1)).toBe("h100");
        expect(classTag(1.1)).toBe("h110");
    });

    it("has a bundled body for every body type and a pack for every class", () => {
        for (const t of BODY_TYPES)
            expect(fs.existsSync(path.join(assets, "bodies", `${t}.glb`))).toBe(
                true,
            );
        for (const h of HEIGHT_CLASSES)
            expect(
                fs.existsSync(
                    path.join(assets, "clips", `clips-${classTag(h)}.glb`),
                ),
            ).toBe(true);
    });
});

describe("section uniforms", () => {
    it("leaves the shako off the guard sections only", () => {
        for (const g of ["Color Guard", "Rifle", "Flag", "Dancer", "Twirler"])
            expect(sectionUniform(g, null).options.hat).toBe(false);
        for (const b of ["Trumpet", "Snare", "Flute", "Drum Major", "Unknown"])
            expect(sectionUniform(b, null).options.hat).toBe(true);
    });

    it("gives brass sections the instrument om-pose models", () => {
        expect(instrumentForSection("Trumpet")).toBe("trumpet");
        expect(instrumentForSection("Mellophone")).toBe("mellophone");
        expect(instrumentForSection("Baritone")).toBe("baritone");
        expect(instrumentForSection("Euphonium")).toBe("baritone");
        expect(instrumentForSection("Snare")).toBe("none");
        expect(instrumentForSection("Color Guard")).toBe("none");
    });

    it("uses the section's fill color for the jacket and hat", () => {
        const u = sectionUniform("Trumpet", { r: 200, g: 16, b: 46, a: 1 });
        expect(u.colors.primary).toBe(0xc8102e);
        expect(u.colors.hat).toBe(0xc8102e);
        expect(u.options.instrument).toBe("trumpet");
    });

    it("shares one look between sections that only differ in name when the instrument matches", () => {
        const fill = { r: 10, g: 20, b: 30, a: 1 };
        expect(uniformKey(sectionUniform("Flute", fill))).toBe(
            uniformKey(sectionUniform("Clarinet", fill)),
        );
        expect(uniformKey(sectionUniform("Flute", fill))).not.toBe(
            uniformKey(sectionUniform("Trumpet", fill)),
        );
    });

    it("hides exactly the parts the shader would discard", () => {
        const visible = (section: string) =>
            Array.from({ length: 16 }, (_, p) => p).filter((p) =>
                partVisible(sectionUniform(section, null), p),
            );
        // body parts 0-6 always; shako 7-9; one instrument 13-15
        expect(visible("Trumpet")).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 13]);
        expect(visible("Mellophone")).toEqual([
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 14,
        ]);
        expect(visible("Baritone")).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15]);
        expect(visible("Flute")).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(visible("Color Guard")).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });
});
