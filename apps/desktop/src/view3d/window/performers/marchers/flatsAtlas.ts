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
 *   then every region's edge pixels are copied 1.5 in outward so filtering
 *   at the side seams never reaches the empty page.
 * - Atlases are shared while in use (`acquireFlats`) and freed when the last
 *   user lets go.
 */
import * as THREE from "three";
import layoutUrl from "@/view3d/assets/uniform-flats/layout.json?url";
import regionsUrl from "@/view3d/assets/uniform-flats/regions.json?url";
import {
    FLATS_BLEED_IN,
    UNIFORM_ARTWORK,
    bleedPlan,
    flatsAtlasLayout,
    gradeAt,
    itemDraw,
    type FlatsLayout,
    type FlatsPanel,
    type FlatsRegions,
    type UniformArtworkId,
} from "@/view3d/core/marchers/uniformArtwork";
import type { BodyType } from "@/view3d/core/marchers/looks";
import type { FlatsAtlasRect } from "@/view3d/render/uniform-flats.js";

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
    t.wrapS = THREE.ClampToEdgeWrapping;
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

const bleedMaps = new Map<
    string,
    { W: number; H: number; dst: Int32Array; from: Int32Array }
>();
/**
 * The atlas's bleed (`bleedPlan`), per layout and resolution.
 */
function bleedMap(
    regions: FlatsRegions,
    rect: ReturnType<typeof flatsAtlasLayout>,
    dpi: number,
) {
    const key = `${dpi}|${rect.w}|${rect.h}|${rect.cape ? 1 : 0}`;
    const have = bleedMaps.get(key);
    if (have) return have;
    const W = Math.round(rect.w * dpi);
    const H = Math.round(rect.h * dpi);
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.fillStyle = "#fff";
    for (const r of regions.regions) {
        const o = rect[r.panel];
        if (!o) continue;
        x.beginPath();
        r.polygon.forEach(([px, py], i) => {
            const X = (o[0] + px) * dpi;
            const Y = (o[1] + py) * dpi;
            if (i) x.lineTo(X, Y);
            else x.moveTo(X, Y);
        });
        x.closePath();
        x.fill();
    }
    const a = x.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) mask[i] = a[i * 4 + 3] > 127 ? 1 : 0;
    const out = {
        W,
        H,
        ...bleedPlan(mask, W, H, Math.round(FLATS_BLEED_IN * dpi)),
    };
    bleedMaps.set(key, out);
    return out;
}

/** Composes artwork `id` for body type `body` at `dpi` pixels per inch. */
async function composeAtlas(
    id: UniformArtworkId,
    body: BodyType,
    dpi: number,
): Promise<FlatsAtlas> {
    const { layout, regions } = await loadFlatsGeometry();
    const art = UNIFORM_ARTWORK[id].art;
    const file = (name: string) => urlFor(artUrls, `${id}/${name}`);
    const rect = flatsAtlasLayout(regions, !!art.cape);
    const W = Math.round(rect.w * dpi);
    const H = Math.round(rect.h * dpi);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
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
    // bleed every region's edge outward
    const map = bleedMap(regions, rect, dpi);
    const img = ctx.getImageData(0, 0, W, H);
    const px = new Uint32Array(img.data.buffer);
    for (let k = 0; k < map.dst.length; k++) px[map.dst[k]] = px[map.from[k]];
    ctx.putImageData(img, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.premultiplyAlpha = true;
    texture.flipY = false;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
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
export const flatsKey = (id: UniformArtworkId, body: BodyType, dpi: number) =>
    `${id}|${body}|${dpi}`;

/**
 * The atlas of artwork `id` on body type `body` at `dpi`, composed the first
 * time and shared after. Pair each call with {@link releaseFlats}.
 */
export function acquireFlats(
    id: UniformArtworkId,
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
    id: UniformArtworkId,
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
