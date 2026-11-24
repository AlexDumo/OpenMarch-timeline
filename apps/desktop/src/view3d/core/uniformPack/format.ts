// cspell:words fflate omasset IHDR zippable Zippable
/**
 * The uniform pack, format version 1, a **preview** (docs/3d/uniform-artwork.md, "The uniform
 * pack"; ADR 0010 amendment 2026-11-24, fork #1257). It can still change, and freezes only after a
 * real artist has finished a uniform with it (fork #1259).
 *
 * One pack is one self-contained file, and the same bytes are the show asset of kind `uniform`
 * (one part, `pack`): a pack leaves a show and comes back unchanged. It is a zip holding
 *
 * - `manifest.json`: the asset format, its version, the kind (`uniform`), the name, the page in
 *   real inches, the palette and part options, the layers and the credits; `items` (fork #1258)
 *   and `modes` and `variants` (step 5) are reserved, and this build reads none of them;
 * - `layers/<id>.png`: each layer, a transparent PNG covering the whole flats page.
 *
 * No path outside the zip is ever named. It is the first kind of the portable asset file of epic
 * fork #1262, so the outer fields (`format`, `formatVersion`, `kind`, `name`, `credits`) are
 * meant for every kind; the rest is the uniform's.
 *
 * Pure: no DOM, no database. fflate reads and writes the zip, with limits checked before anything
 * is inflated.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { z } from "zod";
import type { PresetLook } from "@/view3d/core/marchers/uniformPresets";

/** The asset kind, in the show store and in the file */
export const UNIFORM_ASSET_KIND = "uniform";
/** What the file is, whatever its kind */
export const ASSET_FILE_FORMAT = "openmarch-asset";
/** The pack's format version. A preview until fork #1259; see the module comment. */
export const UNIFORM_PACK_VERSION = 1;
/** The file's extension and type, for every kind of asset file (epic fork #1262) */
export const ASSET_FILE_EXTENSION = ".omasset";
export const ASSET_FILE_MIME = "application/vnd.openmarch.asset+zip";
/** The single part of a `uniform` show asset: the file's bytes */
export const UNIFORM_PACK_PART = "pack";

/** The flats page in real inches, and its PNG size (docs/3d/uniform-artwork.md, "Flats template") */
export const FLATS_PAGE_IN = { width: 105, height: 88 } as const;
export const FLATS_PAGE_DPI = 32;
export const FLATS_PAGE_PX = {
    width: FLATS_PAGE_IN.width * FLATS_PAGE_DPI,
    height: FLATS_PAGE_IN.height * FLATS_PAGE_DPI,
} as const;

/** A pack file larger than this isn't read */
export const UNIFORM_PACK_MAX_BYTES = 64 * 1024 * 1024;
/** What its entries may hold once inflated, together */
export const UNIFORM_PACK_MAX_UNZIPPED_BYTES = 256 * 1024 * 1024;
export const UNIFORM_PACK_MAX_ENTRIES = 64;
export const UNIFORM_PACK_MAX_LAYERS = 16;
/** A layer image with more pixels than this isn't decoded (4× the page) */
export const UNIFORM_LAYER_MAX_PIXELS =
    4 * FLATS_PAGE_PX.width * FLATS_PAGE_PX.height;

const MANIFEST = "manifest.json";

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

/** The palette: the colors shown where the art is clear, and on the parts art can't reach */
const paletteSchema = z.object({
    primary: hex,
    secondary: hex,
    accent: hex,
    trim: hex,
    pants: hex,
    shoes: hex,
    gloves: hex,
    hat: hex,
    plume: hex,
    visor: hex,
});

const layerSchema = z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
    name: z.string().max(120),
    /** Its image in the pack */
    file: z.string().regex(/^layers\/[a-z0-9][a-z0-9-]{0,31}\.png$/),
    /** What the image covers; only the whole page in version 1 */
    covers: z.literal("page"),
});

const creditsSchema = z.object({
    license: z.string().max(200).optional(),
    author: z.string().max(200).optional(),
    source: z.string().max(500).optional(),
});

