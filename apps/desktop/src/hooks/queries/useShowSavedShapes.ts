import {
    queryOptions,
    useQuery,
    type QueryClient,
} from "@tanstack/react-query";
import { db } from "@/global/database/db";
import {
    deleteShowSavedShape,
    getShowSavedShapes,
    putShowSavedShape,
} from "@/db-functions/savedShapes";
import type { SavedShape } from "@/shapes/library/savedShapes";
import { DEFAULT_STALE_TIME } from "./constants";

/**
 * The key matches the table name. The table is outside undo history, so undo and redo never
 * refresh it: whatever writes it invalidates `showSavedShapeKeys.all()`.
 */
export const showSavedShapeKeys = {
    all: () => ["saved_shapes"] as const,
};

/** The saved shapes the open show has a copy of (ADR 0006, saved shapes) */
export const showSavedShapesQueryOptions = () =>
    queryOptions<SavedShape[]>({
        queryKey: showSavedShapeKeys.all(),
        queryFn: () => getShowSavedShapes({ db }),
        staleTime: DEFAULT_STALE_TIME,
    });

export const useShowSavedShapes = () => useQuery(showSavedShapesQueryOptions());

/** Copies `shape` into the open show, or brings its copy up to date */
export async function copySavedShapeToShow(
    shape: SavedShape,
    queryClient: QueryClient,
): Promise<void> {
    await putShowSavedShape({ db, shape });
    await queryClient.invalidateQueries({
        queryKey: showSavedShapeKeys.all(),
    });
}

/** Deletes the open show's copy of saved shape `id` */
export async function deleteSavedShapeFromShow(
    id: string,
    queryClient: QueryClient,
): Promise<void> {
    await deleteShowSavedShape({ db, id });
    await queryClient.invalidateQueries({
        queryKey: showSavedShapeKeys.all(),
    });
}
