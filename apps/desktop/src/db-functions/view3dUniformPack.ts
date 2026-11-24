/**
 * The band's imported uniform (fork #1257; ADR 0010 amendment 2026-11-24): a uniform pack is a
 * show asset of kind `uniform` whose one part, `pack`, is the pack file's bytes as they are
 * (`src/view3d/core/uniformPack/format.ts`). The venue settings' `uniformArtwork` names it as
 * `library:<id>@<version hash>`, the form props' models and cue values use.
 *
 * Adding the asset is outside undo, like every show asset; pointing the venue at it is undoable,
 * so Undo puts the band back in what it wore and the pack stays in the show for next time.
 */
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import {
    getStoredVenueSettings,
    updateVenueSettingsInTransaction,
} from "./view3dVenue";
import { addShowAssetInTransaction, getShowAssets } from "./showAssets";
import {
    defaultVenueForField,
    type VenueFieldInfo,
} from "@/view3d/core/venueSettings";
import {
    UNIFORM_ASSET_KIND,
    UNIFORM_PACK_PART,
    uniformPackManifestSchema,
    type UniformPackManifest,
} from "@/view3d/core/uniformPack/format";
import { showAssetRefValue } from "@/showAssets/ref";
import type { JsonObject } from "@/showAssets/hash";

/**
 * Adds the pack file `pack` to the show's assets (reusing it if the show has these bytes already)
 * and dresses the band in it. Returns the value now in `uniformArtwork`.
 *
 * With `versionOf`, an asset id, the pack is added as a new version of that uniform (an edit of
 * its items in the 3D View, fork #1258), so the Assets view keeps one uniform, not one per edit.
 * An id the show doesn't have as a uniform is ignored, and the pack is a uniform of its own.
 *
 * `manifest` is the pack's, read from these bytes by the caller: the editor reads untrusted packs
 * only in the uniform pack worker (`readPackManifest`), never inside a transaction on its main
 * thread. It is checked again here, which costs nothing.
 */
export async function setUniformPackInTransaction({
    tx,
    pack,
    manifest: given,
    field,
    versionOf,
}: {
    tx: DbTransaction;
    pack: Uint8Array;
    manifest: UniformPackManifest;
    /** For the default venue, when the show has no venue row yet */
    field: VenueFieldInfo;
    versionOf?: string;
}): Promise<string> {
    const manifest = uniformPackManifestSchema.parse(given);
    const id =
        versionOf !== undefined &&
        (await getShowAssets({ db: tx })).some(
            (asset) =>
                asset.id === versionOf && asset.kind === UNIFORM_ASSET_KIND,
        )
            ? versionOf
            : undefined;
    const { ref } = await addShowAssetInTransaction({
        tx,
        asset: {
            ...(id ? { id } : {}),
            kind: UNIFORM_ASSET_KIND,
            name: manifest.name,
            parts: { [UNIFORM_PACK_PART]: pack },
            sidecar: { formatVersion: manifest.formatVersion },
            credits: { ...manifest.credits } as JsonObject,
        },
    });
    const value = showAssetRefValue(ref);
    const venue =
        (await getStoredVenueSettings({ db: tx })) ??
        defaultVenueForField(field);
    await updateVenueSettingsInTransaction({
        tx,
        settings: { ...venue, uniformArtwork: value },
    });
    return value;
}

/** {@link setUniformPackInTransaction} as one undoable history group */
export async function setUniformPack({
    db,
    pack,
    manifest,
    field,
    versionOf,
}: {
    db: DbConnection;
    pack: Uint8Array;
    manifest: UniformPackManifest;
    field: VenueFieldInfo;
    versionOf?: string;
}): Promise<string> {
    return await transactionWithHistory(
        db,
        "setUniformPack",
        async (tx) =>
            await setUniformPackInTransaction({
                tx,
                pack,
                manifest,
                field,
                versionOf,
            }),
    );
}
