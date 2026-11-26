/**
 * The show's flags (fork #985): the flag assets in the show's asset store, read through the
 * assets' query, and adding one.
 */
import {
    mutationOptions,
    useQuery,
    type QueryClient,
} from "@tanstack/react-query";
import { db } from "@/global/database/db";
import { addShowAssetInTransaction } from "@/db-functions/showAssets";
import {
    FLAG_ARTWORK_PART,
    FLAG_ASSET_KIND,
    FLAG_THUMBNAIL_PART,
    showFlags,
    type ShowFlag,
} from "@/showAssets/flags";
import { showAssetRefValue } from "@/showAssets/ref";
import type { SilkShapeId } from "@/view3d/core/sizes/silkShapes";
import { conToastError } from "@/utilities/utils";
import tolgee from "@/global/singletons/Tolgee";
import { showAssetKeys, showAssetsQueryOptions } from "./useShowAssets";

const NO_FLAGS: readonly ShowFlag[] = [];

/** The show's flags, oldest first; empty until the assets have loaded. */
export function useShowFlags(enabled = true): readonly ShowFlag[] {
    const { data } = useQuery({
        ...showAssetsQueryOptions(),
        select: showFlags,
        enabled,
    });
    return data ?? NO_FLAGS;
}

/** A flag to add: its name, shape, Artwork and picture. */
export interface NewShowFlag {
    name: string;
    shape: SilkShapeId;
    /** The Artwork's PNG and its size in pixels (`readArtwork`) */
    artwork: Uint8Array;
    width: number;
    height: number;
    /** The flag's picture (`drawFlagPicture`) */
    thumbnail: Uint8Array;
}

/**
 * Adds a flag to the show's assets, outside undo like every asset (an Equipment cue handing it
 * out is what undo changes). Resolves with its Equipment value (`library:<id>@<hash>`). The same
 * Artwork and shape again is the same flag: its stored Version comes back.
 */
export const addShowFlagMutationOptions = (qc: QueryClient) =>
    mutationOptions({
        mutationFn: async (flag: NewShowFlag) => {
            const { ref } = await db.transaction(async (tx) =>
                addShowAssetInTransaction({
                    tx,
                    asset: {
                        kind: FLAG_ASSET_KIND,
                        name: flag.name,
                        parts: {
                            [FLAG_ARTWORK_PART]: flag.artwork,
                            [FLAG_THUMBNAIL_PART]: flag.thumbnail,
                        },
                        sidecar: {
                            shape: flag.shape,
                            width: flag.width,
                            height: flag.height,
                        },
                    },
                }),
            );
            return showAssetRefValue(ref);
        },
        onSettled: async () => {
            await qc.invalidateQueries({ queryKey: showAssetKeys.all() });
        },
        onError: (e, flag) => {
            conToastError(tolgee.t("assets.flags.errors.add"), e, flag.name);
        },
    });