export const uniformPackManifestSchema = z.object({
    format: z.literal(ASSET_FILE_FORMAT),
    formatVersion: z.literal(UNIFORM_PACK_VERSION),
    /** True while the format can still change (fork #1259) */
    preview: z.boolean().optional(),
    kind: z.literal(UNIFORM_ASSET_KIND),
    name: z.string().min(1).max(120),
    /** The flats page, real size */
    page: z.object({
        width: z.literal(FLATS_PAGE_IN.width),
        height: z.literal(FLATS_PAGE_IN.height),
        unit: z.literal("in"),
    }),
    /** The pattern the palette draws where the art is clear */
    style: z.enum([
        "classic",
        "sash",
        "plastron",
        "military",
        "split",
        "fade",
        "cadet",
    ]),
    palette: paletteSchema,
    /** Part options */
    options: z.object({
        stripe: z.boolean(),
        collar: z.boolean(),
        cuffs: z.boolean(),
        gloves: z.boolean(),
        hat: z.boolean(),
    }),
    /** Bottom first. Every layer this build draws, in this order. */
    layers: z.array(layerSchema).min(1).max(UNIFORM_PACK_MAX_LAYERS),
    /** Reserved for placed logos and numbers (fork #1258); not read yet */
    items: z.array(z.unknown()).optional(),
    /** Reserved for modes and variants (step 5 of fork #1257); not read yet */
    modes: z.array(z.unknown()).optional(),
    variants: z.array(z.unknown()).optional(),
    credits: creditsSchema,
});

export type UniformPackManifest = z.infer<typeof uniformPackManifestSchema>;
export type UniformPackCredits = UniformPackManifest["credits"];

/** A read pack: its manifest and each layer's PNG bytes, in the manifest's order */
export interface UniformPack {
    manifest: UniformPackManifest;
    layers: { id: string; png: Uint8Array }[];
}

