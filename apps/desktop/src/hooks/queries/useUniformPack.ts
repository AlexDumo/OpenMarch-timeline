/**
 * The show's imported uniforms (fork #1257): uniform packs stored as show assets of kind
 * `uniform`, read by the 3D View window through its read-only proxy, and the editor's write that
 * makes one the band's uniform.
 *
 * A show may come from anyone, so a stored pack is read like an imported one: in the uniform pack
 * worker (`runUniformPackJob`), never on the main thread.
 */
import {
    mutationOptions,
    queryOptions,
    type QueryClient,
} from "@tanstack/react-query";
import { db } from "@/global/database/db";
import { getShowAsset } from "@/db-functions/showAssets";
import { setUniformPack } from "@/db-functions/view3dUniformPack";
import { parseShowAssetRef, showAssetRefValue } from "@/showAssets/ref";
import {
    UNIFORM_ASSET_KIND,
    UNIFORM_PACK_PART,
    type UniformPackManifest,
} from "@/view3d/core/uniformPack/format";
import { runUniformPackJob } from "@/view3d/uniformPack/runUniformPackJob";
import { conToastError } from "@/utilities/utils";
import tolgee from "@/global/singletons/Tolgee";
import { DEFAULT_STALE_TIME } from "./constants";
import { fieldPropertiesQueryOptions } from "./useFieldProperties";
import { venueSettingsKeys } from "./useVenueSettings";
import {
    showAssetBlobCache,
    showAssetKeys,
    showAssetsQueryOptions,
} from "./useShowAssets";

/** One stored pack's file, unread */
export interface StoredUniformPackBytes {
    /** The value that names it (`library:<id>@<hash>`) */
    value: string;
    /** The asset's name in the show */
    name: string;
    /** The pack file, exactly as stored: what Save uniform file writes. Shared: never change it. */
    bytes: Uint8Array;
}

/** One stored pack, read in the worker */
export interface StoredUniformPack extends StoredUniformPackBytes {
    manifest: UniformPackManifest;
}

/** The show's uniform assets, oldest first, as `{ value, name }` */
export const uniformPacksQueryOptions = () =>
    queryOptions({
        ...showAssetsQueryOptions(),
        select: (assets) =>
            assets
                .filter((asset) => asset.kind === UNIFORM_ASSET_KIND)
                .map((asset) => ({
                    value: showAssetRefValue(asset),
                    name: asset.name,
                })),
    });

/**
 * The stored file of the pack `value` names, or null when it names no uniform asset the show
 * has. Bytes come through the show's blob cache: never change them.
 */
export async function readStoredUniformPackBytes(
    value: string | null | undefined,
): Promise<StoredUniformPackBytes | null> {
    const ref = parseShowAssetRef(value);
    if (!ref || !value) return null;
    const asset = await getShowAsset({ db, ref });
    const hash = asset?.parts[UNIFORM_PACK_PART];
    if (!asset || asset.kind !== UNIFORM_ASSET_KIND || !hash) return null;
    const bytes = await showAssetBlobCache.get(hash);
    return bytes ? { value, name: asset.name, bytes } : null;
}

/** A pack file's manifest, read and checked in the worker; throws when it isn't a pack */
export async function readPackManifest(
    bytes: Uint8Array,
): Promise<UniformPackManifest> {
    // a copy: the worker takes it, and callers' bytes may be shared
    const result = await runUniformPackJob({
        type: "pack",
        bytes: bytes.slice(),
    });
    if (result.type !== "pack") throw new Error("uniform pack: no manifest");
    return result.manifest;
}

/**
 * The pack `value` names, read, or null when it names no uniform asset the show has (or its
 * bytes don't read as a pack). Under the assets' key, so adding one refreshes it.
 */
export const uniformPackQueryOptions = (value: string | null | undefined) =>
    queryOptions<StoredUniformPack | null>({
        queryKey: [...showAssetKeys.all(), "uniformPack", value ?? ""],
        queryFn: async () => {
            const stored = await readStoredUniformPackBytes(value);
            if (!stored) return null;
            try {
                return {
                    ...stored,
                    manifest: await readPackManifest(stored.bytes),
                };
            } catch (error) {
                console.warn("3D View: the show's uniform doesn't read", error);
                return null;
            }
        },
        enabled: parseShowAssetRef(value) !== null,
        staleTime: DEFAULT_STALE_TIME,
    });

/**
 * Stores a pack file in the show and dresses the band in it, as one undo step; then refreshes
 * the assets and the venue settings. The file is read in the worker first. Resolves with the
 * value now in `uniformArtwork`.
 */
export const setUniformPackMutationOptions = (qc: QueryClient) =>
    mutationOptions({
        mutationFn: async (pack: Uint8Array) => {
            const manifest = await readPackManifest(pack);
            const field = await qc.fetchQuery(fieldPropertiesQueryOptions());
            return await setUniformPack({ db, pack, manifest, field });
        },
        onSuccess: async () => {
            await qc.invalidateQueries({ queryKey: showAssetKeys.all() });
            await qc.invalidateQueries({ queryKey: venueSettingsKeys.all() });
        },
        onError: (error) => {
            conToastError(tolgee.t("view3d.uniformImport.saveFailed"), error);
        },
    });
