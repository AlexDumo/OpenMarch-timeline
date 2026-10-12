import { queryOptions, useQuery } from "@tanstack/react-query";
import { db } from "@/global/database/db";
import {
    getShowLibraryItems,
    readLibraryBlob,
    type ShowLibraryItem,
} from "@/db-functions/showLibrary";
import { createShowBlobCache } from "@/view3d/library/showBlobCache";
import { DEFAULT_STALE_TIME } from "./constants";

/**
 * The key base matches the table name. The table is outside undo history, so undo and redo
 * never refresh it: whatever embeds or prunes invalidates `showLibraryKeys.all()`.
 */
const KEY_BASE = "library_items";

export const showLibraryKeys = {
    all: () => [KEY_BASE] as const,
    items: () => [KEY_BASE, "items"] as const,
};

/** Every Version the show embeds, without bytes. Loaded at open; reading never writes. */
export const showLibraryItemsQueryOptions = () =>
    queryOptions<ShowLibraryItem[]>({
        queryKey: showLibraryKeys.items(),
        queryFn: () => getShowLibraryItems({ db }),
        staleTime: DEFAULT_STALE_TIME,
    });

export const useShowLibrary = () => useQuery(showLibraryItemsQueryOptions());

/**
 * The open show's blob bytes, read lazily by hash. The renderer reloads whenever another show
 * opens, so one cache per page is one per show.
 */
export const showLibraryBlobs = createShowBlobCache({
    read: (hash) => readLibraryBlob({ db, hash }),
});
