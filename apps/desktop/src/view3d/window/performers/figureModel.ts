/**
 * Loads and bakes the performer figure once per window.
 *
 * The models ship inside the bundle as data URLs, so loading them makes no
 * file or network request (ADR 0002: the window works offline). They come
 * from `assets/blender/body-v4` at the repository root; see the README next
 * to them.
 */
import { useEffect, useState } from "react";
import type { AnimationClip, Group } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import bodyUrl from "@/view3d/assets/figures/body-neutral-average.glb?url&inline";
import holdUrl from "@/view3d/assets/figures/clip-attention.glb?url&inline";
import marchUrl from "@/view3d/assets/figures/clip-walk-in-place.glb?url&inline";
import { bakeFigure, type BakedFigure } from "@/view3d/core/figures/bake";
import type { FigureRows } from "./figureMotion";

/** Poses sampled per loop of the marching clip (24 fps keys, so 2×). */
export const MARCH_SAMPLES = 48;

export interface PerformerFigure {
    baked: BakedFigure;
    rows: FigureRows;
    /** How long baking took, in ms (for the performance log). */
    bakeMs: number;
}

function dataUrlToBuffer(url: string): ArrayBuffer {
    const comma = url.indexOf(",");
    const binary = atob(url.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

function parseGlb(
    url: string,
): Promise<{ scene: Group; animations: AnimationClip[] }> {
    return new Promise((resolve, reject) =>
        new GLTFLoader().parse(dataUrlToBuffer(url), "", resolve, reject),
    );
}

/** Parses the bundled models and bakes them into a figure. */
export async function loadPerformerFigure(): Promise<PerformerFigure> {
    const [body, hold, march] = await Promise.all([
        parseGlb(bodyUrl),
        parseGlb(holdUrl),
        parseGlb(marchUrl),
    ]);
    const started = performance.now();
    const baked = bakeFigure(body.scene, [
        { name: "hold", clip: hold.animations[0], samples: 1 },
        { name: "march", clip: march.animations[0], samples: MARCH_SAMPLES },
    ]);
    const bakeMs = performance.now() - started;
    return {
        baked,
        rows: {
            hold: baked.clips.hold.row,
            march: baked.clips.march.row,
            marchSamples: baked.clips.march.samples,
        },
        bakeMs,
    };
}

let cached: Promise<PerformerFigure> | null = null;

/**
 * The baked figure, or null until it's ready or if it failed to load (the
 * performers then stay blocks).
 */
export function usePerformerFigure(enabled: boolean): PerformerFigure | null {
    const [figure, setFigure] = useState<PerformerFigure | null>(null);
    useEffect(() => {
        if (!enabled || figure) return;
        let live = true;
        cached ??= loadPerformerFigure();
        cached.then(
            (loaded) => {
                if (live) setFigure(loaded);
            },
            (error: unknown) => {
                console.error(
                    "3D View: performer figures failed to load",
                    error,
                );
            },
        );
        return () => {
            live = false;
        };
    }, [enabled, figure]);
    return enabled ? figure : null;
}
