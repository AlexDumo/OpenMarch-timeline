// cspell:words omasset
/**
 * A uniform pack's source folder (`uniform.json` plus SVG and PNG art) and how it becomes the
 * app's pack file (docs/3d/uniform-artwork.md, "Ways in"; scripts/uniform-pack/README.md).
 *
 * Pure: no files, no browser. The CLI reads the folder, this module checks what it says and
 * plans the pack; the browser page draws the art with the app's own import code; then
 * {@link assemblePack} writes the file with the app's `writeUniformPack`, so the format is never
 * forked. Every refusal is a sentence an agent can act on.
 */
import { z } from "zod";
import {
    FLATS_PAGE_IN,
    FLATS_PAGE_PX,
    pngHeaderSize,
    requiredPackVersion,
    uniformPackManifestSchema,
    writeUniformPack,
    type UniformPackManifest,
} from "@/view3d/core/uniformPack/format";
import { toBase64 } from "../page/bytes";

/** What a pack source names its art by: a path inside the pack folder */
const fileName = z
    .string()
    .min(1)
    .regex(/\.(svg|png)$/i, "must be an .svg or .png file");

/**
 * The app's own pieces of the manifest schema, so the source's ids, palette roles, part options
 * and styles are whatever the pack format says, never a copy of it
 */
const app = uniformPackManifestSchema.shape;
const appId = app.layers.element.shape.id;
const appHex = app.palette.shape.primary;

/** A string the app's schema `of` takes, else `message` (the app's own wording is a regex) */
const accepted = (of: z.ZodType, message: string) =>
    z.string().refine((v) => of.safeParse(v).success, message);

const idSchema = accepted(
    appId,
    "must be lowercase letters, digits and dashes, starting with a letter or digit, at most 32 characters",
);
const hex = accepted(appHex, 'must be "#rrggbb"');

const paletteSource = z.strictObject(
    Object.fromEntries(
        Object.keys(app.palette.shape).map((role) => [role, hex]),
    ) as Record<keyof typeof app.palette.shape, typeof hex>,
);
const optionsSource = app.options;

const layerSource = z.strictObject({
    id: idSchema,
    name: z.string().min(1).max(120).optional(),
    /** The whole page: an SVG with viewBox "0 0 105 88", or a 3360 × 2816 PNG */
    page: fileName.optional(),
    /** One panel each: an SVG whose viewBox is the panel in inches, or a PNG of its size */
    front: fileName.optional(),
    back: fileName.optional(),
    cape: fileName.optional(),
});

/** An item as the app's schema has it, with `file` the source's art instead of the pack's PNG */
const itemSource = z.strictObject({
    ...app.items.unwrap().element.shape,
    id: idSchema,
    file: fileName,
});

/** A mode as the app's schema has it; its `items` may be left out (none) */
const modeSource = z.strictObject({
    ...app.modes.unwrap().element.shape,
    id: idSchema,
    layers: z.array(idSchema).min(1),
    items: z.array(idSchema).optional(),
    palette: paletteSource.partial().optional(),
});

/** The styles the app's schema takes */
export const STYLES = app.style.options;

/** `uniform.json`: what an author (an agent, usually) writes */
export const packSourceSchema = z.strictObject({
    $schema: z.string().optional(),
    name: z.string().min(1).max(120),
    style: app.style,
    palette: paletteSource,
    options: optionsSource,
    credits: app.credits.optional(),
    layers: z.array(layerSource).min(1),
    items: z.array(itemSource).optional(),
    modes: z.array(modeSource).optional(),
});

export type PackSource = z.infer<typeof packSourceSchema>;
export type LayerSource = PackSource["layers"][number];
export type ItemSource = NonNullable<PackSource["items"]>[number];

export type FlatsPanelName = "front" | "back" | "cape";

/** The panels on the page, inches (`regions.json` → `panels`) */
export type PanelRects = Record<
    FlatsPanelName,
    { x: number; y: number; w: number; h: number }
>;

/** Why a source can't become a pack: every problem found, each one sentence */
export class PackSourceError extends Error {
    constructor(readonly problems: string[]) {
        super(problems.join("\n"));
        this.name = "PackSourceError";
    }
}

/** A zod issue's path as `layers[0].front` */
function pathOf(path: readonly PropertyKey[]): string {
    return path
        .map((p, i) =>
            typeof p === "number" ? `[${p}]` : `${i ? "." : ""}${String(p)}`,
        )
        .join("");
}

function issueText(issue: z.core.$ZodIssue, where: string): string {
    const at = pathOf(issue.path);
    const place = at ? `${where} ${at}` : where;
    if (issue.code === "unrecognized_keys")
        return `${place}: unknown key${issue.keys.length > 1 ? "s" : ""} ${issue.keys.map((k) => `"${k}"`).join(", ")}`;
    if (issue.code === "invalid_type" && issue.input === undefined)
        return `${place}: missing`;
    return `${place}: ${issue.message}`;
}

