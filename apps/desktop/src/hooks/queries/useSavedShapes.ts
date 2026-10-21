import {
    mutationOptions,
    queryOptions,
    type QueryClient,
} from "@tanstack/react-query";
import { db } from "@/global/database/db";
import tolgee from "@/global/singletons/Tolgee";
import {
    createSavedShapeInTransaction,
    deleteSavedShapeInTransaction,
    getSavedShapes,
    type SavedShape,
} from "@/db-functions/savedShapes";
import { conToastError } from "@/utilities/utils";
import { DEFAULT_STALE_TIME } from "./constants";

/**
 * The key base matches the table name. The table is outside undo history, so undo and redo
 * never refresh it: its mutations invalidate `savedShapeKeys.all()`.
 */
const KEY_BASE = "saved_shapes";

export const savedShapeKeys = {
    all: () => [KEY_BASE] as const,
};

/** The saved shapes the open show has a copy of (ADR 0006, saved shapes) */
export const allSavedShapesQueryOptions = () =>
    queryOptions<SavedShape[]>({
        queryKey: savedShapeKeys.all(),
        queryFn: () => getSavedShapes({ db }),
        staleTime: DEFAULT_STALE_TIME,
    });

/** Copies a saved shape into the open show, or brings its copy up to date */
export const createSavedShapeMutationOptions = (qc: QueryClient) =>
    mutationOptions({
        mutationFn: (shape: SavedShape) =>
            db.transaction((tx) =>
                createSavedShapeInTransaction({ tx, shape }),
            ),
        onSuccess: () =>
            qc.invalidateQueries({ queryKey: savedShapeKeys.all() }),
        onError: (e, shape) =>
            conToastError(tolgee.t("shapes.saved.copyFailed"), e, shape),
    });

/** Deletes the open show's copy of a saved shape, by id */
export const deleteSavedShapeMutationOptions = (qc: QueryClient) =>
    mutationOptions({
        mutationFn: (id: string) =>
            db.transaction((tx) => deleteSavedShapeInTransaction({ tx, id })),
        onSuccess: () =>
            qc.invalidateQueries({ queryKey: savedShapeKeys.all() }),
        onError: (e, id) =>
            conToastError(tolgee.t("shapes.saved.deleteFailed"), e, id),
    });