/** Why a file isn't a pack this build can read; `reason` is for logs, not people */
export class UniformPackError extends Error {
    constructor(
        readonly code: "tooLarge" | "notPack" | "newer" | "damaged",
        reason: string,
    ) {
        super(reason);
        this.name = "UniformPackError";
    }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG's size from its header, or null when the bytes aren't a PNG */
export function pngHeaderSize(
    data: Uint8Array,
): { width: number; height: number } | null {
    if (data.length < 24 || !PNG_SIGNATURE.every((b, i) => data[i] === b))
        return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (String.fromCharCode(...data.subarray(12, 16)) !== "IHDR") return null;
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : null;
}

const toHex = (n: number) => `#${(n & 0xffffff).toString(16).padStart(6, "0")}`;
const fromHex = (s: string) => parseInt(s.slice(1), 16);

/** A look's palette, pattern and part options as the manifest writes them */
export function manifestLookOf(
    look: PresetLook,
): Pick<UniformPackManifest, "style" | "palette" | "options"> {
    const c = look.colors;
    return {
        style: look.style,
        palette: {
            primary: toHex(c.primary),
            secondary: toHex(c.secondary),
            accent: toHex(c.accent),
            trim: toHex(c.trim),
            pants: toHex(c.pants),
            shoes: toHex(c.shoes),
            gloves: toHex(c.gloves),
            hat: toHex(c.hat),
            plume: toHex(c.plume),
            visor: toHex(c.visor),
        },
        options: { ...look.options },
    };
}

/** The look a pack's manifest describes: the colors under and around its art */
export function lookOfManifest(manifest: UniformPackManifest): PresetLook {
    const p = manifest.palette;
    return {
        style: manifest.style,
        colors: {
            primary: fromHex(p.primary),
            secondary: fromHex(p.secondary),
            accent: fromHex(p.accent),
            trim: fromHex(p.trim),
            pants: fromHex(p.pants),
            shoes: fromHex(p.shoes),
            gloves: fromHex(p.gloves),
            hat: fromHex(p.hat),
            plume: fromHex(p.plume),
            visor: fromHex(p.visor),
        },
        options: { ...manifest.options },
    };
}

/** The same pack always makes the same bytes: every entry gets this date */
const FIXED_MTIME = new Date(Date.UTC(1980, 0, 1, 12));

/**
 * The pack file for `manifest` and its layers' PNGs, keyed by `layers[].file`. Throws when the
 * manifest doesn't parse or names a layer it isn't given.
 */
export function writeUniformPack(
    manifest: UniformPackManifest,
    files: Readonly<Record<string, Uint8Array>>,
): Uint8Array {
    const checked = uniformPackManifestSchema.parse(manifest);
    const zippable: Zippable = {
        // a readable manifest first, so a person opening the zip finds it
        [MANIFEST]: [
            strToU8(`${JSON.stringify(checked, null, 2)}\n`),
            { level: 6, mtime: FIXED_MTIME },
        ],
    };
    for (const layer of checked.layers) {
        const png = files[layer.file];
        if (!png || !pngHeaderSize(png))
            throw new Error(`uniform pack: layer ${layer.file} isn't a PNG`);
        // PNGs are compressed already
        zippable[layer.file] = [png, { level: 0, mtime: FIXED_MTIME }];
    }
    return zipSync(zippable);
}

/** The manifest and layer entries of a pack's zip, inflated within the limits */
function unzipPack(bytes: Uint8Array): Record<string, Uint8Array> {
    let entries = 0;
    let total = 0;
    const want = (name: string) =>
        name === MANIFEST ||
        /^layers\/[a-z0-9][a-z0-9-]{0,31}\.png$/.test(name);
    try {
        return unzipSync(bytes, {
            filter: (entry) => {
                entries += 1;
                if (entries > UNIFORM_PACK_MAX_ENTRIES)
                    throw new UniformPackError(
                        "tooLarge",
                        `more than ${UNIFORM_PACK_MAX_ENTRIES} entries`,
                    );
                if (!want(entry.name)) return false;
                total += Math.max(entry.size, entry.originalSize);
                if (total > UNIFORM_PACK_MAX_UNZIPPED_BYTES)
                    throw new UniformPackError(
                        "tooLarge",
                        `over ${UNIFORM_PACK_MAX_UNZIPPED_BYTES} bytes inflated`,
                    );
                return true;
            },
        });
    } catch (error) {
        if (error instanceof UniformPackError) throw error;
        throw new UniformPackError(
            "notPack",
            `the zip can't be opened (${error instanceof Error ? error.message : String(error)})`,
        );
    }
}

/**
 * Reads a pack file: its manifest, checked, and each layer's PNG. Sizes and entry counts are
 * checked from the zip's directory before anything is inflated, and only the manifest and the
 * layers it names are inflated. Throws {@link UniformPackError}.
 */
export function readUniformPack(bytes: Uint8Array): UniformPack {
    if (bytes.byteLength > UNIFORM_PACK_MAX_BYTES)
        throw new UniformPackError(
            "tooLarge",
            `${bytes.byteLength} bytes is over ${UNIFORM_PACK_MAX_BYTES}`,
        );
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
        throw new UniformPackError("notPack", "not a zip");
    const opened = unzipPack(bytes);
    const manifestBytes = opened[MANIFEST];
    if (!manifestBytes)
        throw new UniformPackError("notPack", "no manifest.json");
    let json: unknown;
    try {
        json = JSON.parse(strFromU8(manifestBytes));
    } catch {
        throw new UniformPackError("damaged", "manifest.json isn't JSON");
    }
    const head = z
        .object({
            format: z.literal(ASSET_FILE_FORMAT),
            kind: z.string(),
            formatVersion: z.number(),
        })
        .safeParse(json);
    if (!head.success)
        throw new UniformPackError("notPack", "not an OpenMarch asset file");
    if (head.data.kind !== UNIFORM_ASSET_KIND)
        throw new UniformPackError(
            "notPack",
            `an asset of kind ${head.data.kind}, not a uniform`,
        );
    if (head.data.formatVersion > UNIFORM_PACK_VERSION)
        throw new UniformPackError(
            "newer",
            `format version ${head.data.formatVersion} is newer than ${UNIFORM_PACK_VERSION}`,
        );
    const parsed = uniformPackManifestSchema.safeParse(json);
    if (!parsed.success)
        throw new UniformPackError(
            "damaged",
            `manifest.json: ${parsed.error.message}`,
        );
    const manifest = parsed.data;
    const layers = manifest.layers.map((layer) => {
        const png = opened[layer.file];
        const size = png && pngHeaderSize(png);
        if (!png || !size)
            throw new UniformPackError(
                "damaged",
                `layer ${layer.file} is missing or isn't a PNG`,
            );
        if (size.width * size.height > UNIFORM_LAYER_MAX_PIXELS)
            throw new UniformPackError(
                "tooLarge",
                `layer ${layer.file} is ${size.width} × ${size.height} px`,
            );
        return { id: layer.id, png };
    });
    return { manifest, layers };
}

/** A file name for a pack called `name`: its own characters where a file system allows them */
export function uniformPackFileName(name: string): string {
    const base =
        [...name]
            .map((c) =>
                c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? " " : c,
            )
            .join("")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80) || "uniform";
    return `${base}${ASSET_FILE_EXTENSION}`;
}

/** The name a picked file gives a uniform: its file name without the extension */
export function uniformNameFromFile(fileName: string): string {
    const name = fileName.replace(/\.[^.]+$/, "").trim();
    return (name || "Uniform").slice(0, 120);
}

/** A version 1 manifest with one page layer, `layers/base.png` */
export function singleLayerManifest({
    name,
    look,
    credits = {},
}: {
    name: string;
    look: PresetLook;
    credits?: UniformPackCredits;
}): UniformPackManifest {
    return {
        format: ASSET_FILE_FORMAT,
        formatVersion: UNIFORM_PACK_VERSION,
        preview: true,
        kind: UNIFORM_ASSET_KIND,
        name,
        page: { ...FLATS_PAGE_IN, unit: "in" },
        ...manifestLookOf(look),
        layers: [
            {
                id: "base",
                name: "Base",
                file: "layers/base.png",
                covers: "page",
            },
        ],
        items: [],
        modes: [],
        variants: [],
        credits,
    };
}