/** The parsed `uniform.json`, or every problem with it */
export function parsePackSource(json: unknown): PackSource {
    const parsed = packSourceSchema.safeParse(json);
    if (!parsed.success)
        throw new PackSourceError(
            parsed.error.issues.map((i) => issueText(i, "uniform.json")),
        );
    return parsed.data;
}

/** One image the browser draws: a layer's page, or an item's art */
export type RasterJob =
    | {
          kind: "layer";
          /** The layer's id */
          id: string;
          /** The page as one file, or panels to place on a page */
          page?: string;
          panels?: Partial<Record<FlatsPanelName, string>>;
      }
    | {
          kind: "item";
          /** The source file; items that share it share one image */
          file: string;
          /** Where the pack stores it */
          packFile: string;
      };

/** A source checked and planned: the manifest the pack will have and what to rasterize */
export interface PackPlan {
    manifest: UniformPackManifest;
    rasters: RasterJob[];
    /** Every source file the plan reads */
    files: string[];
}

const layerFile = (id: string) => `layers/${id}.png`;
const itemFile = (id: string) => `items/${id}.png`;

/**
 * Checks a source against the app's own pack schema and plans its pack. Collects every problem it
 * can find before refusing. `exists` says whether a file the source names is in the folder.
 */
export function planPack(
    source: PackSource,
    exists: (file: string) => boolean,
): PackPlan {
    const problems: string[] = [];
    const files = new Set<string>();
    const need = (file: string, where: string) => {
        files.add(file);
        if (!exists(file))
            problems.push(`${where}: ${file} isn't in the pack folder`);
    };

    const rasters: RasterJob[] = [];
    source.layers.forEach((layer, i) => {
        const where = `layer "${layer.id}" (layers[${i}])`;
        const panels = (["front", "back", "cape"] as const).filter(
            (p) => layer[p] !== undefined,
        );
        if (layer.page && panels.length)
            problems.push(
                `${where}: give "page" or panels ("front", "back", "cape"), not both`,
            );
        else if (!layer.page && !panels.length)
            problems.push(
                `${where}: needs "page" (the whole 105 × 88 in page) or at least one of "front", "back", "cape"`,
            );
        if (layer.page) need(layer.page, where);
        for (const p of panels) need(layer[p]!, `${where} ${p}`);
        rasters.push({
            kind: "layer",
            id: layer.id,
            ...(layer.page
                ? { page: layer.page }
                : {
                      panels: Object.fromEntries(
                          panels.map((p) => [p, layer[p]!]),
                      ),
                  }),
        });
    });

    // items that share a source file share one image in the pack, named after the first
    const packFileOf = new Map<string, string>();
    const items = (source.items ?? []).map((item, i) => {
        need(item.file, `item "${item.id}" (items[${i}])`);
        let packFile = packFileOf.get(item.file);
        if (!packFile) {
            packFile = itemFile(item.id);
            packFileOf.set(item.file, packFile);
            rasters.push({ kind: "item", file: item.file, packFile });
        }
        const { file: _file, ...rest } = item;
        return { ...rest, file: packFile };
    });

    const modes = source.modes ?? [];

    const draft = {
        format: "openmarch-asset",
        formatVersion: 1,
        preview: true,
        kind: "uniform",
        name: source.name,
        page: { ...FLATS_PAGE_IN, unit: "in" },
        style: source.style,
        palette: lowerHex(source.palette),
        options: source.options,
        layers: source.layers.map((l) => ({
            id: l.id,
            name: l.name ?? l.id,
            file: layerFile(l.id),
            covers: "page",
        })),
        items,
        ...(modes.length
            ? {
                  modes: modes.map((m) => ({
                      ...m,
                      items: m.items ?? [],
                      ...(m.palette ? { palette: lowerHex(m.palette) } : {}),
                  })),
              }
            : {}),
        variants: [],
        attachments: [],
        credits: source.credits ?? {},
    } as unknown as UniformPackManifest;
    const manifest = {
        ...draft,
        formatVersion: requiredPackVersion(draft),
    } as UniformPackManifest;
    const checked = uniformPackManifestSchema.safeParse(manifest);
    if (!checked.success)
        for (const issue of checked.error.issues)
            problems.push(appIssueText(issue, source));
    if (problems.length) throw new PackSourceError(problems);
    return { manifest: checked.data!, rasters, files: [...files] };
}

/** The app schema's issue, pointed back at the source's own words */
function appIssueText(issue: z.core.$ZodIssue, source: PackSource): string {
    const [list, index] = issue.path;
    let where = "uniform.json";
    if (list === "items" && typeof index === "number")
        where = `item "${source.items?.[index]?.id}" (items[${index}])`;
    else if (list === "layers" && typeof index === "number")
        where = `layer "${source.layers[index]?.id}" (layers[${index}])`;
    else if (list === "modes" && typeof index === "number")
        where = `mode "${source.modes?.[index]?.id}" (modes[${index}])`;
    const rest = pathOf(issue.path.slice(typeof index === "number" ? 2 : 0));
    const field = rest.replace(/^\./, "");
    const message =
        issue.code === "invalid_type" && issue.input === undefined
            ? "missing"
            : issue.message;
    return `${where}${field ? ` ${field}` : ""}: ${message} (the app's pack schema)`;
}

