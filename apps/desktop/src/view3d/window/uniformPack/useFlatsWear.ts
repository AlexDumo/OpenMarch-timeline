/**
 * What flats the band wears, from the venue's `uniformArtwork`
 * (docs/3d/uniform-artwork.md): a built-in's art and palette, or a show's
 * imported pack and the palette in its manifest (fork #1257). Null for the
 * band's preset, and while a pack is still loading (the band shows its preset
 * until the pack is read). It doesn't depend on Custom uniforms (preview):
 * that setting only shows the controls, and a show that wears a custom uniform
 * draws it either way.
 *
 * While its items or modes are being edited (fork #1258), the pack's key is
 * the draft's (`itemDrafts.ts`), so the 3D View shows each change at once.
 *
 * A pack with modes (step 5 of fork #1257) is worn in the venue's
 * `uniformMode`, or its default mode when that names none it has: the key
 * names the mode, so each mode gets its own atlas, and the palette takes the
 * mode's changes.
 */
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    UNIFORM_ARTWORK,
    flatsArtworkOf,
    isUniformPackValue,
    withMode,
    type FlatsWear,
} from "@/view3d/core/marchers/uniformArtwork";
import { lookOfManifest, modeOf } from "@/view3d/core/uniformPack/format";
import {
    keepSameUniform,
    uniformPackQueryOptions,
} from "@/hooks/queries/useUniformPack";
import {
    draftApplies,
    observeWorn,
    useItemDrafts,
    wornKey,
} from "./itemDrafts";

export function useFlatsWear(
    value: unknown,
    modeId?: string | null,
): FlatsWear | null {
    const key = flatsArtworkOf(value);
    const packValue = key && isUniformPackValue(key) ? key : null;
    // a saved item edit is a new pack: keep the last one's palette while it loads
    const { data: pack, isPlaceholderData } = useQuery({
        ...uniformPackQueryOptions(packValue),
        placeholderData: keepSameUniform(packValue),
    });
    const manifest = pack?.manifest;
    const draft = useItemDrafts((s) => s.draft);
    const loaded = !!pack && !isPlaceholderData;
    useEffect(() => observeWorn(packValue, loaded), [packValue, loaded, draft]);
    return useMemo(() => {
        if (!key) return null;
        if (!isUniformPackValue(key))
            return { key, look: UNIFORM_ARTWORK[key].look };
        if (!manifest) return null;
        // the draft's modes while it applies, so a mode edit shows at once
        const edited = draftApplies(draft, key)
            ? { ...manifest, ...draft.contents }
            : manifest;
        const mode = modeOf(edited, modeId)?.id ?? null;
        return {
            key: withMode(wornKey(draft, key), mode),
            look: lookOfManifest(edited, mode),
        };
    }, [key, manifest, draft, modeId]);
}
