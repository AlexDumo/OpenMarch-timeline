/**
 * Uniform artwork drawn as front/back flats (docs/3d/uniform-artwork.md):
 * what a look's flats are, the built-in sample, and the pure math the
 * renderer composes them with (the atlas layout, grading placed items for a
 * body type, the region under a point).
 *
 * The geometry (region outlines, lookup tables, grade factors) is generated
 * by `scripts/view3d-assets/uniform-flats.mjs` into
 * `assets/uniform-flats/`; `regions.json` there is the template's numbers.
 *
 * Pure: no three.js, React or database.
 */
import type { PresetLook } from "./uniformPresets";
import type { BodyType } from "./looks";
import {
    ITEM_MIN_TILE_IN,
    type ItemGrade,
} from "@/view3d/core/uniformPack/format";

export type { ItemGrade } from "@/view3d/core/uniformPack/format";

/** A segment of the hybrid wrap, as `layout.json` lists it. */
export interface FlatsSegment {
    id: string;
    rowStart: number;
    rows: number;
    /** t range (m) along the segment's axis. */
    tStart: number;
    tEnd: number;
    /** Flat y (in) of the segment's t = 0. */
    y0: number;
}

/** `assets/uniform-flats/layout.json`: what the renderer needs. */
export interface FlatsLayout {
    angles: number;
    rows: number;
    median: BodyType;
    bodies: BodyType[];
    sheet: { w: number; h: number };
    panels: Record<FlatsPanel, PanelRect>;
    centreX: number;
    segments: FlatsSegment[];
    /** Heights (m), and how far down each thigh it blends from the hips (`legEase`, m). */
    tops: { torso: number; hips: number; crotch: number; legEase: number };
    /** Per body type: the jacket closer than this (m) to the neck's axis is the neck. */
    neckR: Record<string, number>;
    limbs: {
        id: string;
        head: number[];
        dir: number[];
        fwd: number[];
        side: number[];
        /** Bone length, m. */
        length: number;
    }[];
    planes: { id: string; at: number[]; n: number[] }[];
    cape: { yTop: number; w: number; h: number };
    /** Grade factor per body, segment and row: [front, back]. */
    k: Record<string, Record<string, [number, number][]>>;
}

export type FlatsPanel = "front" | "back" | "cape";

export interface PanelRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** A region of `regions.json` (panel inches). */
export interface FlatsRegion {
    id: string;
    panel: FlatsPanel;
    part: string;
    polygon: [number, number][];
}

/** The part of `regions.json` the renderer reads. */
export interface FlatsRegions {
    panels: Record<FlatsPanel, PanelRect>;
    centreX: number;
    regions: FlatsRegion[];
    landmarks: Record<string, unknown>;
}

/**
 * Art placed over the flats: a logo, crest, number or print. How it follows
 * the body types is its `grade` (see `ItemGrade` in the pack format).
 */
export interface FlatsItem {
    /** File name in the artwork's folder, or in the pack. */
    file: string;
    /** Centre, panel inches. */
    at: readonly [number, number];
    /** Size as worn by the median body, inches; one of them is enough. */
    width?: number;
    height?: number;
    /** Degrees, clockwise as seen on the panel. */
    rotate?: number;
    opacity?: number;
    /** Default `proportional`. */
    grade?: ItemGrade;
    /** A tile's regions (ids), on the item's panel. */
    regions?: readonly string[];
}

/** A look's flats: one image per panel (exactly the panel) plus placed items. */
export interface FlatsArt {
    front?: string;
    back?: string;
    cape?: string;
    items?: Partial<Record<FlatsPanel, FlatsItem[]>>;
}

/** A uniform with flats: its palette (shown where the art is clear) and its art. */
export interface FlatsUniform {
    look: PresetLook;
    art: FlatsArt;
}

/** The built-in flats uniforms. "sample" is the preview's original design. */
export const UNIFORM_ARTWORK_IDS = ["sample"] as const;
export type UniformArtworkId = (typeof UNIFORM_ARTWORK_IDS)[number];

