// cspell:ignore statefull
import { fabric } from "fabric";

/**
 * A playback frame without Fabric's per-object bookkeeping.
 *
 * During playback every marcher and its label move each frame, so Fabric redraws them all. For a
 * cached object, `fabric.Object.render` does a `save`, rebuilds the transform matrix (with a string
 * cache key), re-checks the cache size against the zoom, compares the text's dimension properties
 * one by one, and then draws the cache bitmap and `restore`s. Only the `drawImage` puts pixels on
 * the canvas.
 *
 * `renderObjectsFromCaches` draws each simple cached object (no group, rotation, scale, skew, flip,
 * shadow, clip path or blend mode, centred origin) with only the context calls Fabric would make
 * for it: `save`, `transform`, `scale`, `drawImage` of the cache Fabric already made, `restore`.
 * Everything else, and any object whose cache may be out of date, goes through `obj.render` as
 * usual. That Fabric render also
 * records what the cache was drawn for; until one of those inputs changes, later frames reuse it.
 *
 * The cache is reused only while Fabric would also reuse it: the object is not `dirty`, its cache
 * zoom matches the canvas zoom and retina scale, and its size (and, for text, every
 * dimension-affecting property) is what it was when Fabric last validated the cache. Offscreen
 * culling follows Fabric's `skipOffscreen` rule on the object's bounding coords.
 */

/** What an object's cache was validated for, by a full Fabric render. */
interface CacheRecord {
    zoom: number;
    width: number | undefined;
    height: number | undefined;
    strokeWidth: number | undefined;
    // Text only
    text?: string;
    fontSize?: number;
    fontWeight?: string | number;
    fontFamily?: string;
    fontStyle?: string;
    lineHeight?: number;
    charSpacing?: number;
    textAlign?: string;
    styles?: unknown;
}

/** The Fabric 5 internals this module reads; they are not in the type definitions. */
type CachedObject = fabric.Object & {
    _cacheCanvas?: HTMLCanvasElement | null;
    cacheTranslationX?: number;
    cacheTranslationY?: number;
    zoomX?: number;
    zoomY?: number;
    ownCaching?: boolean;
    _forceClearCache?: boolean;
    selectionBackgroundColor?: string;
    __drawnFromCache?: CacheRecord;
    isNotVisible(): boolean;
};

type TextLike = fabric.Text & {
    lineHeight?: number;
    charSpacing?: number;
    styles?: unknown;
};

type CanvasInternals = fabric.StaticCanvas & {
    getRetinaScaling(): number;
    vptCoords?: { tl: fabric.Point; br: fabric.Point };
    skipOffscreen?: boolean;
};

const isText = (obj: fabric.Object): obj is TextLike =>
    obj instanceof fabric.Text;

/** Fabric's own `render` methods; an object with any other `render` draws itself. */
const fabricRenders = new Set<unknown>([
    fabric.Object.prototype.render,
    fabric.Group.prototype.render,
    fabric.Text.prototype.render,
]);

/** Whether the object is drawn by Fabric as a translated copy of its cache. */
const hasSimpleTransform = (obj: CachedObject) =>
    fabricRenders.has(obj.render) &&
    !obj.group &&
    !obj.angle &&
    obj.scaleX === 1 &&
    obj.scaleY === 1 &&
    !obj.skewX &&
    !obj.skewY &&
    !obj.flipX &&
    !obj.flipY &&
    obj.originX === "center" &&
    obj.originY === "center" &&
    !obj.shadow &&
    !obj.clipPath &&
    !obj.selectionBackgroundColor &&
    obj.globalCompositeOperation === "source-over";

const textMatches = (obj: TextLike, rec: CacheRecord) =>
    rec.text === obj.text &&
    rec.fontSize === obj.fontSize &&
    rec.fontWeight === obj.fontWeight &&
    rec.fontFamily === obj.fontFamily &&
    rec.fontStyle === obj.fontStyle &&
    rec.lineHeight === obj.lineHeight &&
    rec.charSpacing === obj.charSpacing &&
    rec.textAlign === obj.textAlign &&
    rec.styles === obj.styles;

