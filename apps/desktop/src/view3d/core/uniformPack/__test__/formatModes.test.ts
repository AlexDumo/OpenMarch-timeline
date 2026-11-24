/**
 * Uniform pack format version 3 (step 5 of fork #1257): modes. A pack with modes round-trips as
 * version 3; packs without are still written and read as version 1 or 2; a version 2 reader
 * refuses version 3; and what each mode draws and how it's colored follows its manifest.
 */
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
    UniformPackError,
    drawnInMode,
    lookOfManifest,
    modeOf,
    packWithContents,
    readUniformPack,
    writeUniformPack,
    type UniformPackItem,
    type UniformPackManifest,
    type UniformPackMode,
} from "../format";
import { fakePng, sampleManifest } from "./fixtures";

const crest: UniformPackItem = {
    id: "crest",
    file: "items/crest.png",
    panel: "front",
    at: [17, 25.32],
    width: 6,
};
const number: UniformPackItem = {
    id: "number",
    file: "items/number.png",
    panel: "back",
    at: [17, 28.47],
    height: 8,
};

/** Cadets 2019, as the design doc names its modes */
const plain: UniformPackMode = {
    id: "plain",
    name: "Plain",
    layers: ["base"],
    items: ["crest", "number"],
};
const sashOut: UniformPackMode = {
    id: "sash-out",
    name: "Sash out",
    layers: ["base", "sash"],
    items: ["number"],
};
const unzipped: UniformPackMode = {
    id: "unzipped",
    name: "Sash out, unzipped",
    layers: ["base", "sash", "open-front"],
    items: ["number"],
    palette: { primary: "#f2f2ee" },
    options: { collar: false, hat: false },
};

const cadets = (
    modes: UniformPackMode[] = [plain, sashOut, unzipped],
): UniformPackManifest => {
    const base = sampleManifest("Cadets 2019");
    return {
        ...base,
        layers: [
            ...base.layers,
            {
                id: "sash",
                name: "Sash",
                file: "layers/sash.png",
                covers: "page",
            },
            {
                id: "open-front",
                name: "Open front",
                file: "layers/open-front.png",
                covers: "page",
            },
        ],
        items: [crest, number],
        modes,
    };
};