/**
 * `id` if it names a built-in flats uniform, otherwise null.
 */
export function uniformArtworkOf(id: unknown): UniformArtworkId | null {
    return (UNIFORM_ARTWORK_IDS as readonly unknown[]).includes(id)
        ? (id as UniformArtworkId)
        : null;
}

/**
 * A show's imported uniform as the venue's `uniformArtwork` names it: the
 * show asset of kind `uniform` it is stored as, `library:<id>@<version hash>`
 * (fork #1257, `src/showAssets/ref.ts`).
 */
export type UniformPackValue = `library:${string}`;

/** What flats a look wears: a built-in's id, or a show's pack. */
export type FlatsArtworkKey = UniformArtworkId | UniformPackValue;

/**
 * What the venue's `uniformArtwork` dresses the band in: a built-in's id, a
 * show's pack (`library:…`), or null for the preset. Anything else this build
 * doesn't know (a number, a later build's id) falls back to the preset
 * instead of failing the whole venue.
 */
export function flatsArtworkOf(value: unknown): FlatsArtworkKey | null {
    const builtIn = uniformArtworkOf(value);
    if (builtIn) return builtIn;
    return typeof value === "string" &&
        /^library:[^@\s]+@[0-9a-f]{64}$/.test(value)
        ? (value as UniformPackValue)
        : null;
}

/** True for a key that names a show's pack rather than a built-in. */
export const isUniformPackValue = (
    key: FlatsArtworkKey,
): key is UniformPackValue => key.startsWith("library:");

/** A flats uniform as a look wears it: which art, and the palette around it. */
export interface FlatsWear {
    key: FlatsArtworkKey;
    look: PresetLook;
}

/** Landmarks of the flats template (`regions.json`), panel inches. */
export const FLATS_CENTRE_X = 17;
export const CHEST_CENTRE_Y = 25.32;
export const BACK_NUMBER_CENTRE_Y = 28.47;

// the sample's palette: OpenMarch's midnight and purple, gold trim
const OM = 0x6442ff;
const OM_NIGHT = 0x170d4a;
const GOLD = 0xd8b04a;
const WHITE = 0xf2f2ee;
const SHOE_BLACK = 0x0b0b0d;

/**
 * The sample uniform (an original design): a midnight jacket with a purple
 * chevron and a crest on the chest, a gold band round each forearm, a gold
 * stripe down each leg and a number on the back. The art is generated by
 * `scripts/view3d-assets/uniform-flats-sample.mjs`.
 */
export const SAMPLE_FLATS: FlatsUniform = {
    look: {
        style: "classic",
        colors: {
            primary: OM_NIGHT,
            secondary: WHITE,
            accent: GOLD,
            trim: GOLD,
            pants: OM_NIGHT,
            shoes: SHOE_BLACK,
            gloves: WHITE,
            hat: OM_NIGHT,
            plume: OM,
            visor: GOLD,
        },
        // the art draws the stripe; the palette keeps the collar and cuffs
        options: {
            stripe: false,
            collar: true,
            cuffs: true,
            gloves: true,
            hat: true,
        },
    },
    art: {
        front: "front.svg",
        back: "back.svg",
        items: {
            front: [
                {
                    file: "crest.svg",
                    at: [FLATS_CENTRE_X, CHEST_CENTRE_Y],
                    width: 6,
                },
            ],
            back: [
                {
                    file: "number.svg",
                    at: [FLATS_CENTRE_X, BACK_NUMBER_CENTRE_Y],
                    height: 8,
                },
            ],
        },
    },
};

export const UNIFORM_ARTWORK: Readonly<Record<UniformArtworkId, FlatsUniform>> =
    { sample: SAMPLE_FLATS };

/** How far each region's edge pixels are copied outward, inches. */
export const FLATS_BLEED_IN = 1.5;

/** Atlas pixels per inch: 16 at `low`, 32 at `high`. */
export function flatsDpi(quality: "low" | "high"): number {
    return quality === "high" ? 32 : 16;
}

