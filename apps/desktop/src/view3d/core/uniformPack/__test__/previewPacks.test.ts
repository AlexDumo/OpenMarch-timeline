// @vitest-environment node
// cspell:words omasset
/**
 * Preview packs stay honest (ADR 0010, amendment of 2026-11-24, "The opt-in preview"): pack
 * files of format versions 1 to 3, as committed bytes, read in this build and must keep reading
 * in every later one, and draw the same; a newer version is refused as newer, and the person is
 * told to update. Changing what these files read as, or the snapshot of what they draw
 * (`__snapshots__/previewPacks.test.ts.snap`), needs an amendment: never update it with `-u`
 * to make a reader change pass.
 *
 * The files, in `fixtures-files/`, were written by the builds that shipped each version:
 * - `preview-v1.omasset`: step 3's writer (`format.ts` at 00efb2880, the merge of #1285),
 *   `writeUniformPack(singleLayerManifest({ name: "Preview v1", look: SAMPLE_FLATS.look,
 *   credits }), { "layers/base.png": fakePng() })`.
 * - `preview-v2.omasset`: step 4's writer (the verbatim copy in `step4Format.ts`), the same
 *   manifest named "Preview v2" plus one proportional crest item, 6 in wide at the chest
 *   centre, with `fakePng(512, 512, 1)` as its image.
 * - `sample-modes-v3.omasset`: step 5's writer, `sampleModesV3()` (see `formatV3File.test.ts`).
 * Their images are PNG headers only (`fakePng`): the reader checks sizes, never decodes.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import en from "../../../../../i18n/en.json";
import {
    UniformPackError,
    flattenPlan,
    lookOfManifest,
    readUniformPack,
} from "../format";
import { sampleManifest } from "./fixtures";

const fixture = (name: string) =>
    new Uint8Array(readFileSync(resolve(__dirname, "fixtures-files", name)));

const sha = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");

/** Everything a pack draws: its manifest as read, and per mode its look, images and items */
function drawn(file: string) {
    const pack = readUniformPack(fixture(file));
    const modes = pack.manifest.modes?.length
        ? pack.manifest.modes.map((m) => m.id)
        : [null];
    return {
        manifest: pack.manifest,
        layers: pack.layers.map((l) => ({ id: l.id, sha256: sha(l.png) })),
        itemFiles: pack.itemFiles.map((f) => ({
            file: f.file,
            sha256: sha(f.png),
        })),
        modes: modes.map((mode) => {
            const plan = flattenPlan(pack, { mode });
            return {
                mode,
                look: lookOfManifest(pack.manifest, mode),
                images: plan.images.map((i) => ({
                    file: i.file,
                    sha256: sha(i.png),
                })),
                items: plan.items,
            };
        }),
    };
}

describe("preview pack files (format versions 1 to 3)", () => {
    it.each([
        ["preview-v1.omasset", 1, "Preview v1"],
        ["preview-v2.omasset", 2, "Preview v2"],
        ["sample-modes-v3.omasset", 3, "Sample modes"],
    ])("%s reads as version %i", (file, version, name) => {
        const { manifest, layers } = readUniformPack(fixture(file));
        expect(manifest.formatVersion).toBe(version);
        expect(manifest.name).toBe(name);
        expect(layers.length).toBeGreaterThan(0);
        if (version >= 2) expect(manifest.items?.length).toBeGreaterThan(0);
        if (version >= 3) expect(manifest.modes?.length).toBeGreaterThan(0);
    });

    it.each([
        [1, "preview-v1.omasset"],
        [2, "preview-v2.omasset"],
        [3, "sample-modes-v3.omasset"],
    ])(
        "the format version %i file draws what it drew when it was written",
        (_, file) => {
            expect(drawn(file)).toMatchSnapshot();
        },
    );

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

    it("tells the person to update OpenMarch, on import, in the 3D View and in Assets", () => {
        const view3d = (
            en as { view3d: Record<string, Record<string, unknown>> }
        ).view3d;
        const importStrings = view3d.uniformImport as {
            refused: Record<string, string>;
            newer: string;
        };
        const assets = (en as { assets: { notes: Record<string, string> } })
            .assets.notes;
        for (const text of [
            importStrings.refused.newer,
            importStrings.newer,
            assets.newerUniform,
        ]) {
            expect(text).toMatch(/newer version of OpenMarch/);
            expect(text).toMatch(/Update OpenMarch/);
        }
    });

    it("words the Assets notes for each state of Custom uniforms (preview)", () => {
        const assets = (en as { assets: { notes: Record<string, string> } })
            .assets.notes;
        // on: the 3D View settings have Import
        expect(assets.missingUniform).toMatch(/Import it again/);
        expect(assets.unreadableUniform).toMatch(/or import one/);
        // off: there's no Import button until the setting is on
        expect(assets.missingUniformPreviewOff).toMatch(
            /turn on Custom uniforms \(preview\) in the 3D View settings' Preferences/,
        );
        expect(assets.unreadableUniformPreviewOff).not.toMatch(/import/i);
    });
});