const files = {
    "layers/base.png": fakePng(3360, 2816, 1),
    "layers/sash.png": fakePng(3360, 2816, 2),
    "layers/open-front.png": fakePng(3360, 2816, 3),
    "items/crest.png": fakePng(512, 512, 4),
    "items/number.png": fakePng(300, 400, 5),
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

describe("uniform pack modes (format version 3)", () => {
    it("round-trips a pack with modes as version 3, writing the same bytes again", () => {
        const bytes = writeUniformPack(cadets(), files);
        const read = readUniformPack(bytes);
        expect(read.manifest.formatVersion).toBe(3);
        expect(read.manifest.modes).toEqual([plain, sashOut, unzipped]);
        expect(read.layers.map((l) => l.id)).toEqual([
            "base",
            "sash",
            "open-front",
        ]);
        const again = packWithContents(read, {});
        expect(Array.from(again)).toEqual(Array.from(bytes));
    });

    it("still writes a pack without modes as version 1 or 2, and reads older files", () => {
        const two = readUniformPack(writeUniformPack(cadets([]), files));
        expect(two.manifest.formatVersion).toBe(2);
        const one = readUniformPack(
            writeUniformPack(sampleManifest(), {
                "layers/base.png": files["layers/base.png"],
            }),
        );
        expect(one.manifest.formatVersion).toBe(1);
        // files as steps 3 and 4 wrote them
        for (const [version, manifest] of [
            [1, sampleManifest()],
            [2, { ...sampleManifest(), items: [crest] }],
        ] as const)
            expect(
                readUniformPack(
                    rawPack({ ...manifest, formatVersion: version }),
                ).manifest.formatVersion,
            ).toBe(version);
        // removing the last mode goes back to the lowest version
        const three = readUniformPack(writeUniformPack(cadets(), files));
        expect(
            readUniformPack(packWithContents(three, { modes: [] })).manifest
                .formatVersion,
        ).toBe(2);
    });

    it("is refused as newer by a build that reads only up to version 2", () => {
        const bytes = writeUniformPack(cadets(), files);
        expect(codeOf(() => readUniformPack(bytes, { newest: 2 }))).toBe(
            "newer",
        );
        // and a version 2 file can't carry modes: step 4 reserved the list, so it can't have been
        // written by a build that draws it wrong
        expect(
            codeOf(() =>
                readUniformPack(rawPack({ ...cadets(), formatVersion: 2 })),
            ),
        ).toBe("damaged");
        // the same build still reads a pack without modes
        expect(
            readUniformPack(writeUniformPack(cadets([]), files), { newest: 2 })
                .manifest.formatVersion,
        ).toBe(2);
    });

    it("refuses modes that break the rules", () => {
        const bad: UniformPackMode[][] = [
            [{ ...plain, layers: ["cape-art"] }],
            [{ ...plain, layers: ["base", "base"] }],
            [{ ...plain, layers: [] }],
            [{ ...plain, items: ["patch"] }],
            [{ ...plain, items: ["crest", "crest"] }],
            [plain, { ...sashOut, id: "plain" }],
            [{ ...plain, palette: { primary: "red" } }],
            [{ ...plain, name: "" }],
            [{ ...plain, id: "Plain Mode" }],
            Array.from({ length: 9 }, (_, i) => ({ ...plain, id: `m-${i}` })),
        ];
        for (const modes of bad)
            expect(
                codeOf(() =>
                    readUniformPack(
                        rawPack({ ...cadets(modes), formatVersion: 3 }),
                    ),
                ),
                JSON.stringify(modes),
            ).toBe("damaged");
        // an unknown key in a mode
        expect(
            codeOf(() =>
                readUniformPack(
                    rawPack({
                        ...cadets([{ ...plain, tint: "#ff0000" } as never]),
                        formatVersion: 3,
                    }),
                ),
            ),
        ).toBe("damaged");
        // variants stay reserved
        expect(
            codeOf(() =>
                readUniformPack(
                    rawPack({
                        ...cadets(),
                        formatVersion: 3,
                        variants: [{ id: "guard" }],
                    }),
                ),
            ),
        ).toBe("damaged");
    });

    it("draws each mode's layers and items, and the default for a mode it doesn't have", () => {
        const manifest = cadets();
        const drawn = (mode: string | null) => {
            const d = drawnInMode(manifest, mode);
            return [d.layers.map((l) => l.id), d.items.map((i) => i.id)];
        };
        expect(drawn("plain")).toEqual([["base"], ["crest", "number"]]);
        expect(drawn("sash-out")).toEqual([["base", "sash"], ["number"]]);
        expect(drawn("unzipped")).toEqual([
            ["base", "sash", "open-front"],
            ["number"],
        ]);
        // the first mode is the default
        expect(modeOf(manifest, null)?.id).toBe("plain");
        expect(drawn("removed-mode")).toEqual(drawn("plain"));
        // a pack without modes draws everything
        expect(
            drawnInMode(cadets([]), "sash-out").layers.map((l) => l.id),
        ).toEqual(["base", "sash", "open-front"]);
    });

    it("takes a mode's colors and parts over the uniform's own", () => {
        const manifest = cadets();
        const own = lookOfManifest(manifest, "plain");
        const open = lookOfManifest(manifest, "unzipped");
        expect(open.colors.primary).toBe(0xf2f2ee);
        expect(open.colors.secondary).toBe(own.colors.secondary);
        expect(open.options.hat).toBe(false);
        expect(open.options.collar).toBe(false);
        expect(open.options.cuffs).toBe(own.options.cuffs);
        expect(lookOfManifest(manifest)).toEqual(own);
    });
});
