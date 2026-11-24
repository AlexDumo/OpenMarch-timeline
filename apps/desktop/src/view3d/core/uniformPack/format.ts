// cspell:words fflate omasset IHDR zippable Zippable eocd
/**
 * The uniform pack, format versions 1 to 3, a **preview** (docs/3d/uniform-artwork.md, "The
 * uniform pack"; ADR 0010 amendments of 2026-11-24, forks #1257 and #1258). It can still change,
 * and freezes only after a real artist has finished a uniform with it (fork #1259).
 *
 * One pack is one self-contained file, and the same bytes are the show asset of kind `uniform`
 * (one part, `pack`): a pack leaves a show and comes back unchanged. It is a zip holding
 *
 * - `manifest.json`: the asset format, its version, the kind (`uniform`), the name, the page in
 *   real inches, the palette and part options, the layers, the placed items (version 2), the
 *   modes (version 3) and the credits; `variants` and `attachments` are reserved for later steps;
 * - `layers/<id>.png`: each layer, a transparent PNG covering the whole flats page;
 * - `items/<id>.png`: each placed item's image (version 2), a transparent PNG of the art alone.
 *
 * No path outside the zip is ever named. It is the first kind of the portable asset file of epic
 * fork #1262, so the outer fields (`format`, `formatVersion`, `kind`, `name`, `credits`) are
 * meant for every kind; the rest is the uniform's.
 *
 * Every version is strict: unknown keys are refused, and so are non-empty `variants` and
 * `attachments`, which are reserved (and `items` in version 1, `modes` in versions 1 and 2). A
 * field that changes what is drawn bumps `formatVersion`, so an older build refuses that pack
 * instead of drawing it wrong. Version 2 adds only `items` and version 3 only `modes`, so a pack is
 * written as the lowest version that holds it: a build that reads only version 1 still reads a
 * pack with neither, and draws it right.
 *
 * Reading never trusts the zip's sizes: only the manifest and the layers it names are inflated,
 * each one streamed and stopped as soon as it passes its declared size, and an entry whose
 * compressed size couldn't have come from its declared size is refused before inflating. The app
 * reads untrusted packs only in `uniformPack.worker`, so even the bounded work stays off the
 * window's and the editor's main threads.
 *
 * Pure: no DOM, no database. fflate writes the zip and inflates entries.
 */
import { Inflate, strFromU8, strToU8, zipSync, type Zippable } from "fflate";
import { z } from "zod";
import type { PresetLook } from "@/view3d/core/marchers/uniformPresets";

/** The asset kind, in the show store and in the file */
export const UNIFORM_ASSET_KIND = "uniform";
/** What the file is, whatever its kind */
export const ASSET_FILE_FORMAT = "openmarch-asset";
/**
 * The newest pack format version this build reads and writes. A preview until fork #1259; see the
 * module comment. Version 2 (fork #1258) adds placed items, version 3 (fork #1257, step 5) modes.
 */
export const UNIFORM_PACK_VERSION = 3;
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
/** What the entries it reads may hold once inflated, together */
export const UNIFORM_PACK_MAX_UNZIPPED_BYTES = 256 * 1024 * 1024;
/** The manifest is text; more than this is no manifest */
export const UNIFORM_MANIFEST_MAX_BYTES = 1024 * 1024;
export const UNIFORM_PACK_MAX_ENTRIES = 64;
export const UNIFORM_PACK_MAX_LAYERS = 16;
/** Placed items in one pack */
export const UNIFORM_PACK_MAX_ITEMS = 32;
/** Modes in one pack */
export const UNIFORM_PACK_MAX_MODES = 8;
/** A layer image with more pixels than this isn't decoded (4× the page) */
export const UNIFORM_LAYER_MAX_PIXELS =
    4 * FLATS_PAGE_PX.width * FLATS_PAGE_PX.height;