function lowerHex<T extends Record<string, string | undefined>>(o: T): T {
    return Object.fromEntries(
        Object.entries(o).map(([k, v]) => [k, v?.toLowerCase()]),
    ) as T;
}

/** An SVG's viewBox from its root tag, as four numbers, or null */
export function rootViewBox(
    text: string,
): [number, number, number, number] | null {
    const root = /<svg\b[^>]*>/i.exec(text);
    if (!root) return null;
    const m = /\bviewBox\s*=\s*["']([^"']*)["']/i.exec(root[0]);
    if (!m) return null;
    const n = m[1]
        .trim()
        .split(/[\s,]+/)
        .map(Number);
    return n.length === 4 && n.every(Number.isFinite)
        ? (n as [number, number, number, number])
        : null;
}

const near = (a: number, b: number, tolerance = 0.01) =>
    Math.abs(a - b) <= tolerance;

/**
 * Checks one layer file's size before it's drawn: a page SVG's viewBox is the page in inches, a
 * panel SVG's is its panel's; a PNG is the page (or panel) at 32 px/in. The app fits anything
 * else with a note; the builder refuses instead, so art never lands somewhere it wasn't drawn.
 * Returns the problem, or null.
 */
export function layerFileProblem(
    where: string,
    file: string,
    bytes: Uint8Array,
    target: "page" | FlatsPanelName,
    panels: PanelRects,
): string | null {
    const size =
        target === "page"
            ? FLATS_PAGE_IN
            : { width: panels[target].w, height: panels[target].h };
    const dpi = FLATS_PAGE_PX.width / FLATS_PAGE_IN.width;
    const wantPx = {
        width: Math.round(size.width * dpi),
        height: Math.round(size.height * dpi),
    };
    const what = target === "page" ? "the page" : `the ${target} panel`;
    if (/\.png$/i.test(file)) {
        const px = pngHeaderSize(bytes);
        if (!px) return `${where}: ${file} isn't a PNG`;
        if (px.width !== wantPx.width || px.height !== wantPx.height)
            return `${where}: ${file} is ${px.width} × ${px.height} px; ${what} is ${wantPx.width} × ${wantPx.height} px (${size.width} × ${size.height} in at 32 px/in)`;
        return null;
    }
    const text = new TextDecoder().decode(bytes);
    if (!/<svg\b/i.test(text)) return `${where}: ${file} isn't an SVG`;
    const box = rootViewBox(text);
    if (!box)
        return `${where}: ${file} has no viewBox; give its root viewBox="0 0 ${size.width} ${size.height}" (${what} in inches)`;
    const ok =
        near(box[0], 0) &&
        near(box[1], 0) &&
        near(box[2], size.width) &&
        near(box[3], size.height);
    if (!ok)
        return `${where}: ${file}'s viewBox is "${box.join(" ")}"; ${what} is viewBox="0 0 ${size.width} ${size.height}" (inches${target === "page" ? "" : ", panel coordinates as in uniform-regions.json"})`;
    return null;
}

/**
 * A page SVG (viewBox "0 0 105 88") holding each panel's art where its panel sits. Each panel is
 * an `<image>` of its own file, so ids inside the front and back SVGs can't clash, and the
 * browser draws each at the page's resolution.
 */
export function pageSvgFromPanels(
    parts: Partial<Record<FlatsPanelName, { file: string; bytes: Uint8Array }>>,
    panels: PanelRects,
): string {
    const images = (["front", "back", "cape"] as const)
        .filter((p) => parts[p])
        .map((p) => {
            const { file, bytes } = parts[p]!;
            const type = /\.png$/i.test(file) ? "image/png" : "image/svg+xml";
            const r = panels[p];
            return `<image x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" preserveAspectRatio="none" href="data:${type};base64,${toBase64(bytes)}"/>`;
        });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FLATS_PAGE_IN.width} ${FLATS_PAGE_IN.height}">${images.join("")}</svg>`;
}

/**
 * The pack file for a plan and its rasterized images (layer PNGs by layer id, item PNGs by pack
 * file), written by the app's own writer.
 */
export function assemblePack(
    plan: PackPlan,
    layers: Readonly<Record<string, Uint8Array>>,
    itemImages: Readonly<Record<string, Uint8Array>>,
): Uint8Array {
    const files: Record<string, Uint8Array> = { ...itemImages };
    for (const layer of plan.manifest.layers)
        files[layer.file] = layers[layer.id];
    return writeUniformPack(plan.manifest, files);
}
