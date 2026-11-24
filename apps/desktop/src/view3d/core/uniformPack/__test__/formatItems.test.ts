/**
 * Uniform pack format version 2 (fork #1258): placed items. A pack with items round-trips as
 * version 2, a pack without is still written and read as version 1, and the item rules hold.
 */
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
    UniformPackError,
    packWithItems,
    readUniformPack,
    writeUniformPack,
    type UniformPackItem,
    type UniformPackManifest,
} from "../format";
import { fakePng, sampleManifest } from "./fixtures";

const crest: UniformPackItem = {
    id: "crest",
    name: "Crest",
    file: "items/crest.png",
    panel: "front",
    at: [17, 25.32],
    width: 6,
    grade: "proportional",
};
const print: UniformPackItem = {
    id: "script",
    file: "items/script.png",
    panel: "back",
    at: [17, 30],
    width: 4,
    grade: "tile",
    regions: ["back-torso", "back-sleeve-L"],
};

const withItems = (items: UniformPackItem[]): UniformPackManifest => ({
    ...sampleManifest(),
    items,
});
const files = {
    "layers/base.png": fakePng(),
    "items/crest.png": fakePng(512, 512, 1),
    "items/script.png": fakePng(256, 128, 2),
};

const codeOf = (fn: () => unknown) => {
    try {
        fn();
    } catch (error) {
        return error instanceof UniformPackError ? error.code : String(error);
    }
    return null;
};

/** A zip holding `manifest` as it is, with every fixture file */
const rawPack = (manifest: object) =>
    zipSync({
        "manifest.json": strToU8(JSON.stringify(manifest)),
        ...files,
    });

describe("uniform pack items (format version 2)", () => {
    it("round-trips a pack with items as version 2, keeping every item and its image", () => {
        const bytes = writeUniformPack(withItems([crest, print]), files);
        const read = readUniformPack(bytes);
        expect(read.manifest.formatVersion).toBe(2);
        expect(read.manifest.items).toEqual([crest, print]);
        expect(read.itemFiles.map((f) => f.file)).toEqual([
            "items/crest.png",
            "items/script.png",
        ]);
        expect(Array.from(read.itemFiles[0].png)).toEqual(
            Array.from(files["items/crest.png"]),
        );
        // and writes the same bytes again
        const again = packWithItems(read, read.manifest.items!, {});
        expect(Array.from(again)).toEqual(Array.from(bytes));
    });

    it("writes a pack without items as version 1, which still reads", () => {
        const bytes = writeUniformPack(withItems([]), files);
        const read = readUniformPack(bytes);
        expect(read.manifest.formatVersion).toBe(1);
        expect(read.manifest.items).toEqual([]);
        // a version 1 file from step 3 (written by hand here) reads too
        const v1 = rawPack({ ...sampleManifest(), formatVersion: 1 });
        expect(readUniformPack(v1).manifest.formatVersion).toBe(1);
        // and removing the last item goes back to version 1
        const two = readUniformPack(
            writeUniformPack(withItems([crest]), files),
        );
        expect(
            readUniformPack(packWithItems(two, [], {})).manifest.formatVersion,
        ).toBe(1);
    });

    it("refuses items in a version 1 file", () => {
        expect(
            codeOf(() =>
                readUniformPack(
                    rawPack({
                        ...sampleManifest(),
                        formatVersion: 1,
                        items: [crest],
                    }),
                ),
            ),
        ).toBe("damaged");
    });

    it("refuses items that break the rules", () => {
        const bad: object[] = [
            { ...crest, width: undefined },
            { ...crest, grade: "tile" },
            { ...crest, regions: ["front-torso"] },
            { ...print, regions: ["front-torso"] },
            { ...print, width: 0.5 },
            { ...crest, grade: "sparkle" },
            { ...crest, tint: "#ff0000" },
            { ...crest, file: "../crest.png" },
        ];
        for (const item of bad)
            expect(
                codeOf(() =>
                    readUniformPack(
                        rawPack({
                            ...sampleManifest(),
                            formatVersion: 2,
                            items: [item],
                        }),
                    ),
                ),
                JSON.stringify(item),
            ).toBe("damaged");
        // repeated ids
        expect(
            codeOf(() =>
                readUniformPack(
                    rawPack({
                        ...sampleManifest(),
                        formatVersion: 2,
                        items: [crest, { ...crest, at: [10, 30] }],
                    }),
                ),
            ),
        ).toBe("damaged");
    });

    it("refuses an item image it isn't given, or one too large to decode", () => {
        expect(() =>
            writeUniformPack(withItems([crest]), {
                "layers/base.png": fakePng(),
            }),
        ).toThrow();
        const huge = zipSync({
            "manifest.json": strToU8(
                JSON.stringify({ ...withItems([crest]), formatVersion: 2 }),
            ),
            "layers/base.png": fakePng(),
            "items/crest.png": fakePng(4096, 4096),
        });
        expect(codeOf(() => readUniformPack(huge))).toBe("tooLarge");
    });

    it("rewrites a pack with new items, dropping images no item names", () => {
        const read = readUniformPack(
            writeUniformPack(withItems([crest, print]), files),
        );
        const number: UniformPackItem = {
            id: "number",
            file: "items/number.png",
            panel: "back",
            at: [17, 28.47],
            height: 8,
        };
        const next = readUniformPack(
            packWithItems(read, [crest, number], {
                "items/number.png": fakePng(300, 400, 3),
            }),
        );
        expect(next.manifest.items).toEqual([crest, number]);
        expect(next.itemFiles.map((f) => f.file)).toEqual([
            "items/crest.png",
            "items/number.png",
        ]);
    });
});