/** An item image with more pixels than this isn't decoded (2048 × 2048) */
export const UNIFORM_ITEM_MAX_PIXELS = 2048 * 2048;
/** Nor one longer than this on either side */
export const UNIFORM_ITEM_MAX_SIDE = 4096;
/** An imported item image is stored at most this many pixels on its long side */
export const UNIFORM_ITEM_STORED_PX = 1024;

const MANIFEST = "manifest.json";

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

/** The palette: the colors shown where the art is clear, and on the parts art can't reach */
const paletteSchema = z.strictObject({
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

/** A layer's, item's or mode's id: what the manifest's lists name each other by */
const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);

/** Part options: the parts the palette draws, or leaves off */
const optionsSchema = z.strictObject({
    stripe: z.boolean(),
    collar: z.boolean(),
    cuffs: z.boolean(),
    gloves: z.boolean(),
    hat: z.boolean(),
});

const layerSchema = z.strictObject({
    id: idSchema,
    name: z.string().max(120),
    /** Its image in the pack */
    file: z.string().regex(/^layers\/[a-z0-9][a-z0-9-]{0,31}\.png$/),
    /** What the image covers; only the whole page in version 1 */
    covers: z.literal("page"),
});

const creditsSchema = z.strictObject({
    license: z.string().max(200).optional(),
    author: z.string().max(200).optional(),
    source: z.string().max(500).optional(),
});

/** A reserved list: written empty or left out, and anything in it is refused */
const reserved = z.array(z.unknown()).max(0).optional();

/** The flats panels an item goes on */
export const FLATS_PANELS = ["front", "back", "cape"] as const;

/** The template's regions, by id (`regions.json`); a tile item names the ones it covers */
export const FLATS_REGION_IDS = [
    "front-torso",
    "front-sleeve-L",
    "front-sleeve-R",
    "front-hips",
    "front-leg-L",
    "front-leg-R",
    "back-torso",
    "back-sleeve-L",
    "back-sleeve-R",
    "back-hips",
    "back-leg-L",
    "back-leg-R",
    "cape",
] as const;
export type FlatsRegionId = (typeof FLATS_REGION_IDS)[number];

/** The panel a region is on */
export const panelOfRegion = (id: FlatsRegionId) =>
    id === "cape" ? "cape" : id.startsWith("front-") ? "front" : "back";

/**
 * How an item follows the 7 body types (docs/3d/uniform-artwork.md, "Grading across the 7 body
 * types"):
 *
 * - `proportional` (the default): scales with the girth factor k and keeps its aspect (logos,
 *   numbers, crests);
 * - `fixed`: exactly its real size on every body (patches, buttons);
 * - `stretch`: widens with girth, like the fabric under it;
 * - `tile`: the image repeated over `regions` at its real size on every body (all-over prints);
 *   `width` and `height` are one tile's size;
 * - `line`: piping or braid: stretches along its length like the fabric and keeps its line width.
 *   The image's width is the line's length, so a vertical line is an item rotated 90°.
 */
export const ITEM_GRADES = [
    "proportional",
    "fixed",
    "stretch",
    "tile",
    "line",
] as const;
export type ItemGrade = (typeof ITEM_GRADES)[number];

/** The smallest tile, inches: smaller ones would draw too many copies */
export const ITEM_MIN_TILE_IN = 1;

const itemSchema = z
    .strictObject({
        id: idSchema,
        /** What the list calls it, such as the picked file's name */
        name: z.string().max(120).optional(),
        /** Its image in the pack; items may share one */
        file: z.string().regex(/^items\/[a-z0-9][a-z0-9-]{0,31}\.png$/),
        panel: z.enum(FLATS_PANELS),
        /** Its centre, panel inches, on the median body */
        at: z.tuple([
            z.number().min(-50).max(150),
            z.number().min(-50).max(150),
        ]),
        /** Its size on the median body, inches: either is enough, the image's aspect gives the other */
        width: z.number().positive().max(120).optional(),
        height: z.number().positive().max(120).optional(),
        /** Degrees, clockwise as seen on the panel */
        rotate: z.number().min(-360).max(360).optional(),
        opacity: z.number().min(0).max(1).optional(),
        grade: z.enum(ITEM_GRADES).optional(),
        /** A tile item's regions, on its panel; only for `tile`, which needs at least one */
        regions: z.array(z.enum(FLATS_REGION_IDS)).min(1).max(13).optional(),
    })
    .superRefine((item, ctx) => {
        if (item.width === undefined && item.height === undefined)
            ctx.addIssue({ code: "custom", message: "an item needs a size" });
        const tile = item.grade === "tile";
        if (tile && !item.regions)
            ctx.addIssue({ code: "custom", message: "a tile needs regions" });
        if (!tile && item.regions)
            ctx.addIssue({
                code: "custom",
                message: "only a tile has regions",
            });
        if (item.regions?.some((r) => panelOfRegion(r) !== item.panel))
            ctx.addIssue({
                code: "custom",
                message: "a tile's regions are on its panel",
            });
        if (
            tile &&
            [item.width, item.height].some(
                (v) => v !== undefined && v < ITEM_MIN_TILE_IN,
            )
        )
            ctx.addIssue({ code: "custom", message: "the tile is too small" });
    });

export type UniformPackItem = z.infer<typeof itemSchema>;

/**
 * A mode (version 3): one way the uniform is worn, such as plain, sash out, or sash out and
 * unzipped (docs/3d/uniform-artwork.md, "Modes and variants"). It names the layers it draws, bottom
 * first (the base, then overlays that hold only what changes), the items that show in it, and the
 * palette roles and part options it changes. The first mode is the default.
 */
const modeSchema = z.strictObject({
    id: idSchema,
    name: z.string().min(1).max(120),
    /** Layer ids, bottom first; at least one, none twice */
    layers: z.array(idSchema).min(1).max(UNIFORM_PACK_MAX_LAYERS),
    /** The item ids that show in this mode, none twice; drawn in the pack's item order */
    items: z.array(idSchema).max(UNIFORM_PACK_MAX_ITEMS),
    /** Palette roles this mode changes */
    palette: paletteSchema.partial().optional(),
    /** Part options this mode changes */
    options: optionsSchema.partial().optional(),
});

export type UniformPackMode = z.infer<typeof modeSchema>;
export type UniformPackLayer = z.infer<typeof layerSchema>;

export const uniformPackManifestSchema = z
    .strictObject({
        format: z.literal(ASSET_FILE_FORMAT),
        /** 1, 2 when it has items, 3 when it has modes */
        formatVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        /** True while the format can still change (fork #1259) */
        preview: z.boolean().optional(),
        kind: z.literal(UNIFORM_ASSET_KIND),
        name: z.string().min(1).max(120),
        /** The flats page, real size */
        page: z.strictObject({
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
        options: optionsSchema,
        /**
         * Bottom first, ids unique. With no modes, every layer is drawn, in this order; with
         * modes, each mode draws the ones it names.
         */
        layers: z.array(layerSchema).min(1).max(UNIFORM_PACK_MAX_LAYERS),
        /**
         * Placed logos, numbers, crests and prints (version 2, fork #1258), drawn over the layers
         * in order, bottom first. Version 1 reserves it: empty or left out.
         */
        items: z.array(itemSchema).max(UNIFORM_PACK_MAX_ITEMS).optional(),
        /**
         * The ways the uniform is worn (version 3, step 5 of fork #1257); the first is the
         * default. Versions 1 and 2 reserve it: empty or left out.
         */
        modes: z.array(modeSchema).max(UNIFORM_PACK_MAX_MODES).optional(),
        /** Reserved for variants: guard, percussion, drum major (fork #1257) */
        variants: reserved,
        /** Reserved for hanging pieces (fork #1261) */
        attachments: reserved,
        credits: creditsSchema,
    })
    .superRefine((manifest, ctx) => {
        const ids = manifest.layers.map((layer) => layer.id);
        const files = manifest.layers.map((layer) => layer.file);
        if (new Set(ids).size !== ids.length)
            ctx.addIssue({ code: "custom", message: "layer ids repeat" });
        if (new Set(files).size !== files.length)
            ctx.addIssue({ code: "custom", message: "layer files repeat" });
        const items = manifest.items ?? [];
        if (manifest.formatVersion === 1 && items.length > 0)
            ctx.addIssue({
                code: "custom",
                message: "version 1 has no items",
            });
        const itemIds = items.map((item) => item.id);
        if (new Set(itemIds).size !== itemIds.length)
            ctx.addIssue({ code: "custom", message: "item ids repeat" });
        const modes = manifest.modes ?? [];
        if (manifest.formatVersion < 3 && modes.length > 0)
            ctx.addIssue({
                code: "custom",
                message: `version ${manifest.formatVersion} has no modes`,
            });
        const modeIds = modes.map((mode) => mode.id);
        if (new Set(modeIds).size !== modeIds.length)
            ctx.addIssue({ code: "custom", message: "mode ids repeat" });
        const layerIds = new Set(ids);
        const itemIdSet = new Set(itemIds);
        for (const mode of modes) {
            if (new Set(mode.layers).size !== mode.layers.length)
                ctx.addIssue({
                    code: "custom",
                    message: `mode ${mode.id} names a layer twice`,
                });
            if (mode.layers.some((id) => !layerIds.has(id)))
                ctx.addIssue({
                    code: "custom",
                    message: `mode ${mode.id} names a layer the pack doesn't have`,
                });
            if (new Set(mode.items).size !== mode.items.length)
                ctx.addIssue({
                    code: "custom",
                    message: `mode ${mode.id} names an item twice`,
                });
            if (mode.items.some((id) => !itemIdSet.has(id)))
                ctx.addIssue({
                    code: "custom",
                    message: `mode ${mode.id} names an item the pack doesn't have`,
                });
        }
    });

export type UniformPackManifest = z.infer<typeof uniformPackManifestSchema>;
export type UniformPackCredits = UniformPackManifest["credits"];

/** A read pack: its manifest, each layer's PNG bytes in the manifest's order, and each item file's */
export interface UniformPack {
    manifest: UniformPackManifest;
    layers: { id: string; png: Uint8Array }[];
    /** Each file the items name, once */
    itemFiles: { file: string; png: Uint8Array }[];
}

/** The lowest format version that holds `manifest`: 3 with modes, else 2 with items, else 1 */
export const requiredPackVersion = (
    manifest: Pick<UniformPackManifest, "items" | "modes">,
): 1 | 2 | 3 =>
    (manifest.modes?.length ?? 0) > 0
        ? 3
        : (manifest.items?.length ?? 0) > 0
          ? 2
          : 1;

/** The files a manifest's items name, each once, in first use order */
export const itemFilesOf = (manifest: Pick<UniformPackManifest, "items">) => [
    ...new Set((manifest.items ?? []).map((item) => item.file)),
];

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

/**
 * The mode `modeId` names, or the default (the first) when it names none the pack has; null for a
 * pack without modes
 */
export function modeOf(
    manifest: Pick<UniformPackManifest, "modes">,
    modeId?: string | null,
): UniformPackMode | null {
    const modes = manifest.modes ?? [];
    return modes.find((m) => m.id === modeId) ?? modes[0] ?? null;
}

/**
 * What a pack draws in mode `modeId` ({@link modeOf}): its layers, bottom first, and its items, in
 * the pack's order. A pack without modes draws every layer and every item.
 */
export function drawnInMode(
    manifest: Pick<UniformPackManifest, "modes" | "layers" | "items">,
    modeId?: string | null,
): { layers: UniformPackLayer[]; items: UniformPackItem[] } {
    const items = manifest.items ?? [];
    const mode = modeOf(manifest, modeId);
    if (!mode) return { layers: [...manifest.layers], items: [...items] };
    const byId = new Map(manifest.layers.map((layer) => [layer.id, layer]));
    const shown = new Set(mode.items);
    return {
        layers: mode.layers.flatMap((id) => byId.get(id) ?? []),
        items: items.filter((item) => shown.has(item.id)),
    };
}

/**
 * The look a pack's manifest describes: the colors under and around its art, with mode `modeId`'s
 * palette and option changes ({@link modeOf}) when it has modes
 */
export function lookOfManifest(
    manifest: UniformPackManifest,
    modeId?: string | null,
): PresetLook {
    const mode = modeOf(manifest, modeId);
    const p = { ...manifest.palette, ...mode?.palette };
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
        options: { ...manifest.options, ...mode?.options },
    };
}

/** The same pack always makes the same bytes: every entry gets this date */
const FIXED_MTIME = new Date(Date.UTC(1980, 0, 1, 12));

/**
 * The pack file for `manifest` and its layers' and items' PNGs, keyed by their `file`. It is
 * written as the lowest version that holds it ({@link requiredPackVersion}), whatever
 * `formatVersion` says. Throws when the manifest doesn't parse or names a file it isn't given.
 */
export function writeUniformPack(
    manifest: UniformPackManifest,
    files: Readonly<Record<string, Uint8Array>>,
): Uint8Array {
    const checked = uniformPackManifestSchema.parse({
        ...manifest,
        formatVersion: requiredPackVersion(manifest),
        items: manifest.items ?? [],
        modes: manifest.modes ?? [],
    });
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
    for (const file of itemFilesOf(checked)) {
        const png = files[file];
        if (!png || !pngHeaderSize(png))
            throw new Error(`uniform pack: item ${file} isn't a PNG`);
        zippable[file] = [png, { level: 0, mtime: FIXED_MTIME }];
    }
    return zipSync(zippable);
}

/** One entry of a zip's central directory */
interface ZipEntry {
    name: string;
    /** 0 stored, 8 deflated */
    method: number;
    /** Compressed size, bytes */
    size: number;
    /** Size once inflated, as the zip declares it */
    originalSize: number;
    /** Where its data starts in the file */
    dataStart: number;
}

const damaged = (reason: string) => new UniformPackError("damaged", reason);

/**
 * The zip's entries from its central directory, read without inflating anything. Refuses
 * encrypted and zip64 entries, and an entry whose sizes can't be true: a stored entry whose
 * compressed and declared sizes differ, or a deflated one larger than deflate makes for its
 * declared size.
 */
function zipDirectory(bytes: Uint8Array): ZipEntry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // the end record is the last 22 bytes plus its comment: a signature inside the comment
    // isn't it, so the record found must end exactly where the file does
    let eocd = -1;
    const lowest = Math.max(0, bytes.length - 22 - 0xffff);
    for (let i = bytes.length - 22; i >= lowest; i--)
        if (
            view.getUint32(i, true) === 0x06054b50 &&
            i + 22 + view.getUint16(i + 20, true) === bytes.length
        ) {
            eocd = i;
            break;
        }
    if (eocd < 0) throw new UniformPackError("notPack", "no zip directory");
    const count = view.getUint16(eocd + 10, true);
    const dirSize = view.getUint32(eocd + 12, true);
    const dirStart = view.getUint32(eocd + 16, true);
    if (count === 0xffff || dirStart === 0xffffffff)
        throw new UniformPackError("notPack", "zip64 isn't read");
    if (count > UNIFORM_PACK_MAX_ENTRIES)
        throw new UniformPackError(
            "tooLarge",
            `more than ${UNIFORM_PACK_MAX_ENTRIES} entries`,
        );
    if (dirStart + dirSize > eocd) throw damaged("the directory overruns");
    const names = new TextDecoder();
    const entries: ZipEntry[] = [];
    let p = dirStart;
    for (let i = 0; i < count; i++) {
        if (p + 46 > eocd || view.getUint32(p, true) !== 0x02014b50)
            throw damaged("a directory entry is cut short");
        const flags = view.getUint16(p + 8, true);
        const method = view.getUint16(p + 10, true);
        const size = view.getUint32(p + 20, true);
        const originalSize = view.getUint32(p + 24, true);
        const nameLength = view.getUint16(p + 28, true);
        const skip =
            nameLength +
            view.getUint16(p + 30, true) +
            view.getUint16(p + 32, true);
        const local = view.getUint32(p + 42, true);
        const name = names.decode(bytes.subarray(p + 46, p + 46 + nameLength));
        p += 46 + skip;
        if (flags & 1) throw new UniformPackError("notPack", "encrypted");
        if (method !== 0 && method !== 8)
            throw damaged(`${name}: compression ${method}`);
        if (method === 0 && size !== originalSize)
            throw damaged(`${name}: stored, but its sizes differ`);
        // deflate never grows data by more than a few bytes per 16 KB block
        if (method === 8 && size > originalSize * 1.01 + 1024)
            throw damaged(
                `${name}: more compressed bytes than its size allows`,
            );
        if (
            local + 30 > bytes.length ||
            view.getUint32(local, true) !== 0x04034b50
        )
            throw damaged(`${name}: no local header`);
        const dataStart =
            local +
            30 +
            view.getUint16(local + 26, true) +
            view.getUint16(local + 28, true);
        if (dataStart + size > bytes.length)
            throw damaged(`${name}: its data overruns the file`);
        if (entries.some((e) => e.name === name))
            throw damaged(`${name} is listed twice`);
        entries.push({ name, method, size, originalSize, dataStart });
    }
    return entries;
}

/** Compressed bytes handed to the inflater at a time: each push can make at most ~1000× this */
const INFLATE_CHUNK = 4096;

/**
 * One entry's bytes, inflated and stopped the moment the output passes its declared size, so a
 * zip that lies about sizes costs no more than what it declares.
 */
function inflateEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
    const data = bytes.subarray(entry.dataStart, entry.dataStart + entry.size);
    if (entry.method === 0) return data.slice();
    const out = new Uint8Array(entry.originalSize);
    let written = 0;
    const inflater = new Inflate((chunk) => {
        if (written + chunk.length > entry.originalSize)
            throw damaged(`${entry.name}: inflates past its declared size`);
        out.set(chunk, written);
        written += chunk.length;
    });
    try {
        for (let i = 0; i < data.length; i += INFLATE_CHUNK)
            inflater.push(
                data.subarray(i, i + INFLATE_CHUNK),
                i + INFLATE_CHUNK >= data.length,
            );
        if (data.length === 0) inflater.push(new Uint8Array(0), true);
    } catch (error) {
        if (error instanceof UniformPackError) throw error;
        throw damaged(
            `${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    if (written !== entry.originalSize)
        throw damaged(`${entry.name}: shorter than its declared size`);
    return out;
}

/**
 * Checks a parsed manifest's head, then the whole of it. `newest` is the newest version taken:
 * this build's, or an older build's when a test reads as that build would.
 */
function parseManifest(json: unknown, newest: number): UniformPackManifest {
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
    if (head.data.formatVersion > newest)
        throw new UniformPackError(
            "newer",
            `format version ${head.data.formatVersion} is newer than ${newest}`,
        );
    const parsed = uniformPackManifestSchema.safeParse(json);
    if (!parsed.success)
        throw damaged(`manifest.json: ${parsed.error.message}`);
    return parsed.data;
}

/**
 * Reads a pack file: its manifest, checked, and each layer's PNG. Entry counts and sizes are
 * checked from the zip's directory first; then only the manifest and the layers it names are
 * inflated, each stopped at its declared size (see the module comment). Throws
 * {@link UniformPackError}. The app calls it only in `uniformPack.worker`.
 */
export function readUniformPack(
    bytes: Uint8Array,
    {
        newest = UNIFORM_PACK_VERSION,
    }: {
        /** The newest format version to take; tests set an older one to read as an older build */
        newest?: number;
    } = {},
): UniformPack {
    if (bytes.byteLength > UNIFORM_PACK_MAX_BYTES)
        throw new UniformPackError(
            "tooLarge",
            `${bytes.byteLength} bytes is over ${UNIFORM_PACK_MAX_BYTES}`,
        );
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
        throw new UniformPackError("notPack", "not a zip");
    const entries = new Map(zipDirectory(bytes).map((e) => [e.name, e]));
    const manifestEntry = entries.get(MANIFEST);
    if (!manifestEntry)
        throw new UniformPackError("notPack", "no manifest.json");
    if (manifestEntry.originalSize > UNIFORM_MANIFEST_MAX_BYTES)
        throw new UniformPackError("tooLarge", "manifest.json is too large");
    let json: unknown;
    try {
        json = JSON.parse(strFromU8(inflateEntry(bytes, manifestEntry)));
    } catch (error) {
        if (error instanceof UniformPackError) throw error;
        throw damaged("manifest.json isn't JSON");
    }
    const manifest = parseManifest(json, newest);
    let total = manifestEntry.originalSize;
    const png = (file: string, what: string, maxPixels: number) => {
        const entry = entries.get(file);
        if (!entry) throw damaged(`${what} ${file} is missing`);
        total += entry.originalSize;
        if (total > UNIFORM_PACK_MAX_UNZIPPED_BYTES)
            throw new UniformPackError(
                "tooLarge",
                `over ${UNIFORM_PACK_MAX_UNZIPPED_BYTES} bytes inflated`,
            );
        const data = inflateEntry(bytes, entry);
        const size = pngHeaderSize(data);
        if (!size) throw damaged(`${what} ${file} isn't a PNG`);
        if (
            size.width * size.height > maxPixels ||
            (what === "item" &&
                Math.max(size.width, size.height) > UNIFORM_ITEM_MAX_SIDE)
        )
            throw new UniformPackError(
                "tooLarge",
                `${what} ${file} is ${size.width} × ${size.height} px`,
            );
        return data;
    };
    const layers = manifest.layers.map((layer) => ({
        id: layer.id,
        png: png(layer.file, "layer", UNIFORM_LAYER_MAX_PIXELS),
    }));
    const itemFiles = itemFilesOf(manifest).map((file) => ({
        file,
        png: png(file, "item", UNIFORM_ITEM_MAX_PIXELS),
    }));
    return { manifest, layers, itemFiles };
}

/** What an edit of a pack changes: any of its layers, items and modes */
export type UniformPackContents = Pick<
    UniformPackManifest,
    "layers" | "items" | "modes"
>;

/**
 * The pack file for `pack` with `contents` in place of its own: the layer and item files it has
 * that the new lists still name kept, and `files` (layer and item PNGs by file) added or put in
 * their place. A list left out of `contents` is kept as it was. Throws when a layer or item names
 * a file neither has, or the manifest doesn't parse.
 */
export function packWithContents(
    pack: UniformPack,
    contents: Partial<UniformPackContents>,
    files: Readonly<Record<string, Uint8Array>> = {},
): Uint8Array {
    const all: Record<string, Uint8Array> = {};
    pack.manifest.layers.forEach((layer, i) => {
        all[layer.file] = pack.layers[i].png;
    });
    for (const { file, png } of pack.itemFiles) all[file] = png;
    for (const [file, png] of Object.entries(files)) all[file] = png;
    return writeUniformPack({ ...pack.manifest, ...contents }, all);
}

/** {@link packWithContents} with only new `items` */
export const packWithItems = (
    pack: UniformPack,
    items: UniformPackItem[],
    files: Readonly<Record<string, Uint8Array>>,
): Uint8Array => packWithContents(pack, { items }, files);

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

/** A manifest with one page layer, `layers/base.png`, and no items (so version 1) */
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
        formatVersion: 1,
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
        attachments: [],
        credits,
    };
}
