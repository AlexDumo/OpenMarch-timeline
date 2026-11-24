import {
    mutationOptions,
    queryOptions,
    type QueryClient,
} from "@tanstack/react-query";
import { db } from "@/global/database/db";
import {
    getShowAssetBlobSizes,
    getShowAssetReferences,
    getShowAssets,
    readShowAssetBlob,
    removeShowAssetsInTransaction,
    setShowAssetCreditsInTransaction,
    valuesNamedInHistory,
} from "@/db-functions/showAssets";
import { UNIFORM_ASSET_KIND } from "@/view3d/core/uniformPack/format";
import type { JsonObject } from "@/showAssets/hash";
import type { ShowAssetRef } from "@/showAssets/ref";
import { showAssetRefValue } from "@/showAssets/ref";
import { conToastError } from "@/utilities/utils";
import { REMOVABLE_ASSET_KINDS } from "@/showAssets/assetUse";
import { useItemDrawingStore } from "@/stores/ItemDrawingStore";

import tolgee from "@/global/singletons/Tolgee";
import { createShowBlobCache } from "@/showAssets/blobCache";
import { DEFAULT_STALE_TIME } from "./constants";
import { venueSettingsKeys } from "./useVenueSettings";

/**
 * The key base matches the table name, as for the other tables. Assets aren't in the undo
 * history, so whatever adds one invalidates `showAssetKeys.all()` itself.
 */
const KEY_BASE = "show_assets";

/** A model armed to place with the next click on the field counts as used */
export const armedModelValues = (): string[] => {
    const placing = useItemDrawingStore.getState().placing;
    return placing?.kind === "model" ? [placing.modelValue] : [];
};

export const showAssetKeys = {
    all: () => [KEY_BASE] as const,
    sizes: () => [KEY_BASE, "sizes"] as const,
};

/** Every asset Version in the show (fork #997), without bytes. */
export const showAssetsQueryOptions = () =>
    queryOptions({
        queryKey: showAssetKeys.all(),
        queryFn: async () => await getShowAssets({ db }),
        staleTime: DEFAULT_STALE_TIME,
    });

/**
 * The editor's reads of asset bytes, by hash, through memory. Content-addressed, so it stays
 * right across shows; the window reloads when another show opens anyway.
 */
export const showAssetBlobCache = createShowBlobCache({
    read: async (hash) => await readShowAssetBlob({ db, hash }),
});

/**
 * Keys for which of the show's imported uniforms an undo or redo step names (fork #1257). They
 * sit under the venue's key, not the assets': only venue changes move a uniform's reference in
 * or out of history, and undo, redo and every venue write refresh `view3d_venue` (undo and redo
 * by table name), so this refreshes with them.
 */
export const uniformsInHistoryKeys = {
    all: () => [...venueSettingsKeys.all(), "uniformsInHistory"] as const,
};

/**
 * The show's imported uniforms an undo or redo step names: never offered by Remove unused…,
 * which is outside undo. An edit elsewhere can clear the redo steps without touching the venue,
 * so Remove unused… reads it again when it opens; the removal checks again inside its
 * transaction.
 */
export const uniformsInHistoryQueryOptions = (values: readonly string[]) =>
    queryOptions({
        queryKey: [...uniformsInHistoryKeys.all(), ...values],
        queryFn: async () => await valuesNamedInHistory({ db, values }),
        staleTime: 0,
    });

/** Every blob's size in bytes, by hash (fork #1001). Under the same key, so any change refreshes it. */
export const showAssetSizesQueryOptions = () =>
    queryOptions({
        queryKey: showAssetKeys.sizes(),
        queryFn: async () => await getShowAssetBlobSizes({ db }),
        staleTime: DEFAULT_STALE_TIME,
    });

/**
 * Removes the chosen assets that nothing in the show names, read again inside the removal: one a
 * prop or cue started naming since the list was shown is kept. Resolves with how many it removed.
 */
export const removeUnusedShowAssetsMutationOptions = (qc: QueryClient) =>
    mutationOptions({
        mutationFn: async (refs: readonly ShowAssetRef[]) =>
            await db.transaction(async (tx) => {
                const named = new Set([
                    ...(await getShowAssetReferences({ db: tx })),
                    ...armedModelValues(),
                ]);
                const assets = await getShowAssets({ db: tx });
                const removable = new Set(
                    assets
                        .filter((asset) =>
                            REMOVABLE_ASSET_KINDS.has(asset.kind),
                        )
                        .map(showAssetRefValue),
                );
                // an imported uniform an undo or redo would dress the band in again stays
                const kept = await valuesNamedInHistory({
                    db: tx,
                    values: assets
                        .filter((asset) => asset.kind === UNIFORM_ASSET_KIND)
                        .map(showAssetRefValue),
                });
                return await removeShowAssetsInTransaction({
                    tx,
                    refs: refs.filter((ref) => {
                        const value = showAssetRefValue(ref);
                        return (
                            removable.has(value) &&
                            !named.has(value) &&
                            !kept.has(value)
                        );
                    }),
                });
            }),
        onSettled: async () => {
            await qc.invalidateQueries({ queryKey: showAssetKeys.all() });
        },
        onError: (e, refs) => {
            conToastError(tolgee.t("assets.errors.remove"), e, refs);
        },
    });

/** Sets an asset's credits; they're outside its Version hash, so it stays the same Version. */
export const setShowAssetCreditsMutationOptions = (qc: QueryClient) =>
    mutationOptions({
        mutationFn: async ({
            ref,
            credits,
        }: {
            ref: ShowAssetRef;
            credits: JsonObject;
        }) =>
            await db.transaction(
                async (tx) =>
                    await setShowAssetCreditsInTransaction({
                        tx,
                        ref,
                        credits,
                    }),
            ),
        onSettled: async () => {
            await qc.invalidateQueries({ queryKey: showAssetKeys.all() });
        },
        onError: (e, variables) => {
            conToastError(tolgee.t("assets.errors.credits"), e, variables);
        },
    });
