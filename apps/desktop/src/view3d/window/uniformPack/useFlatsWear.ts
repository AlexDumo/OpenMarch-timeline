/**
 * What flats the band wears, from the venue's `uniformArtwork`
 * (docs/3d/uniform-artwork.md): a built-in's art and palette, or a show's
 * imported pack and the palette in its manifest (fork #1257). Null for the
 * band's preset, outside preview builds, and while a pack is still loading
 * (the band shows its preset until the pack is read).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    UNIFORM_ARTWORK,
    flatsArtworkOf,
    isUniformPackValue,
    type FlatsWear,
} from "@/view3d/core/marchers/uniformArtwork";
import { lookOfManifest } from "@/view3d/core/uniformPack/format";
import { uniformPackQueryOptions } from "@/hooks/queries/useUniformPack";
import { uniformArtworkAvailable } from "@/view3d/window/uniformArtworkPreview";

export function useFlatsWear(value: unknown): FlatsWear | null {
    const key = uniformArtworkAvailable() ? flatsArtworkOf(value) : null;
    const packValue = key && isUniformPackValue(key) ? key : null;
    const { data: pack } = useQuery(uniformPackQueryOptions(packValue));
    const manifest = pack?.manifest;
    return useMemo(() => {
        if (!key) return null;
        if (!isUniformPackValue(key))
            return { key, look: UNIFORM_ARTWORK[key].look };
        return manifest ? { key, look: lookOfManifest(manifest) } : null;
    }, [key, manifest]);
}
