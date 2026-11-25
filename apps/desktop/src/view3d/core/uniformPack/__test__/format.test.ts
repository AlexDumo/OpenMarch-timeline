// cspell:words jsoo
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

    it("is a self-contained version 1 preview of kind uniform while it has no items, with room for modes and variants", () => {
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

    it("refuses what version 1 doesn't know: unknown keys, and anything in the reserved lists", () => {
        const withExtra = (extra: object) => () =>
            readUniformPack(
                zipOf({
                    "manifest.json": strToU8(
                        JSON.stringify({ ...sampleManifest(), ...extra }),
                    ),
                    "layers/base.png": fakePng(),
                }),
            );
        // a later field that changes what is drawn bumps formatVersion instead
        expect(codeOf(withExtra({ tint: "#ff0000" }))).toBe("damaged");
        for (const reserved of ["items", "modes", "variants", "attachments"])
            expect(codeOf(withExtra({ [reserved]: [{ id: "x" }] }))).toBe(
                "damaged",
            );
        // empty reserved lists are what version 1 writes
        expect(
            codeOf(
                withExtra({
                    items: [],
                    modes: [],
                    variants: [],
                    attachments: [],
                }),
            ),
        ).toBeNull();
    });

    it("refuses unknown keys in nested objects too", () => {
        const base = sampleManifest();
        const cases = [
            {
                layers: [
                    { ...base.layers[0], blend: "multiply", opacity: 0.5 },
                ],
            },
            { page: { ...base.page, bleed: 1 } },
            { options: { ...base.options, plume: true } },
            { palette: { ...base.palette, lining: "#000000" } },
            { credits: { ...base.credits, year: "2026" } },
        ];
        for (const nested of cases)
            expect(
                codeOf(() =>
                    readUniformPack(
                        zipOf({
                            "manifest.json": strToU8(
                                JSON.stringify({ ...base, ...nested }),
                            ),
                            "layers/base.png": fakePng(),
                        }),
                    ),
                ),
            ).toBe("damaged");
    });

    it("refuses a zip that lists a name twice", () => {
        const bytes = zipSync({
            "manifest.json": strToU8(JSON.stringify(sampleManifest())),
            "manifest.jsoo": strToU8(JSON.stringify({ name: "other" })),
            "layers/base.png": [fakePng(), { level: 0 }],
        });
        // rename the second manifest, in its local header and the directory
        const text = new TextEncoder();
        const from = text.encode("manifest.jsoo");
        const to = text.encode("manifest.json");
        for (let p = 0; p + from.length <= bytes.length; p++)
            if (from.every((b, i) => bytes[p + i] === b)) bytes.set(to, p);
        expect(codeOf(() => readUniformPack(bytes))).toBe("damaged");
    });

    it("reads a zip whose comment holds the end record's signature", () => {
        const plain = pack();
        // a comment of 40 bytes with "PK\5\6" inside it
        const comment = new Uint8Array(40);
        comment.set([0x50, 0x4b, 0x05, 0x06], 10);
        const out = new Uint8Array(plain.length + comment.length);
        out.set(plain);
        out.set(comment, plain.length);
        new DataView(out.buffer).setUint16(
            plain.length - 2,
            comment.length,
            true,
        );
        expect(readUniformPack(out).manifest.name).toBe("Home uniform");
    });

    it("refuses layers that repeat an id", () => {
        const base = sampleManifest().layers[0];
        const twice = {
            ...sampleManifest(),
            layers: [base, { ...base, file: "layers/other.png" }],
        };
        expect(
            codeOf(() =>
                readUniformPack(
                    zipOf({
                        "manifest.json": strToU8(JSON.stringify(twice)),
                        "layers/base.png": fakePng(),
                        "layers/other.png": fakePng(),
                    }),
                ),
            ),
        ).toBe("damaged");
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
                            formatVersion: 4,
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

    it("never inflates past what a zip declares, however its directory lies", () => {
        // a layer that really inflates to 8 MB
        const big = new Uint8Array(8 * 1024 * 1024);
        big.set(fakePng());
        const honest = zipSync({
            "manifest.json": strToU8(JSON.stringify(sampleManifest())),
            "layers/base.png": [big, { level: 9 }],
        });
        const lie = (bytes: Uint8Array, name: string, size: number) => {
            const out = bytes.slice();
            const view = new DataView(out.buffer);
            // every central directory entry for `name`: set its declared size
            for (let p = 0; p + 46 < out.length; p++) {
                if (view.getUint32(p, true) !== 0x02014b50) continue;
                const n = view.getUint16(p + 28, true);
                const entry = new TextDecoder().decode(
                    out.subarray(p + 46, p + 46 + n),
                );
                if (entry === name) view.setUint32(p + 24, size, true);
            }
            return out;
        };
        // declared as 8 KB: its compressed bytes fit that, so it gets as far as inflating, and
        // stops at 8 KB instead of making 8 MB
        const small = lie(honest, "layers/base.png", 8 * 1024);
        const t0 = performance.now();
        expect(codeOf(() => readUniformPack(small))).toBe("damaged");
        expect(performance.now() - t0).toBeLessThan(1000);
        // compressed bytes that couldn't come from the declared size are refused before inflating
        expect(
            codeOf(() => readUniformPack(lie(honest, "layers/base.png", 1))),
        ).toBe("damaged");
        // a stored entry whose sizes differ
        const stored = zipSync({
            "manifest.json": strToU8(JSON.stringify(sampleManifest())),
            "layers/base.png": [fakePng(), { level: 0 }],
        });
        expect(
            codeOf(() => readUniformPack(lie(stored, "layers/base.png", 4))),
        ).toBe("damaged");
    });

    it("inflates only the manifest and the layers it names", () => {
        // a junk entry that would fail to inflate is never touched
        const bytes = zipSync({
            "manifest.json": strToU8(JSON.stringify(sampleManifest())),
            "layers/base.png": [fakePng(), { level: 0 }],
            "junk.bin": [
                new Uint8Array(65536).map((_, i) => i * 7),
                { level: 6 },
            ],
        });
        const view = new DataView(bytes.buffer);
        for (let p = 0; p + 46 < bytes.length; p++) {
            if (view.getUint32(p, true) !== 0x04034b50) continue;
            const n = view.getUint16(p + 26, true);
            const name = new TextDecoder().decode(
                bytes.subarray(p + 30, p + 30 + n),
            );
            // its compressed data becomes garbage that can't inflate
            if (name === "junk.bin")
                bytes.fill(0xff, p + 30 + n, p + 30 + n + 64);
        }
        expect(readUniformPack(bytes).manifest.name).toBe("Home uniform");
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
        expect(uniformNameFromFile("Sample modes.png")).toBe("Sample modes");
        expect(pngHeaderSize(fakePng(12, 34))).toEqual({
            width: 12,
            height: 34,
        });
    });
});
