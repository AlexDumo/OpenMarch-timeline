/**
 * Loads the uniform flats' geometry and composes each look's art into an
 * atlas per body type (docs/3d/uniform-artwork.md, "Composed textures").
 *
 * - The lookup tables, `layout.json` and `regions.json` come from
 *   `assets/uniform-flats/` (`scripts/view3d-assets/uniform-flats.mjs`),
 *   fetched when a look first wears flats and kept for the window's lifetime.
 * - An atlas holds the front and back panels (and the cape's, when the look
 *   has one), cropped to the garment regions. Placed items are graded for
 *   the body type, so each (look, body type, resolution) has its own atlas;
 *   then a worker copies every region's edge pixels 1.5 in outward so
 *   filtering at the side seams never reaches the empty page, and hands back
 *   an ImageBitmap. No canvas or pixel array stays in the window, but the
 *   bitmap does: three keeps it as `texture.image` until the atlas is freed,
 *   when disposing the texture closes it.
 * - Atlases are shared while in use (`acquireFlats`) and freed when the last
 *   user lets go.
 */
import * as THREE from "three";
import layoutUrl from "@/view3d/assets/uniform-flats/layout.json?url";
import regionsUrl from "@/view3d/assets/uniform-flats/regions.json?url";
import {
    FLATS_BLEED_IN,
    UNIFORM_ARTWORK,
    flatsAtlasLayout,
    gradeAt,
    itemDraw,
    itemSize,
    itemStrips,
    tileLayout,
    type FlatsItem,
    type FlatsLayout,
    type FlatsPanel,
    type FlatsRegions,
    type FlatsArtworkKey,
    type UniformArtworkId,
    isUniformPackValue,
} from "@/view3d/core/marchers/uniformArtwork";
import {
    FLATS_PAGE_IN,
    type UniformPackItem,
} from "@/view3d/core/uniformPack/format";
import { draftOrigin } from "@/view3d/window/uniformPack/itemDrafts";
import {
    composeFromNewest,
    packPageKey,
    packPagePlan,
    type PageLayers,
} from "@/view3d/window/uniformPack/packPage";
import { readStoredUniformPackBytes } from "@/hooks/queries/useUniformPack";
import { runUniformPackJob } from "@/view3d/uniformPack/runUniformPackJob";
import type { BodyType } from "@/view3d/core/marchers/looks";
import type { FlatsAtlasRect } from "@/view3d/render/uniform-flats.js";
import FlatsBleedWorker from "./flatsBleed.worker.ts?worker";
import { createBleedClient } from "./flatsBleedClient";

const lutUrls = import.meta.glob<string>(
    "../../../assets/uniform-flats/lut/*.bin",
    { query: "?url", import: "default", eager: true },
);
const artUrls = import.meta.glob<string>(
    "../../../assets/uniform-flats/*/*.svg",
    { query: "?url", import: "default", eager: true },
);
const urlFor = (urls: Record<string, string>, file: string) => {
    const key = Object.keys(urls).find((k) => k.endsWith(`/${file}`));
    if (!key) throw new Error(`3D View: no bundled asset ${file}`);
    return urls[key];
};

const fetchJson = async <T>(url: string): Promise<T> => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`3D View: ${url} ${r.status}`);
    return (await r.json()) as T;
};

let geometryPromise: Promise<{
    layout: FlatsLayout;
    regions: FlatsRegions;
}> | null = null;
/** The geometry once loaded, for {@link peekFlatsResources} */
let geometryLoaded: { layout: FlatsLayout; regions: FlatsRegions } | null =
    null;
/** `layout.json` and `regions.json`, once. */
export function loadFlatsGeometry() {
    geometryPromise ??= Promise.all([
        fetchJson<FlatsLayout>(layoutUrl),
        fetchJson<FlatsRegions>(regionsUrl),
    ]).then(([layout, regions]) => (geometryLoaded = { layout, regions }));
    return geometryPromise;
}

