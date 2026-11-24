import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { SAMPLE_FLATS } from "@/view3d/core/marchers/uniformArtwork";
import {
    ASSET_FILE_EXTENSION,
    UNIFORM_PACK_MAX_ENTRIES,
    UniformPackError,
    lookOfManifest,
    pngHeaderSize,
    readUniformPack,
    uniformNameFromFile,
    uniformPackFileName,
    writeUniformPack,
    type UniformPackManifest,
} from "../format";
import { fakePng, sampleManifest } from "./fixtures";

const pack = (
    manifest: UniformPackManifest = sampleManifest(),
    png = fakePng(),
) => writeUniformPack(manifest, { "layers/base.png": png });

const zipOf = (files: Record<string, Uint8Array>) => zipSync(files);

const codeOf = (fn: () => unknown) => {
    try {
        fn();
    } catch (error) {
        return error instanceof UniformPackError ? error.code : String(error);
    }
    return null;
};

describe("uniform pack file", () => {
    it("round-trips: the manifest and every layer's bytes come back", () => {
        const png = fakePng(3360, 2816, 7);
        const read = readUniformPack(pack(sampleManifest(), png));
        expect(read.manifest).toEqual(sampleManifest());
        expect(read.layers).toHaveLength(1);
        expect(read.layers[0].id).toBe("base");
        expect(Array.from(read.layers[0].png)).toEqual(Array.from(png));
    });

    it("writes the same bytes for the same pack, so leaving a show and coming back changes nothing", () => {
        const a = pack();
        const b = pack();
        expect(Array.from(a)).toEqual(Array.from(b));
        const again = readUniformPack(a);
        const rewritten = writeUniformPack(again.manifest, {
            "layers/base.png": again.layers[0].png,
        });
        expect(Array.from(rewritten)).toEqual(Array.from(a));
    });

    it("is a self-contained version 1 preview of kind uniform, with room for items, modes and variants", () => {
        const { manifest } = readUniformPack(pack());
        expect(manifest).toMatchObject({
            format: "openmarch-asset",
            formatVersion: 1,
            preview: true,
            kind: "uniform",
            page: { width: 105, height: 88, unit: "in" },
            items: [],
            modes: [],
            variants: [],
            credits: { author: "A. Designer", license: "CC-BY-4.0" },
        });
        for (const layer of manifest.layers)
            expect(layer.file).toMatch(/^layers\/[a-z0-9-]+\.png$/);
    });

    it("keeps the palette and part options", () => {
        const { manifest } = readUniformPack(pack());
        expect(lookOfManifest(manifest)).toEqual(SAMPLE_FLATS.look);
    });

    it("reads a pack a later step wrote with items and modes, ignoring them", () => {
        const manifest = {
            ...sampleManifest(),
            items: [{ file: "items/crest.svg" }],
            modes: [{ id: "sash-out", layers: ["base"] }],
        };
        expect(readUniformPack(pack(manifest)).manifest.name).toBe(
            "Home uniform",
        );
    });

    it("refuses what isn't a uniform pack this build reads", () => {
        const manifestJson = (m: object) => strToU8(JSON.stringify(m));
        expect(codeOf(() => readUniformPack(fakePng()))).toBe("notPack");
        expect(
            codeOf(() =>
                readUniformPack(zipOf({ "readme.txt": strToU8("hi") })),
            ),
        ).toBe("notPack");
        expect(
            codeOf(() =>
                readUniformPack(
                    zipOf({
                        "manifest.json": manifestJson({
                            ...sampleManifest(),
                            kind: "model",
                        }),
                    }),
                ),
            ),
        ).toBe("notPack");
        expect(
            codeOf(() =>
                readUniformPack(
                    zipOf({
                        "manifest.json": manifestJson({
                            ...sampleManifest(),
                            formatVersion: 2,
                        }),
                    }),
                ),
            ),
        ).toBe("newer");
        // the layer it names isn't there
        expect(
            codeOf(() =>
                readUniformPack(
                    zipOf({ "manifest.json": manifestJson(sampleManifest()) }),
                ),
            ),
        ).toBe("damaged");
        // a layer that isn't a PNG
        expect(
            codeOf(() =>
                readUniformPack(
                    zipOf({
                        "manifest.json": manifestJson(sampleManifest()),
                        "layers/base.png": strToU8("<svg/>"),
                    }),
                ),
            ),
        ).toBe("damaged");
    });

    it("never names a path outside the pack", () => {
        const outside = {
            ...sampleManifest(),
            layers: [
                {
                    id: "base",
                    name: "Base",
                    file: "../base.png",
                    covers: "page" as const,
                },
            ],
        };
        expect(() =>
            writeUniformPack(outside, { "../base.png": fakePng() }),
        ).toThrow();
        expect(
            codeOf(() =>
                readUniformPack(
                    zipOf({
                        "manifest.json": strToU8(JSON.stringify(outside)),
                        "../base.png": fakePng(),
                    }),
                ),
            ),
        ).toBe("damaged");
    });

    it("refuses a zip with too many entries before inflating them", () => {
        const files: Record<string, Uint8Array> = {};
        for (let i = 0; i <= UNIFORM_PACK_MAX_ENTRIES; i++)
            files[`junk/${i}.txt`] = strToU8("x");
        expect(codeOf(() => readUniformPack(zipOf(files)))).toBe("tooLarge");
    });

    it("refuses a layer too large to decode, from its header", () => {
        expect(
            codeOf(() =>
                readUniformPack(pack(sampleManifest(), fakePng(20000, 20000))),
            ),
        ).toBe("tooLarge");
    });

    it("names files after the uniform", () => {
        expect(uniformPackFileName("Home: 2026/Fall")).toBe(
            `Home 2026 Fall${ASSET_FILE_EXTENSION}`,
        );
        expect(uniformPackFileName("  ")).toBe(
            `uniform${ASSET_FILE_EXTENSION}`,
        );
        expect(uniformNameFromFile("Cadets 2019.png")).toBe("Cadets 2019");
        expect(pngHeaderSize(fakePng(12, 34))).toEqual({
            width: 12,
            height: 34,
        });
    });
});