/**
 * Where each panel sits in a look's atlas (inches): the front and back
 * panels side by side, cropped to the garment regions plus the bleed, then
 * the cape panel when the look has cape art.
 */
export function flatsAtlasLayout(
    regions: FlatsRegions,
    hasCape: boolean,
): {
    w: number;
    h: number;
    front: [number, number];
    back: [number, number];
    cape: [number, number] | null;
    /** The panel y the atlas's top row shows. */
    yTop: number;
} {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const r of regions.regions) {
        if (r.panel === "cape") continue;
        for (const [, y] of r.polygon) {
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
        }
    }
    const pad = FLATS_BLEED_IN + 0.5;
    const yTop = Math.max(0, Math.floor(y0 - pad));
    const yBottom = Math.min(regions.panels.front.h, Math.ceil(y1 + pad));
    const pw = regions.panels.front.w;
    const cape = regions.panels.cape;
    return {
        w: 2 * pw + (hasCape ? cape.w : 0),
        h: Math.max(yBottom - yTop, hasCape ? cape.h : 0),
        front: [0, -yTop],
        back: [pw, -yTop],
        cape: hasCape ? [2 * pw, 0] : null,
        yTop,
    };
}

/** Even-odd point in polygon. */
export function insidePolygon(
    poly: readonly (readonly [number, number])[],
    x: number,
    y: number,
): boolean {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        const crosses = yi > y ? yj <= y : yj > y;
        if (crosses && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
}

const REGION_SEGMENTS: Record<string, string[]> = {
    torso: ["torso"],
    hips: ["hips"],
    "sleeve-L": ["upper-arm-L", "forearm-L"],
    "sleeve-R": ["upper-arm-R", "forearm-R"],
    "leg-L": ["thigh-L", "shin-L"],
    "leg-R": ["thigh-R", "shin-R"],
};
const IN = 0.0254;

/**
 * The region under panel point (x, y) and body `body`'s grade factor k
 * there (its girth against the median's), or region null and k 1.
 */
export function gradeAt(
    layout: FlatsLayout,
    regions: FlatsRegions,
    body: string,
    panel: FlatsPanel,
    x: number,
    y: number,
): { region: string | null; k: number } {
    if (panel === "cape") return { region: "cape", k: 1 };
    const hit = regions.regions.find(
        (r) => r.panel === panel && insidePolygon(r.polygon, x, y),
    );
    if (!hit) return { region: null, k: 1 };
    // the segment of the region at this height: the one whose rows cover y
    let best: { s: FlatsSegment; f: number; d: number } | null = null;
    for (const id of REGION_SEGMENTS[hit.part] ?? []) {
        const s = layout.segments.find((q) => q.id === id);
        if (!s) continue;
        const t = (y - s.y0) * IN;
        const f = (t - s.tStart) / (s.tEnd - s.tStart);
        const d = f < 0 ? -f : f > 1 ? f - 1 : 0;
        if (!best || d < best.d)
            best = { s, f: Math.min(1, Math.max(0, f)), d };
    }
    const rows = best && layout.k[body]?.[best.s.id];
    if (!best || !rows) return { region: hit.id, k: 1 };
    const k =
        rows[Math.round(best.f * (rows.length - 1))][panel === "front" ? 0 : 1];
    return { region: hit.id, k };
}

/**
 * How to draw a placed item on body `body`'s atlas: its box as worn by the
 * median body (`w`, `h`, inches) and the scale to draw it with (`sx`, `sy`,
 * applied on the atlas after the item's rotation). The lookup tables already
 * widen everything by the girth factor k, so a proportional item is drawn k
 * times taller (k times its size on the body, aspect kept), a fixed one 1/k
 * as wide (its real size), a stretched one as is.
 *
 * A `line` is drawn as is, then its own height (the line's width) scaled by
 * `ly` before it is rotated: the body widens the atlas k times across, which
 * thickens a line at angle θ by k / √(k² cos² θ + sin² θ), so `ly` is the
 * inverse and the line keeps its width while its length follows the fabric.
 * A tile is laid out by {@link tileLayout}; here it reads as `stretch`.
 */
export function itemDraw(
    item: FlatsItem,
    aspect: number,
    k: number,
): { w: number; h: number; sx: number; sy: number; ly?: number } {
    let w: number;
    let h: number;
    if (item.width && item.height) {
        w = item.width;
        h = item.height;
    } else if (item.width) {
        w = item.width;
        h = item.width / aspect;
    } else if (item.height) {
        h = item.height;
        w = item.height * aspect;
    } else throw new Error(`uniform flats: item ${item.file} needs a size`);
    const grade = item.grade ?? "proportional";
    if (grade === "line") {
        const a = ((item.rotate ?? 0) * Math.PI) / 180;
        const ly = Math.hypot(k * Math.cos(a), Math.sin(a)) / k;
        return { w, h, sx: 1, sy: 1, ly };
    }
    const [sx, sy] =
        grade === "proportional"
            ? [1, k]
            : grade === "fixed"
              ? [1 / k, 1]
              : [1, 1];
    return { w, h, sx, sy };
}

/** One horizontal strip of a placed item as the atlas draws it. */
export interface ItemStrip {
    /** Its top, inches below the item's centre (negative above). */
    top: number;
    height: number;
    /** How wide it is drawn: `target / k` of its row. */
    sx: number;
}

/**
 * How to draw a `proportional` or `fixed` item on body `body`'s atlas so it
 * keeps its shape row by row. The table widens each atlas row by its own k,
 * and k changes fast down the chest of the fuller bodies (on `neutral-full`
 * from 1.02 to 1.40 over 7 in), so one scale per item would leave a round
 * crest egg-shaped. Instead the item is cut into strips `strip` inches tall,
 * each drawn `target / k(row)` as wide, so on the body every row is `target`
 * times its width: `target` is the k under the centre for `proportional`
 * (scaled with the body, aspect kept) and 1 for `fixed` (real size).
 *
 * `half` is half the item's drawn height. Rows off the garment keep the
 * centre's factor.
 */
export function itemStrips(
    layout: FlatsLayout,
    regions: FlatsRegions,
    body: string,
    panel: FlatsPanel,
    at: readonly [number, number],
    half: number,
    target: number,
    strip: number,
): ItemStrip[] {
    const [cx, cy] = at;
    const centre = gradeAt(layout, regions, body, panel, cx, cy).k;
    const n = Math.max(1, Math.ceil((2 * half) / strip));
    const out: ItemStrip[] = [];
    for (let i = 0; i < n; i++) {
        const top = -half + i * strip;
        const height = Math.min(strip, half - top);
        const row = gradeAt(
            layout,
            regions,
            body,
            panel,
            cx,
            cy + top + height / 2,
        );
        out.push({ top, height, sx: target / (row.region ? row.k : centre) });
    }
    return out;
}

/** An item's size on the median body from its width or height and its image's aspect. */
export function itemSize(
    item: Pick<FlatsItem, "width" | "height" | "grade">,
    aspect: number,
): { w: number; h: number } | null {
    let w: number;
    let h: number;
    if (item.width && item.height) [w, h] = [item.width, item.height];
    else if (item.width) [w, h] = [item.width, item.width / aspect];
    else if (item.height) [w, h] = [item.height * aspect, item.height];
    else return null;
    // the side the image's shape gives can be anything: a 1 × 2048 px image 120 in wide would be
    // 245,760 in tall. Such an item isn't drawn (the item list says so).
    const least = item.grade === "tile" ? ITEM_MIN_TILE_IN : 0;
    // a tile under 1 in either way would draw too many copies
    if (
        !Number.isFinite(w) ||
        !Number.isFinite(h) ||
        w > ITEM_MAX_IN ||
        h > ITEM_MAX_IN ||
        w <= 0 ||
        h <= 0 ||
        w < least ||
        h < least
    )
        return null;
    return { w, h };
}

/** The smallest a size field takes, inches: a tile's 1 in, else a quarter inch */
export const itemFieldMin = (grade: ItemGrade | undefined) =>
    grade === "tile" ? ITEM_MIN_TILE_IN : 0.25;

/** Under this, inches, an item's thinner side draws nothing visible (a pixel at 32 px/in) */
export const ITEM_MIN_VISIBLE_IN = 1 / 32;

/**
 * The sizes the Size field can take for an image of `aspect` (width over height) sized by
 * `sizeBy`, so the item is drawn and seen: within the field's own limits, its other side at most
 * 120 in (and, for a tile, at least 1 in), and its thinner side at least
 * {@link ITEM_MIN_VISIBLE_IN} (except a tile, whose copies are at least 1 in anyway). Null when
 * no size works: the image is too long and thin for this grade.
 */
export function itemSizeRange(
    aspect: number,
    sizeBy: "width" | "height",
    grade: ItemGrade | undefined,
): { lo: number; hi: number } | null {
    if (!(aspect > 0) || !Number.isFinite(aspect)) return null;
    // the other side is `v * ratio`
    const ratio = sizeBy === "width" ? 1 / aspect : aspect;
    const tile = grade === "tile";
    let lo = itemFieldMin(grade);
    let hi = ITEM_MAX_IN;
    hi = Math.min(hi, ITEM_MAX_IN / ratio);
    lo = Math.max(lo, (tile ? ITEM_MIN_TILE_IN : ITEM_MIN_VISIBLE_IN) / ratio);
    if (!tile) lo = Math.max(lo, ITEM_MIN_VISIBLE_IN);
    return lo <= hi ? { lo, hi } : null;
}

/** What the item list says about an item's size, and how to fix it */
export type ItemSizeAdvice =
    | { state: "ok" }
    | {
          /** `notDrawn`: a side is out of range; `tooThin`: drawn, but too thin to see */
          state: "notDrawn" | "tooThin";
          /** Its thinner side, inches, for `tooThin` */
          thickness: number;
          fix:
              | { kind: "range"; lo: number; hi: number }
              | {
                    kind: "otherSide";
                    side: "width" | "height";
                    lo: number;
                    hi: number;
                }
              /** No size works: the image is `ratio` times longer than it is wide */
              | { kind: "none"; ratio: number };
      };

/**
 * Whether `item`, an image of `aspect`, is drawn and visible at its size, and if not, what size
 * would be: a range for its Size field, the same by its other side, or none at all (a 1024 × 1
 * line can't be a repeating print: copies 1 in tall would be 1024 in wide).
 */
export function itemSizeAdvice(
    item: Pick<FlatsItem, "width" | "height" | "grade">,
    aspect: number,
): ItemSizeAdvice {
    const box = itemSize(item, aspect);
    const tile = item.grade === "tile";
    const thickness = box ? Math.min(box.w, box.h) : 0;
    const state: "ok" | "notDrawn" | "tooThin" = !box
        ? "notDrawn"
        : !tile && thickness < ITEM_MIN_VISIBLE_IN
          ? "tooThin"
          : "ok";
    if (state === "ok") return { state };
    const sizeBy = item.width !== undefined ? "width" : "height";
    const other = sizeBy === "width" ? "height" : "width";
    const own = itemSizeRange(aspect, sizeBy, item.grade);
    const alt = itemSizeRange(aspect, other, item.grade);
    return {
        state,
        thickness,
        fix: own
            ? { kind: "range", ...own }
            : alt
              ? { kind: "otherSide", side: other, ...alt }
              : { kind: "none", ratio: Math.max(aspect, 1 / aspect) },
    };
}

/**
 * Switching an item's Size by keeps its size exactly: the new number is its other side's length,
 * unrounded. Refused (`ok: false`) when that length is outside the Size field's limits.
 */
export function sizeBySwitch(
    item: Pick<FlatsItem, "width" | "height" | "grade">,
    aspect: number,
    to: "width" | "height",
): { ok: boolean; value: number } {
    const from = item.width !== undefined ? "width" : "height";
    const v = (from === "width" ? item.width : item.height) ?? 0;
    const value = from === to ? v : to === "height" ? v / aspect : v * aspect;
    const ok =
        Number.isFinite(value) &&
        value >= itemFieldMin(item.grade) &&
        value <= ITEM_MAX_IN;
    return { ok, value };
}

/** The largest side an item is drawn at, inches */
export const ITEM_MAX_IN = 120;
/** A tile item's region with more tiles than this isn't drawn */
export const MAX_TILES_PER_REGION = 4000;

/** One region's tiles: where each sits on the atlas's panel (inches) and how big. */
export interface RegionTiles {
    region: string;
    /** The region's outline, panel inches: the tiles are clipped to it. */
    polygon: readonly (readonly [number, number])[];
    /** Each tile's top-left, panel inches. */
    origins: [number, number][];
    /** One tile's size on the atlas: `w` is 1/k of its real width. */
    w: number;
    h: number;
    k: number;
}

/**
 * Where a tile item's copies go on body `body`'s atlas (docs/3d/uniform-
 * artwork.md, "Grading"): in each of its regions, tiles `tw` × `th` inches
 * drawn 1/k as wide, with k the region's grade factor at its middle (as the
 * study's prototype does), so on the body each tile is its real size. The
 * columns are centred on the region's centre line, so the print is
 * symmetric about it; the rows run through the item's `at` height, so a
 * print lines up from one region to the next.
 */
export function tileLayout(
    layout: FlatsLayout,
    regions: FlatsRegions,
    body: string,
    panel: FlatsPanel,
    item: Pick<FlatsItem, "at" | "regions">,
    tw: number,
    th: number,
): RegionTiles[] {
    const out: RegionTiles[] = [];
    for (const r of regions.regions) {
        if (r.panel !== panel || !item.regions?.includes(r.id)) continue;
        const xs = r.polygon.map((q) => q[0]);
        const ys = r.polygon.map((q) => q[1]);
        const x0 = Math.min(...xs);
        const x1 = Math.max(...xs);
        const y0 = Math.min(...ys);
        const y1 = Math.max(...ys);
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        const k =
            panel === "cape"
                ? 1
                : gradeAt(layout, regions, body, panel, mx, my).k || 1;
        const w = tw / k;
        // a column centred on mx, and a row whose middle is at the item's height
        const first = mx - w / 2 - Math.ceil((mx - w / 2 - x0) / w) * w;
        const rowStart = item.at[1] - th / 2;
        const top = rowStart - Math.ceil((rowStart - y0) / th) * th;
        const cols = Math.ceil((x1 - first) / w);
        const rows = Math.ceil((y1 - top) / th);
        // too many copies to draw: the region is left plain
        if (!(cols * rows <= MAX_TILES_PER_REGION)) continue;
        const origins: [number, number][] = [];
        for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++)
                origins.push([first + c * w, top + r * th]);
        out.push({ region: r.id, polygon: r.polygon, origins, w, h: th, k });
    }
    return out;
}

