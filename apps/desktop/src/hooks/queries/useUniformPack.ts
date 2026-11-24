/**
 * The show's imported uniforms (fork #1257): uniform packs stored as show assets of kind
 * `uniform`, read by the 3D View window through its read-only proxy, and the editor's write that
 * makes one the band's uniform.
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
    readUniformPack,
    type UniformPack,
} from "@/view3d/core/uniformPack/format";
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

/** One stored pack: the asset's name and the file's bytes, read */
export interface StoredUniformPack extends UniformPack {
    /** The value that names it (`library:<id>@<hash>`) */
    value: string;
    /** The asset's name in the show */
    name: string;
    /** The pack file, exactly as stored: what Save uniform file writes */
    bytes: Uint8Array;
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
 * The pack `value` names, read, or null when it names no uniform asset the show has (or its
 * bytes don't read as a pack). Bytes come through the show's blob cache: never change them.
 */
export async function readStoredUniformPack(
    value: string | null | undefined,
): Promise<StoredUniformPack | null> {
    const ref = parseShowAssetRef(value);
    if (!ref || !value) return null;
    const asset = await getShowAsset({ db, ref });
    const hash = asset?.parts[UNIFORM_PACK_PART];
    if (!asset || asset.kind !== UNIFORM_ASSET_KIND || !hash) return null;
    const bytes = await showAssetBlobCache.get(hash);
    if (!bytes) return null;
    try {
        return { ...readUniformPack(bytes), value, name: asset.name, bytes };
    } catch (error) {
        console.warn("3D View: the show's uniform doesn't read", error);
        return null;
    }
}

/** {@link readStoredUniformPack} as a query, under the assets' key so adding one refreshes it */
export const uniformPackQueryOptions = (value: string | null | undefined) =>
    queryOptions<StoredUniformPack | null>({
        queryKey: [...showAssetKeys.all(), "uniformPack", value ?? ""],
        queryFn: async () => await readStoredUniformPack(value),
        enabled: parseShowAssetRef(value) !== null,
        staleTime: DEFAULT_STALE_TIME,
    });

/**
 * Stores a pack file in the show and dresses the band in it, as one undo step; then refreshes
 * the assets and the venue settings.
 */
export const setUniformPackMutationOptions = (qc: QueryClient) =>
    mutationOptions({
        mutationFn: async (pack: Uint8Array) => {
            const field = await qc.fetchQuery(fieldPropertiesQueryOptions());
            return await setUniformPack({ db, pack, field });
        },
        onSuccess: async () => {
            await qc.invalidateQueries({ queryKey: showAssetKeys.all() });
            await qc.invalidateQueries({ queryKey: venueSettingsKeys.all() });
        },
        onError: (error) => {
            conToastError(tolgee.t("view3d.uniformImport.saveFailed"), error);
        },
    });