const lutPromises = new Map<BodyType, Promise<THREE.DataTexture>>();
/** The tables once loaded, for {@link peekFlatsResources} */
const tablesLoaded = new Map<BodyType, THREE.DataTexture>();
/** A body type's lookup table as a half-float RGBA texture, once per window. */
export function loadFlatsLut(body: BodyType): Promise<THREE.DataTexture> {
    let p = lutPromises.get(body);
    if (!p) {
        p = Promise.all([
            loadFlatsGeometry(),
            fetch(urlFor(lutUrls, `${body}.bin`)).then((r) => {
                if (!r.ok) throw new Error(`3D View: flats table ${r.status}`);
                return r.arrayBuffer();
            }),
        ]).then(([{ layout }, buf]) => {
            const lut = flatsLutTexture(layout, buf);
            tablesLoaded.set(body, lut);
            return lut;
        });
        lutPromises.set(body, p);
    }
    return p;
}

/** A table's bytes (RGBA half floats, `angles` x `rows`) as a texture the shader reads. */
export function flatsLutTexture(
    layout: FlatsLayout,
    buf: ArrayBuffer,
): THREE.DataTexture {
    const data = new Uint16Array(buf);
    if (data.length !== layout.angles * layout.rows * 4)
        throw new Error(
            `3D View: flats table holds ${data.length} values, expected ${layout.angles * layout.rows * 4}`,
        );
    const t = new THREE.DataTexture(
        data,
        layout.angles,
        layout.rows,
        THREE.RGBAFormat,
        THREE.HalfFloatType,
    );
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    // round the body: the back centre (psi = +-pi) sits between the last and first columns
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
}

const imagePromises = new Map<string, Promise<HTMLImageElement>>();
function loadImage(url: string): Promise<HTMLImageElement> {
    let p = imagePromises.get(url);
    if (!p) {
        p = new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () =>
                reject(new Error(`3D View: could not load ${url}`));
            img.src = url;
        });
        imagePromises.set(url, p);
    }
    return p;
}
const aspectOf = (img: HTMLImageElement) =>
    img.naturalWidth > 0 && img.naturalHeight > 0
        ? img.naturalWidth / img.naturalHeight
        : 1;

/** One composed atlas and where its panels sit. */
export interface FlatsAtlas {
    texture: THREE.Texture;
    rect: FlatsAtlasRect;
    /** GPU bytes with mipmaps, for the budget notes (D-19). */
    bytes: number;
}

/**
 * The region map of an atlas layout: each pixel's region, numbered from 1
 * (0 outside), each region drawn the way the art is clipped to it.
 */
function regionMask(
    regions: FlatsRegions,
    rect: ReturnType<typeof flatsAtlasLayout>,
    dpi: number,
    W: number,
    H: number,
): Uint8Array {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.fillStyle = "#fff";
    const mask = new Uint8Array(W * H);
    regions.regions.forEach((r, n) => {
        const o = rect[r.panel];
        if (!o) return;
        // each region on its own, read back over its bounding box only
        const xs = r.polygon.map(([px]) => (o[0] + px) * dpi);
        const ys = r.polygon.map(([, py]) => (o[1] + py) * dpi);
        const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 1);
        const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1);
        const x1 = Math.min(W, Math.ceil(Math.max(...xs)) + 1);
        const y1 = Math.min(H, Math.ceil(Math.max(...ys)) + 1);
        x.clearRect(x0, y0, x1 - x0, y1 - y0);
        x.beginPath();
        xs.forEach((X, i) => (i ? x.lineTo(X, ys[i]) : x.moveTo(X, ys[i])));
        x.closePath();
        x.fill();
        const a = x.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        for (let yy = y0; yy < y1; yy++)
            for (let xx = x0; xx < x1; xx++)
                if (a[((yy - y0) * (x1 - x0) + (xx - x0)) * 4 + 3] > 127)
                    mask[yy * W + xx] = n + 1;
    });
    c.width = 0;
    return mask;
}

const bleedClient = createBleedClient(() => new FlatsBleedWorker());

/**
 * Bleeds composed pixels in the worker (`flatsBleed.worker.ts`) and returns
 * them as a premultiplied ImageBitmap. The worker works the plan out from the
 * region mask the first time it sees a layout and resolution.
 */
