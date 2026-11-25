// @vitest-environment node
// cspell:words omasset
/**
 * Preview packs stay honest (ADR 0010, amendment of 2026-11-24, "The opt-in preview"): pack
 * files of format versions 1 to 3, as committed bytes, read in this build and must keep reading
 * in every later one; a newer version is refused as newer, and the person is told to update.
 * Changing what these files read as needs an amendment.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import en from "../../../../../i18n/en.json";
import { UniformPackError, readUniformPack } from "../format";
import { sampleManifest } from "./fixtures";

const fixture = (name: string) =>
    new Uint8Array(readFileSync(resolve(__dirname, "fixtures-files", name)));

describe("preview pack files (format versions 1 to 3)", () => {
    it.each([
        ["preview-v1.omasset", 1, "Preview v1"],
        ["preview-v2.omasset", 2, "Preview v2"],
        ["cadets-2019-v3.omasset", 3, "Cadets 2019"],
    ])("%s reads as version %i", (file, version, name) => {
        const { manifest, layers } = readUniformPack(fixture(file));
        expect(manifest.formatVersion).toBe(version);
        expect(manifest.name).toBe(name);
        expect(layers.length).toBeGreaterThan(0);
        if (version >= 2) expect(manifest.items?.length).toBeGreaterThan(0);
        if (version >= 3) expect(manifest.modes?.length).toBeGreaterThan(0);
    });

    it("refuses a later version as newer, never misreading it", () => {
        const later = zipSync({
            "manifest.json": strToU8(
                JSON.stringify({ ...sampleManifest(), formatVersion: 4 }),
            ),
        });
        let code: string | null = null;
        try {
            readUniformPack(later);
        } catch (error) {
            code = error instanceof UniformPackError ? error.code : "other";
        }
        expect(code).toBe("newer");
    });

    it("tells the person to update OpenMarch, on import and for a show's stored uniform", () => {
        const view3d = (
            en as { view3d: Record<string, Record<string, unknown>> }
        ).view3d;
        const importStrings = view3d.uniformImport as {
            refused: Record<string, string>;
            unreadable: string;
        };
        expect(importStrings.refused.newer).toMatch(
            /newer version of OpenMarch/,
        );
        expect(importStrings.refused.newer).toMatch(/Update OpenMarch/);
        expect(importStrings.unreadable).toMatch(/newer version of OpenMarch/);
        expect(importStrings.unreadable).toMatch(/update OpenMarch/);
    });
});
