/**
 * What flats the band wears, from the venue's `uniformArtwork`
 * (docs/3d/uniform-artwork.md): a built-in's art and palette, or a show's
 * imported pack and the palette in its manifest (fork #1257). Null for the
 * band's preset, outside preview builds, and while a pack is still loading
 * (the band shows its preset until the pack is read).
 *
 * While its items are being edited (fork #1258), the pack's key is the item
 * draft's (`itemDrafts.ts`), so the 3D View shows each change at once.
 */
import { useEffect, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
    UNIFORM_ARTWORK,
    flatsArtworkOf,
    isUniformPackValue,
    type FlatsWear,
} from "@/view3d/core/marchers/uniformArtwork";
import { lookOfManifest } from "@/view3d/core/uniformPack/format";
import { uniformPackQueryOptions } from "@/hooks/queries/useUniformPack";
import { uniformArtworkAvailable } from "@/view3d/window/uniformArtworkPreview";
import { observeWorn, useItemDrafts, wornKey } from "./itemDrafts";

export function useFlatsWear(value: unknown): FlatsWear | null {
    const key = uniformArtworkAvailable() ? flatsArtworkOf(value) : null;
    const packValue = key && isUniformPackValue(key) ? key : null;
    // a saved item edit is a new pack: keep the last one's palette while it loads
    const { data: pack } = useQuery({
        ...uniformPackQueryOptions(packValue),
        placeholderData: keepPreviousData,
    });
    const manifest = pack?.manifest;
    const draft = useItemDrafts((s) => s.draft);
    useEffect(() => observeWorn(packValue), [packValue, draft]);
    return useMemo(() => {
        if (!key) return null;
        if (!isUniformPackValue(key))
            return { key, look: UNIFORM_ARTWORK[key].look };
        return manifest
            ? { key: wornKey(draft, key), look: lookOfManifest(manifest) }
            : null;
    }, [key, manifest, draft]);
}