function bleed(
    regions: FlatsRegions,
    rect: ReturnType<typeof flatsAtlasLayout>,
    dpi: number,
    W: number,
    H: number,
    pixels: ArrayBuffer,
): Promise<ImageBitmap> {
    return bleedClient.bleed({
        key: `${dpi}|${rect.w}|${rect.h}|${rect.cape ? 1 : 0}`,
        W,
        H,
        steps: Math.round(FLATS_BLEED_IN * dpi),
        pixels,
        mask: () => regionMask(regions, rect, dpi, W, H),
    });
}

/** A show's pack decoded for drawing: its flattened layers, its items and their images */
interface PackDrawing {
    page: ImageBitmap;
    items: UniformPackItem[];
    images: Map<string, ImageBitmap>;
}

interface PackPage {
    promise: Promise<PackDrawing>;
    users: number;
}
const packPages = new Map<string, PackPage>();

/**
 * A show's pack's layers flattened onto one bitmap of the whole page at
 * `dpi`, and its item images decoded, read in the uniform pack worker (never
 * in the window: the show may come from anyone). The window holds one bitmap
 * per (pack, mode), not one per layer, plus one per item image. Shared while
 * atlases are composed from it, then closed.
 */
async function withPackPage<T>(
    key: string,
    dpi: number,
    which: PageLayers,
    use: (drawing: PackDrawing) => Promise<T>,
): Promise<T> {
    const cacheKey = packPageKey(key, dpi, which);
    let entry = packPages.get(cacheKey);
    if (!entry) {
        const promise = (async (): Promise<PackDrawing> => {
            const stored = await readStoredUniformPackBytes(key);
            if (!stored)
                throw new Error(`3D View: the show has no uniform ${key}`);
            const result = await runUniformPackJob({
                type: "flatten",
                // a copy: the stored bytes are shared through the blob cache
                bytes: stored.bytes.slice(),
                width: Math.round(FLATS_PAGE_IN.width * dpi),
                height: Math.round(FLATS_PAGE_IN.height * dpi),
                ...("files" in which
                    ? {
                          layers: which.files,
                          // copies: the draft keeps its own
                          extra: Object.fromEntries(
                              Object.entries(which.extra).map(([f, png]) => [
                                  f,
                                  png.slice(),
                              ]),
                          ),
                      }
                    : { mode: which.mode }),
            });
            if (result.type !== "flattened")
                throw new Error("3D View: the uniform didn't draw");
            return {
                page: result.bitmap,
                items: result.items,
                images: new Map(
                    result.itemBitmaps.map((i) => [i.file, i.bitmap]),
                ),
            };
        })();
        entry = { promise, users: 0 };
        packPages.set(cacheKey, entry);
        // a failed read isn't kept, so the next try reads again
        promise.catch(() => {
            if (packPages.get(cacheKey) === entry) packPages.delete(cacheKey);
        });
    }
    const held = entry;
    held.users++;
    try {
        return await use(await held.promise);
    } finally {
        held.users--;
        // the next body type usually asks within moments; keep it that long
        setTimeout(() => {
            if (held.users > 0 || packPages.get(cacheKey) !== held) return;
            packPages.delete(cacheKey);
            held.promise
                .then((d) => {
                    d.page.close();
                    for (const b of d.images.values()) b.close();
                })
                .catch(() => undefined);
        }, 3000);
    }
}

