// Types for uniform-flats.js. Hand-written; keep in step with the .js.
import type { Material, Texture } from "three";
import type { FlatsLayout } from "@/view3d/core/marchers/uniformArtwork";

type Three = typeof import("three");

/** Where each panel's origin sits in an atlas, and the atlas's size, in inches. */
export interface FlatsAtlasRect {
    w: number;
    h: number;
    front: readonly [number, number];
    back: readonly [number, number];
    cape: readonly [number, number] | null;
    /** The atlas's pixels per inch: the shader keeps the hem at least one pixel clear. */
    dpi: number;
}

export interface FlatsParams {
    layout: FlatsLayout;
    /** The body type `lut` is for. */
    body: string;
    lut: Texture;
    atlas: Texture;
    atlasRect: FlatsAtlasRect;
    cape?: { k: number; midZ: number };
}

export const FLATS_DIFFUSE_LINE: string;
export function flatsGlsl(layout: { cape: { w: number } }): string;
export function flatsUniforms(
    THREE: Three,
    params: FlatsParams,
): Record<string, { value: unknown }>;
export function withFlats<M extends Material>(
    THREE: Three,
    material: M,
    params: FlatsParams,
): M;
