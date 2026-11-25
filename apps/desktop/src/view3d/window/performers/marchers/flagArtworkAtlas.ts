/**
 * The show's flags' designs as the silks' texture (fork #985): one texture with a square tile per
 * flag, in the show's order, each tile the design's trim (the template's bleed cut off) stretched
 * over it inside a border (`FLAG_ARTWORK_GUTTER`). A silk carrying a show flag reads its own tile (`Carry.artwork`, `silkSet.ts`), so
 * performers can swap flags with Equipment cues and each shows its own design.
 */
import { useEffect } from "react";
import * as THREE from "three";
import { showAssetBlobCache } from "@/hooks/queries/useShowAssets";
import type { ShowFlag } from "@/showAssets/flags";
import { silkArtworkTrimRect } from "@/view3d/core/silkArtwork";
import { silkShapeSurface } from "@/view3d/core/artworkTemplates/surfaces";
import { silkShape } from "@/view3d/core/sizes/silkShapes";
import { requestDraw } from "../../drawWake";
import {
    FLAG_ARTWORK_GUTTER,
    setFlagArtworks,
    type FlagArtworkGrid,
} from "./silkSet";

/** A tile's side at most, in pixels: a silk's design up close */
export const FLAG_ARTWORK_TILE_PX = 512;
/** The texture's side at most, in pixels: what every GPU the 3D View runs on takes */
export const FLAG_ARTWORK_TEXTURE_PX = 4096;

/** The tiles' grid for `count` flags: near square, tiles smaller once there are many flags */
export function flagArtworkGrid(count: number): FlagArtworkGrid {
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
    const rows = Math.max(1, Math.ceil(count / cols));
    const tile = Math.min(
        FLAG_ARTWORK_TILE_PX,
        Math.floor(FLAG_ARTWORK_TEXTURE_PX / cols),
    );
    return { cols, rows, tile };
}

/** Draws each flag's design into its tile; a design that can't be read leaves its tile clear. */
async function drawAtlas(
    flags: readonly ShowFlag[],
    grid: FlagArtworkGrid,
): Promise<OffscreenCanvas> {
    const canvas = new OffscreenCanvas(
        grid.cols * grid.tile,
        grid.rows * grid.tile,
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas for the flags' designs");
    ctx.imageSmoothingQuality = "high";
    await Promise.all(
        flags.map(async (flag, k) => {
            try {
                const png = await showAssetBlobCache.get(flag.artwork);
                if (!png) return;
                const bitmap = await createImageBitmap(
                    new Blob([png as Uint8Array<ArrayBuffer>], {
                        type: "image/png",
                    }),
                    { premultiplyAlpha: "none" },
                );
                try {
                    const trim = silkArtworkTrimRect(
                        bitmap.width,
                        bitmap.height,
                        silkShapeSurface(silkShape(flag.shape)),
                    );
                    const x = (k % grid.cols) * grid.tile;
                    const y = Math.floor(k / grid.cols) * grid.tile;
                    const gutter = grid.tile * FLAG_ARTWORK_GUTTER;
                    const draw = (at: number, side: number) =>
                        ctx.drawImage(
                            bitmap,
                            trim.x * bitmap.width,
                            trim.y * bitmap.height,
                            trim.width * bitmap.width,
                            trim.height * bitmap.height,
                            x + at,
                            y + at,
                            side,
                            side,
                        );
                    // the border: the design stretched over the whole tile, then the design inside
                    draw(0, grid.tile);
                    draw(gutter, grid.tile - 2 * gutter);
                } finally {
                    bitmap.close();
                }
            } catch (error) {
                console.warn(
                    `3D View: couldn't read the design of the flag “${flag.name}”`,
                    error,
                );
            }
        }),
    );
    return canvas;
}

/**
 * Keeps the silks' texture to the show's flags: drawn again whenever a flag is added, removed or
 * replaced. Until it's drawn, the silks of show flags are plain.
 */
export function useFlagArtworkAtlas(flags: readonly ShowFlag[]): void {
    // what the texture depends on, in order: the tile of a flag is its place in the list
    const key = flags.map((f) => `${f.artwork}:${f.shape}`).join("|");
    useEffect(() => {
        const list = key ? key.split("|") : [];
        if (list.length === 0) return;
        let cancelled = false;
        let texture: THREE.Texture | null = null;
        const grid = flagArtworkGrid(list.length);
        void (async () => {
            const canvas = await drawAtlas(flags, grid);
            if (cancelled) return;
            // three doesn't flip an ImageBitmap: flip it here, so the top row is at v = 1
            const bitmap = await createImageBitmap(canvas, {
                imageOrientation: "flipY",
                premultiplyAlpha: "none",
            });
            if (cancelled) {
                bitmap.close();
                return;
            }
            texture = new THREE.Texture(bitmap);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 4;
            texture.needsUpdate = true;
            setFlagArtworks(texture, grid);
            requestDraw(600);
        })().catch((error: unknown) => {
            console.warn("3D View: couldn't draw the flags' designs", error);
        });
        return () => {
            cancelled = true;
            setFlagArtworks(null);
            if (texture) {
                (texture.image as ImageBitmap | undefined)?.close?.();
                texture.dispose();
            }
        };
        // `flags` is read through `key`, which changes whenever what's drawn does
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
}