/** Composes artwork `id` for body type `body` at `dpi` pixels per inch. */
async function composeAtlas(
    id: FlatsArtworkKey,
    body: BodyType,
    dpi: number,
): Promise<FlatsAtlas> {
    if (isUniformPackValue(id)) {
        // the mode it's worn in, and any draft it draws (step 5 of fork #1257)
        const { pack, draft, which, items: planned } = packPagePlan(id);
        const draw = async (drawing: PackDrawing): Promise<FlatsAtlas> => {
            const { layout, regions } = await loadFlatsGeometry();
            const items = planned ?? drawing.items;
            const imageOf = (file: string) =>
                draft?.images[file]?.bitmap ?? drawing.images.get(file);
            const rect = flatsAtlasLayout(
                regions,
                items.some((item) => item.panel === "cape"),
            );
            return await composeFrom(rect, dpi, (ctx) => {
                // the page covers everything: copy each panel's part of it
                for (const panel of ["front", "back", "cape"] as const) {
                    const o = rect[panel];
                    if (!o) continue;
                    const P = regions.panels[panel];
                    ctx.drawImage(
                        drawing.page,
                        P.x * dpi,
                        P.y * dpi,
                        P.w * dpi,
                        P.h * dpi,
                        o[0] * dpi,
                        o[1] * dpi,
                        P.w * dpi,
                        P.h * dpi,
                    );
                }
                for (const item of items) {
                    const image = imageOf(item.file);
                    if (!image) continue;
                    drawItem(ctx, {
                        item,
                        panel: item.panel,
                        image,
                        aspect: image.width / image.height,
                        layout,
                        regions,
                        rect,
                        body,
                        dpi,
                    });
                }
                return Promise.resolve();
            });
        };
        return await composeFromNewest(
            () => draftOrigin(pack),
            !!draft,
            (from) => withPackPage(from, dpi, which, draw),
        );
    }
    return await composeBuiltIn(id, body, dpi);
}

/** Composes built-in artwork `id` for body type `body` at `dpi` pixels per inch. */
async function composeBuiltIn(
    id: UniformArtworkId,
    body: BodyType,
    dpi: number,
): Promise<FlatsAtlas> {
    const { layout, regions } = await loadFlatsGeometry();
    const art = UNIFORM_ARTWORK[id].art;
    const file = (name: string) => urlFor(artUrls, `${id}/${name}`);
    const rect = flatsAtlasLayout(regions, !!art.cape);
    return await composeFrom(rect, dpi, async (ctx) => {
        await drawBuiltIn(ctx, art, file, layout, regions, rect, body, dpi);
    });
}

/** Draws a built-in's panels and placed items onto its atlas. */
async function drawBuiltIn(
    ctx: CanvasRenderingContext2D,
    art: (typeof UNIFORM_ARTWORK)[UniformArtworkId]["art"],
    file: (name: string) => string,
    layout: FlatsLayout,
    regions: FlatsRegions,
    rect: ReturnType<typeof flatsAtlasLayout>,
    body: BodyType,
    dpi: number,
): Promise<void> {
    const panels: FlatsPanel[] = ["front", "back", "cape"];
    // the panels, each exactly its panel's size
    for (const panel of panels) {
        const name = art[panel];
        const o = rect[panel];
        if (!name || !o) continue;
        const P = regions.panels[panel];
        const img = await loadImage(file(name));
        ctx.save();
        ctx.beginPath();
        ctx.rect(o[0] * dpi, Math.max(0, o[1]) * dpi, P.w * dpi, P.h * dpi);
        ctx.clip();
        ctx.drawImage(img, o[0] * dpi, o[1] * dpi, P.w * dpi, P.h * dpi);
        ctx.restore();
    }
    // placed items, graded for this body
    for (const panel of panels) {
        const items = art.items?.[panel];
        if (!rect[panel] || !items) continue;
        for (const item of items) {
            const img = await loadImage(file(item.file));
            drawItem(ctx, {
                item,
                panel,
                image: img,
                aspect: aspectOf(img),
                layout,
                regions,
                rect,
                body,
                dpi,
            });
        }
    }
}

/**
 * Draws one placed item onto an atlas, graded for `body` at the region under
 * its centre (docs/3d/uniform-artwork.md, "Grading across the 7 body types"):
 * see `itemDraw` and `tileLayout`. Clipped to its panel, or to its regions
 * for a tile.
 */
