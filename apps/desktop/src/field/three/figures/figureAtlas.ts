/**
 * The 2D field's performer figures (fork #1319): each instrument's performer seen from straight
 * above, baked from the 3D View's models in one body and one slate uniform
 * (`view3d/window/figureBake`), packed into one picture that ships with the app. Nothing 3D runs
 * on the field: it draws each figure as a textured square, to scale.
 *
 * `figures.webp` and `figures.json` come from the om-capture `figure-atlas` scenario; bake them
 * again when the models change.
 */
import { useEffect, useSyncExternalStore } from "react";
import { LinearFilter, LinearMipmapLinearFilter, Texture } from "three";
import { carryForSection } from "@/view3d/core/instruments/catalog";
import figuresUrl from "./figures.webp";
import layout from "./figures.json";

/** Field units in a meter (1 unit = 2 in). */
export const UNITS_PER_METER = 1 / 0.0508;

/** A figure in the atlas: its picture, in field units, and where the performer stands in it. */
export interface Figure {
    /** `[u0, v0, u1, v1]`, v down (the texture isn't flipped) */
    readonly uv: readonly [number, number, number, number];
    /** The picture's width and height, in field units */
    readonly size: readonly [number, number];
    /** The performer's spot, from the picture's top left, in field units */
    readonly anchor: readonly [number, number];
}

export interface FigureAtlas {
    readonly texture: Texture;
    /** Each carried model's figure (`Carry.model`), and `none` for a performer carrying nothing */
    readonly figures: ReadonlyMap<string, Figure>;
}

interface Layout {
    pxPerMeter: number;
    width: number;
    height: number;
    figures: Record<
        string,
        { x: number; y: number; w: number; h: number; cx: number; cy: number }
    >;
}

/** The atlas's key for a section's figure: what it carries, or `none`. */
export function figureKeyOf(section: string | null | undefined): string {
    return (section && carryForSection(section)?.model) || "none";
}

/** The figure for `key`, or the performer carrying nothing. */
export function figureOf(atlas: FigureAtlas, key: string): Figure {
    return atlas.figures.get(key) ?? atlas.figures.get("none")!;
}

let loading: Promise<FigureAtlas> | null = null;
let loaded: FigureAtlas | null = null;
const listeners = new Set<() => void>();

function readLayout(): Map<string, Figure> {
    const { pxPerMeter, width, height, figures } = layout as Layout;
    const unitsPerPx = UNITS_PER_METER / pxPerMeter;
    const out = new Map<string, Figure>();
    for (const [key, f] of Object.entries(figures))
        out.set(key, {
            uv: [
                f.x / width,
                f.y / height,
                (f.x + f.w) / width,
                (f.y + f.h) / height,
            ],
            size: [f.w * unitsPerPx, f.h * unitsPerPx],
            anchor: [f.cx * unitsPerPx, f.cy * unitsPerPx],
        });
    return out;
}

/** Loads the atlas once; a failed load lets the next ask try again. */
export function loadFigureAtlas(): Promise<FigureAtlas> {
    loading ??= new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("figures.webp didn't load"));
        image.src = figuresUrl;
    }).then(
        (image) => {
            const texture = new Texture(image);
            texture.flipY = false;
            // the field draws in its colors' own values (a linear, flat canvas), unconverted
            texture.generateMipmaps = true;
            texture.minFilter = LinearMipmapLinearFilter;
            texture.magFilter = LinearFilter;
            texture.anisotropy = 4;
            texture.needsUpdate = true;
            loaded = { texture, figures: readLayout() };
            for (const listener of listeners) listener();
            return loaded;
        },
        (error: unknown) => {
            loading = null;
            throw error;
        },
    );
    return loading;
}

/**
 * The atlas once it's loaded, or null until then (or if it can't be): asks for it while
 * `wanted`. The dots give way to figures only once it's there.
 */
export function useFigureAtlas(wanted: boolean): FigureAtlas | null {
    const atlas = useSyncExternalStore(
        (changed) => {
            listeners.add(changed);
            return () => listeners.delete(changed);
        },
        () => loaded,
    );
    useEffect(() => {
        if (!wanted || loaded) return;
        loadFigureAtlas().catch((error: unknown) =>
            console.warn("The field's performer figures couldn't load", error),
        );
    }, [wanted]);
    return atlas;
}