/** The cache Fabric would draw for `obj` this frame without redrawing it, or null. */
const reusableCache = (
    obj: CachedObject,
    zoom: number,
): HTMLCanvasElement | null => {
    const rec = obj.__drawnFromCache;
    const cache = obj._cacheCanvas;
    if (
        !rec ||
        !cache ||
        obj.dirty ||
        obj._forceClearCache ||
        !obj.objectCaching ||
        obj.statefullCache ||
        obj.zoomX !== zoom ||
        obj.zoomY !== zoom ||
        rec.zoom !== zoom ||
        rec.width !== obj.width ||
        rec.height !== obj.height ||
        rec.strokeWidth !== obj.strokeWidth ||
        !hasSimpleTransform(obj)
    )
        return null;
    if (isText(obj) && !textMatches(obj, rec)) return null;
    return cache;
};

/** Fabric's `skipOffscreen` test for an object without rotation: its bounding box misses the view. */
const isOffscreen = (obj: fabric.Object, canvas: CanvasInternals) => {
    if (!canvas.skipOffscreen) return false;
    const view = canvas.vptCoords;
    const box = obj.aCoords;
    if (!view || !box) return false;
    return (
        box.br.x < view.tl.x ||
        box.tl.x > view.br.x ||
        box.br.y < view.tl.y ||
        box.tl.y > view.br.y
    );
};

/** After a full Fabric render, notes what its cache now holds, or forgets it. */
const recordCache = (
    obj: CachedObject,
    zoom: number,
    canvas: CanvasInternals,
) => {
    if (
        obj.isNotVisible() ||
        !obj.ownCaching ||
        !obj._cacheCanvas ||
        obj.dirty ||
        obj.zoomX !== zoom ||
        obj.zoomY !== zoom ||
        !hasSimpleTransform(obj) ||
        // Fabric skipped it, so it didn't check its cache
        isOffscreen(obj, canvas)
    ) {
        obj.__drawnFromCache = undefined;
        return;
    }
    const rec: CacheRecord = {
        zoom,
        width: obj.width,
        height: obj.height,
        strokeWidth: obj.strokeWidth,
    };
    if (isText(obj)) {
        rec.text = obj.text;
        rec.fontSize = obj.fontSize;
        rec.fontWeight = obj.fontWeight;
        rec.fontFamily = obj.fontFamily;
        rec.fontStyle = obj.fontStyle;
        rec.lineHeight = obj.lineHeight;
        rec.charSpacing = obj.charSpacing;
        rec.textAlign = obj.textAlign;
        rec.styles = obj.styles;
    }
    obj.__drawnFromCache = rec;
};

/**
 * Draws `objects` in order onto `ctx`, which holds the viewport transform, as Fabric's
 * `_renderObjects` would, reusing valid object caches directly.
 */
export function renderObjectsFromCaches(
    canvas: fabric.StaticCanvas,
    ctx: CanvasRenderingContext2D,
    objects: readonly (fabric.Object | undefined)[],
): void {
    const internals = canvas as CanvasInternals;
    const zoom = canvas.getZoom() * internals.getRetinaScaling();

    for (const object of objects) {
        if (!object) continue;
        const obj = object as CachedObject;
        if (!obj.visible || obj.opacity === 0) continue;
        const cache = reusableCache(obj, zoom);
        if (!cache) {
            obj.render(ctx);
            recordCache(obj, zoom, internals);
            continue;
        }
        if (isOffscreen(obj, internals)) continue;
        // The context calls Fabric's render makes for a cached object, in the same order, so the
        // GPU composes the same matrices and the pixels match exactly
        ctx.save();
        ctx.transform(1, 0, 0, 1, obj.left!, obj.top!);
        ctx.globalAlpha *= obj.opacity!;
        ctx.scale(1 / obj.zoomX!, 1 / obj.zoomY!);
        ctx.drawImage(cache, -obj.cacheTranslationX!, -obj.cacheTranslationY!);
        ctx.restore();
    }
}
