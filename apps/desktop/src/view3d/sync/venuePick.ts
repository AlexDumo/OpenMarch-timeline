/**
 * A venue pick in the 3D View sends the whole venue, built from the venue the window last read.
 * While an item edit's burst saves, that read can be behind the editor: the band already wears a
 * newer version of its uniform, and a burst's save may have removed the version the window still
 * names. When the window's 4 s arrive timer ends a draft whose save never showed, Band wears
 * unlocks, and a pick then would write that stale `uniformArtwork` back (fork #1257 hardening).
 *
 * So a pick carries the uniform fields it was made against (`base`), and the editor rebases it on
 * the venue it holds, in the same transaction as the write: a field the pick didn't change takes
 * the stored value, so only what the person picked is written over the editor's venue.
 *
 * Pure: no React, no database.
 */
import { parseShowAssetRef } from "@/showAssets/ref";
import type { VenueSettings } from "@/view3d/core/venueSettings";

/** The band's uniform as the window saw it when the pick was made */
export interface VenuePickBase {
    uniformArtwork: string | number | null;
    uniformMode: string | null;
}

export const venuePickBase = (settings: VenueSettings): VenuePickBase => ({
    uniformArtwork: settings.uniformArtwork ?? null,
    uniformMode: settings.uniformMode ?? null,
});

/** A base from the window, unchecked; undefined when it isn't one */
export function parseVenuePickBase(value: unknown): VenuePickBase | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const { uniformArtwork, uniformMode } = value as Record<string, unknown>;
    const artwork =
        uniformArtwork === null ||
        typeof uniformArtwork === "string" ||
        typeof uniformArtwork === "number"
            ? uniformArtwork
            : undefined;
    const mode =
        uniformMode === null || typeof uniformMode === "string"
            ? uniformMode
            : undefined;
    return artwork === undefined || mode === undefined
        ? undefined
        : { uniformArtwork: artwork, uniformMode: mode };
}

const sameUniform = (a: string | number | null, b: string | number | null) => {
    if (typeof a !== "string" || typeof b !== "string") return false;
    const x = parseShowAssetRef(a)?.id;
    return x !== undefined && x === parseShowAssetRef(b)?.id;
};

/**
 * `next`, a pick made against `base`, rebased on `stored`, the venue the editor holds:
 * - a uniform field the pick left as it was takes the stored value (a newer version of the
 *   uniform, or what an Undo the window hadn't seen put back);
 * - a picked uniform (or preset) stands;
 * - a picked mode stands while the stored venue still wears that uniform, in any version; once
 *   it wears another (an Undo), the stored mode stays, as Undo wins.
 */
export function pickOnStoredUniform(
    next: VenueSettings,
    base: VenuePickBase,
    stored: VenueSettings | undefined,
): VenueSettings {
    if (!stored) return next;
    const now = venuePickBase(stored);
    const picked = venuePickBase(next);
    const artworkPicked = picked.uniformArtwork !== base.uniformArtwork;
    const modePicked = picked.uniformMode !== base.uniformMode;
    const artwork = artworkPicked ? picked.uniformArtwork : now.uniformArtwork;
    const sameWorn =
        base.uniformArtwork === now.uniformArtwork ||
        sameUniform(base.uniformArtwork, now.uniformArtwork);
    const mode =
        artworkPicked || (modePicked && sameWorn)
            ? picked.uniformMode
            : now.uniformMode;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- set again below
    const { uniformArtwork, uniformMode, ...rest } = next;
    return {
        ...rest,
        ...(artwork !== null ? { uniformArtwork: artwork } : {}),
        ...(mode !== null ? { uniformMode: mode } : {}),
    } as VenueSettings;
}
