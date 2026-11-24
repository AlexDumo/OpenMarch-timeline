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
    type FlatsLayout,
    type FlatsPanel,
    type FlatsRegions,
    type FlatsArtworkKey,
    type UniformArtworkId,
    isUniformPackValue,
} from "@/view3d/core/marchers/uniformArtwork";
import { FLATS_PAGE_IN } from "@/view3d/core/uniformPack/format";
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
/** `layout.json` and `regions.json`, once. */
export function loadFlatsGeometry() {
    geometryPromise ??= Promise.all([
        fetchJson<FlatsLayout>(layoutUrl),
        fetchJson<FlatsRegions>(regionsUrl),
    ]).then(([layout, regions]) => ({ layout, regions }));
    return geometryPromise;
}

const lutPromises = new Map<BodyType, Promise<THREE.DataTexture>>();
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
        ]).then(([{ layout }, buf]) => flatsLutTexture(layout, buf));
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

interface PackPage {
    promise: Promise<ImageBitmap>;
    users: number;
}
const packPages = new Map<string, PackPage>();

/**
 * A show's pack's layers flattened onto one bitmap of the whole page at
 * `dpi`, read and decoded in the uniform pack worker (never in the window:
 * the show may come from anyone). The window holds one bitmap per pack, not
 * one per layer. Shared while atlases are composed from it, then closed.
 */
async function withPackPage<T>(
    key: string,
    dpi: number,
    use: (page: ImageBitmap) => Promise<T>,
): Promise<T> {
    const cacheKey = `${key}|${dpi}`;
    let entry = packPages.get(cacheKey);
    if (!entry) {
        const promise = (async () => {
            const stored = await readStoredUniformPackBytes(key);
            if (!stored)
                throw new Error(`3D View: the show has no uniform ${key}`);
            const result = await runUniformPackJob({
                type: "flatten",
                // a copy: the stored bytes are shared through the blob cache
                bytes: stored.bytes.slice(),
                width: Math.round(FLATS_PAGE_IN.width * dpi),
                height: Math.round(FLATS_PAGE_IN.height * dpi),
            });
            if (result.type !== "bitmap")
                throw new Error("3D View: the uniform didn't draw");
            return result.bitmap;
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
            held.promise.then((b) => b.close()).catch(() => undefined);
        }, 3000);
    }
}

/** Composes artwork `id` for body type `body` at `dpi` pixels per inch. */
async function composeAtlas(
    id: FlatsArtworkKey,
    body: BodyType,
    dpi: number,
): Promise<FlatsAtlas> {
    if (isUniformPackValue(id))
        return await withPackPage(id, dpi, async (page) => {
            const { regions } = await loadFlatsGeometry();
            const rect = flatsAtlasLayout(regions, false);
            return await composeFrom(rect, dpi, (ctx) => {
                // the page covers everything: copy each panel's part of it
                for (const panel of ["front", "back"] as const) {
                    const o = rect[panel];
                    const P = regions.panels[panel];
                    ctx.drawImage(
                        page,
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
                return Promise.resolve();
            });
        });
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
        const o = rect[panel];
        const items = art.items?.[panel];
        if (!o || !items) continue;
        const P = regions.panels[panel];
        for (const item of items) {
            const img = await loadImage(file(item.file));
            const { k } = gradeAt(layout, regions, body, panel, ...item.at);
            const d = itemDraw(item, aspectOf(img), k);
            ctx.save();
            ctx.beginPath();
            ctx.rect(o[0] * dpi, o[1] * dpi, P.w * dpi, P.h * dpi);
            ctx.clip();
            ctx.translate((o[0] + item.at[0]) * dpi, (o[1] + item.at[1]) * dpi);
            ctx.scale(d.sx, d.sy);
            ctx.rotate(((item.rotate ?? 0) * Math.PI) / 180);
            ctx.globalAlpha = item.opacity ?? 1;
            ctx.drawImage(
                img,
                (-d.w / 2) * dpi,
                (-d.h / 2) * dpi,
                d.w * dpi,
                d.h * dpi,
            );
            ctx.restore();
        }
    }
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
        },
        bytes: Math.round((W * H * 4 * 4) / 3),
    };
}

interface CacheEntry {
    promise: Promise<FlatsAtlas>;
    refs: number;
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
        e = { promise: composeAtlas(id, body, dpi), refs: 0 };
        atlases.set(key, e);
        e.promise.catch(() => atlases.delete(key));
    }
    e.refs++;
    return e.promise;
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