function drawItem(
    ctx: CanvasRenderingContext2D,
    {
        item,
        panel,
        image,
        aspect,
        layout,
        regions,
        rect,
        body,
        dpi,
    }: {
        item: FlatsItem | UniformPackItem;
        panel: FlatsPanel;
        image: CanvasImageSource;
        aspect: number;
        layout: FlatsLayout;
        regions: FlatsRegions;
        rect: ReturnType<typeof flatsAtlasLayout>;
        body: BodyType;
        dpi: number;
    },
): void {
    const o = rect[panel];
    if (!o) return;
    const P = regions.panels[panel];
    const size = itemSize(item, aspect);
    if (!size) return;
    ctx.save();
    ctx.globalAlpha = item.opacity ?? 1;
    if (item.grade === "tile") {
        for (const tiles of tileLayout(
            layout,
            regions,
            body,
            panel,
            item,
            size.w,
            size.h,
        )) {
            ctx.save();
            ctx.beginPath();
            tiles.polygon.forEach(([px, py], i) => {
                const X = (o[0] + px) * dpi;
                const Y = (o[1] + py) * dpi;
                if (i) ctx.lineTo(X, Y);
                else ctx.moveTo(X, Y);
            });
            ctx.closePath();
            ctx.clip();
            for (const [x, y] of tiles.origins)
                ctx.drawImage(
                    image,
                    (o[0] + x) * dpi,
                    (o[1] + y) * dpi,
                    tiles.w * dpi,
                    tiles.h * dpi,
                );
            ctx.restore();
        }
        ctx.restore();
        return;
    }
    const [cx, cy] = item.at;
    const { k } = gradeAt(layout, regions, body, panel, cx, cy);
    const d = itemDraw(item, aspect, k);
    ctx.beginPath();
    ctx.rect(o[0] * dpi, o[1] * dpi, P.w * dpi, P.h * dpi);
    ctx.clip();
    const grade = item.grade ?? "proportional";
    const angle = ((item.rotate ?? 0) * Math.PI) / 180;
    if (grade === "proportional" || grade === "fixed") {
        // drawn upright (rotated, and k times taller when proportional) on a
        // canvas of its own, then copied in strips, each as wide as its row
        // needs (`itemStrips`)
        const bw =
            Math.abs(d.w * Math.cos(angle)) + Math.abs(d.h * Math.sin(angle));
        const bh =
            (Math.abs(d.w * Math.sin(angle)) +
                Math.abs(d.h * Math.cos(angle))) *
            d.sy;
        const W = Math.max(1, Math.ceil(bw * dpi));
        const H = Math.max(1, Math.ceil(bh * dpi));
        const off = document.createElement("canvas");
        off.width = W;
        off.height = H;
        const itemCtx = off.getContext("2d")!;
        itemCtx.translate(W / 2, H / 2);
        itemCtx.scale(1, d.sy);
        itemCtx.rotate(angle);
        itemCtx.drawImage(
            image,
            (-d.w / 2) * dpi,
            (-d.h / 2) * dpi,
            d.w * dpi,
            d.h * dpi,
        );
        const stripPx = Math.max(1, Math.round(dpi / 8));
        const half = H / 2 / dpi;
        const strips = itemStrips(
            layout,
            regions,
            body,
            panel,
            item.at,
            half,
            grade === "proportional" ? k : 1,
            stripPx / dpi,
        );
        const X = (o[0] + cx) * dpi;
        const Y = (o[1] + cy) * dpi;
        for (const s of strips) {
            const sy = Math.round((s.top + half) * dpi);
            const sh = Math.min(H - sy, Math.round(s.height * dpi));
            if (sh <= 0) continue;
            ctx.drawImage(
                off,
                0,
                sy,
                W,
                sh,
                X - (W * s.sx) / 2,
                Y - H / 2 + sy,
                W * s.sx,
                sh,
            );
        }
        off.width = 0;
        ctx.restore();
        return;
    }
    ctx.translate((o[0] + cx) * dpi, (o[1] + cy) * dpi);
    ctx.scale(d.sx, d.sy);
    ctx.rotate(angle);
    if (d.ly !== undefined) ctx.scale(1, d.ly);
    ctx.drawImage(
        image,
        (-d.w / 2) * dpi,
        (-d.h / 2) * dpi,
        d.w * dpi,
        d.h * dpi,
    );
    ctx.restore();
}