/** A place an item can be put with one pick: its panel and centre (panel inches). */
export interface ItemPreset {
    id: "chest" | "backNumber" | "sleeveLeft" | "sleeveRight";
    panel: FlatsPanel;
    at: [number, number];
}

/** The x middle of a polygon's span at height y, or null when y misses it. */
function spanMiddle(
    polygon: readonly (readonly [number, number])[],
    y: number,
): number | null {
    const xs: number[] = [];
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
    }
    if (xs.length < 2) return null;
    return (Math.min(...xs) + Math.max(...xs)) / 2;
}

/**
 * The places the item list offers (docs/3d/uniform-artwork.md, "Placing
 * items"): the chest centre, the back number centre, and each sleeve's
 * upper arm on the front panel (a fifth of the way down the sleeve, in the
 * middle of its width). Read from the region outlines, so they follow the
 * template.
 */
export function itemPresets(regions: FlatsRegions): ItemPreset[] {
    const presets: ItemPreset[] = [
        { id: "chest", panel: "front", at: [FLATS_CENTRE_X, CHEST_CENTRE_Y] },
        {
            id: "backNumber",
            panel: "back",
            at: [FLATS_CENTRE_X, BACK_NUMBER_CENTRE_Y],
        },
    ];
    for (const [id, region] of [
        ["sleeveLeft", "front-sleeve-L"],
        ["sleeveRight", "front-sleeve-R"],
    ] as const) {
        const r = regions.regions.find((q) => q.id === region);
        if (!r) continue;
        const ys = r.polygon.map((q) => q[1]);
        const top = Math.min(...ys);
        const y = top + 0.2 * (Math.max(...ys) - top);
        const x = spanMiddle(r.polygon, y);
        if (x === null) continue;
        presets.push({
            id,
            panel: "front",
            at: [Math.round(x * 100) / 100, Math.round(y * 100) / 100],
        });
    }
    return presets;
}

/** The region under an item's centre on its panel, or null. */
export function regionUnder(
    regions: FlatsRegions,
    panel: FlatsPanel,
    x: number,
    y: number,
): string | null {
    if (panel === "cape") return "cape";
    return (
        regions.regions.find(
            (r) => r.panel === panel && insidePolygon(r.polygon, x, y),
        )?.id ?? null
    );
}

/** Pixels of each region's rim that take their color from further in (anti-aliased art edges). */
export const FLATS_RIM_PX = 2;

/**
 * Where an atlas's bleed copies from: every pixel outside the regions
 * within `steps` pixels of one, and every region pixel within `rim` pixels
 * of its edge, takes the color of the nearest pixel further in (8-connected
 * breadth-first). The rim matters because art clipped to a region is
 * semi-transparent along its edge, and copying that outward would leave the
 * palette showing through along the side seams. Where two regions touch
 * (the hips and a leg at the crotch line), each one's rim is filled from its
 * own inside.
 *
 * `mask` holds each pixel's region, numbered from 1; 0 is outside every
 * region. Returns pairs: `dst[k]` takes `from[k]`.
 */
export function bleedPlan(
    mask: Uint8Array,
    W: number,
    H: number,
    steps: number,
    rim = FLATS_RIM_PX,
): { dst: Int32Array; from: Int32Array } {
    const src = new Int32Array(W * H).fill(-1);
    let queue = new Int32Array(W * H);
    let qn = 0;
    // sources: region pixels at least `rim` pixels from anything outside
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const own = mask[i];
            if (!own) continue;
            let rimPixel = false;
            for (let dy = -rim; dy <= rim && !rimPixel; dy++)
                for (let dx = -rim; dx <= rim; dx++) {
                    const jx = x + dx;
                    const jy = y + dy;
                    if (jx < 0 || jy < 0 || jx >= W || jy >= H) continue;
                    if (mask[jy * W + jx] !== own) {
                        rimPixel = true;
                        break;
                    }
                }
            if (rimPixel) continue;
            src[i] = i;
            queue[qn++] = i;
        }
    const dst: number[] = [];
    const from: number[] = [];
    // the rim first takes the pixel straight inward (4-connected), so the edges of art that crosses a
    // region's edge stay straight; then the bleed spreads 8-connected
    for (let step = 0; step < steps + 2 * rim && qn; step++) {
        const straight = step < rim;
        const next = new Int32Array(qn * 8);
        let nn = 0;
        for (let k = 0; k < qn; k++) {
            const i = queue[k];
            const ix = i % W;
            const iy = (i / W) | 0;
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    if (!dx && !dy) continue;
                    if (straight && dx && dy) continue;
                    const jx = ix + dx;
                    const jy = iy + dy;
                    if (jx < 0 || jy < 0 || jx >= W || jy >= H) continue;
                    const j = jy * W + jx;
                    if (src[j] >= 0) continue;
                    src[j] = src[i];
                    dst.push(j);
                    from.push(src[i]);
                    next[nn++] = j;
                }
        }
        queue = next;
        qn = nn;
    }
    return { dst: Int32Array.from(dst), from: Int32Array.from(from) };
}