/**
 * An atlas of layout `rect` at `dpi`, drawn by `draw`, then bled in the
 * worker and uploaded.
 */
async function composeFrom(
    rect: ReturnType<typeof flatsAtlasLayout>,
    dpi: number,
    draw: (ctx: CanvasRenderingContext2D) => Promise<void>,
): Promise<FlatsAtlas> {
    const { regions } = await loadFlatsGeometry();
    const W = Math.round(rect.w * dpi);
    const H = Math.round(rect.h * dpi);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    await draw(ctx);
    // the canvas goes once its pixels are read; the worker bleeds them and
    // hands back a bitmap to upload
    const pixels = ctx.getImageData(0, 0, W, H).data.buffer as ArrayBuffer;
    canvas.width = 0;
    const bitmap = await bleed(regions, rect, dpi, W, H, pixels);
    const texture = new THREE.Texture(bitmap);
    texture.colorSpace = THREE.SRGBColorSpace;
    // the bitmap is premultiplied already; ImageBitmaps upload as they are
    texture.premultiplyAlpha = false;
    texture.flipY = false;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    texture.addEventListener("dispose", () => bitmap.close());
    // the shader reads panel inches: atlas uv = (origin + q) / size, top row first
    return {
        texture,
        rect: {
            w: rect.w,
            h: rect.h,
            front: rect.front,
            back: rect.back,
            cape: rect.cape,
            dpi,
        },
        bytes: Math.round((W * H * 4 * 4) / 3),
    };
}

interface CacheEntry {
    promise: Promise<FlatsAtlas>;
    refs: number;
    /** The atlas once composed */
    done?: FlatsAtlas;
}
const atlases = new Map<string, CacheEntry>();
export const flatsKey = (id: FlatsArtworkKey, body: BodyType, dpi: number) =>
    `${id}|${body}|${dpi}`;

/**
 * The atlas of artwork `id` on body type `body` at `dpi`, composed the first
 * time and shared after. Pair each call with {@link releaseFlats}.
 */
export function acquireFlats(
    id: FlatsArtworkKey,
    body: BodyType,
    dpi: number,
): Promise<FlatsAtlas> {
    const key = flatsKey(id, body, dpi);
    let e = atlases.get(key);
    if (!e) {
        const entry: CacheEntry = {
            promise: composeAtlas(id, body, dpi),
            refs: 0,
        };
        e = entry;
        atlases.set(key, entry);
        entry.promise.then(
            (atlas) => {
                entry.done = atlas;
            },
            () => atlases.delete(key),
        );
    }
    e.refs++;
    return e.promise;
}

/**
 * An atlas already composed, with its body type's table and the layout, or null when any of
 * them isn't ready yet. Lets a wear that waited for its atlases (`useSettledFlatsWear`) reach the
 * marchers in the same render as its palette, instead of a few frames later. Doesn't acquire:
 * call {@link acquireFlats} too (a released atlas stays a moment, so it's still there).
 */
export function peekFlatsResources(
    id: FlatsArtworkKey,
    body: BodyType,
    dpi: number,
): { atlas: FlatsAtlas; lut: THREE.DataTexture; layout: FlatsLayout } | null {
    const atlas = atlases.get(flatsKey(id, body, dpi))?.done;
    const lut = tablesLoaded.get(body);
    return atlas && lut && geometryLoaded
        ? { atlas, lut, layout: geometryLoaded.layout }
        : null;
}

/** Lets go of an atlas from {@link acquireFlats}; the last user frees it. */
export function releaseFlats(
    id: FlatsArtworkKey,
    body: BodyType,
    dpi: number,
): void {
    const key = flatsKey(id, body, dpi);
    const e = atlases.get(key);
    if (!e) return;
    e.refs--;
    if (e.refs > 0) return;
    // a rebuild lets go just before it asks again: keep the atlas a moment
    setTimeout(() => {
        if (e.refs > 0 || atlases.get(key) !== e) return;
        atlases.delete(key);
        e.promise.then((a) => a.texture.dispose()).catch(() => undefined);
    }, 2000);
}
