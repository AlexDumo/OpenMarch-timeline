import {
    getRedoStackLength,
    getUndoStackLength,
    performHistoryAction,
} from "@/db-functions";
import { db } from "@/global/database/db";
import {
    queryOptions,
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query";
import { safelyInvalidateQueries } from "./utils";
import { allMarchersQueryOptions } from "./useMarchers";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useSelectedPage } from "@/context/SelectedPageContext";
import { useTimingObjects } from "../useTimingObjects";
import { coordinateDataKeys } from "./useCoordinateData";

const KEY_BASE = "history";

export const historyKeys = {
    all: () => [KEY_BASE] as const,
    canUndo: () => [KEY_BASE, "canUndo"] as const,
    canRedo: () => [KEY_BASE, "canRedo"] as const,
};

export const canUndoQueryOptions = (enabled = true) =>
    queryOptions({
        queryKey: historyKeys.canUndo(),
        queryFn: async () => {
            const undoStackLength = await getUndoStackLength(db);
            return undoStackLength > 0;
        },
        enabled,
    });

export const canRedoQueryOptions = (enabled = true) =>
    queryOptions({
        queryKey: historyKeys.canRedo(),
        queryFn: async () => {
            const redoStackLength = await getRedoStackLength(db);
            return redoStackLength > 0;
        },
        enabled,
    });

export const usePerformHistoryAction = () => {
    const qc = useQueryClient();
    const { pages } = useTimingObjects();
    const { data: marchers } = useQuery(allMarchersQueryOptions());
    const selectedMarchersContext = useSelectedMarchers();
    const setSelectedMarchers =
        selectedMarchersContext?.setSelectedMarchers ?? (() => {});
    const selectedPageContext = useSelectedPage();
    const setSelectedPage = selectedPageContext?.setSelectedPage ?? (() => {});

    return useMutation({
        mutationFn: (type: "undo" | "redo") =>
            performHistoryAction(type, db, {
                currentPageId: selectedPageContext?.selectedPage?.id,
            }),
        onSuccess: async (response) => {
            // Invalidate history query
            void qc.invalidateQueries({
                queryKey: [KEY_BASE],
            });

            if (response.queriesToInvalidate) {
                await safelyInvalidateQueries(response.queriesToInvalidate, qc);
            }

            // Greedily invalidate all coordinate data queries
            // The better thing to do would be to check the pages that were modified
            // (In timeline mode these queries don't run; the resolver store follows the action's
            // change batch instead.)
            void qc.invalidateQueries({ queryKey: coordinateDataKeys.all });

            // Page 0 has id 0, so compare with null. A page this render doesn't know yet (one
            // the action just restored) is skipped rather than selected as undefined.
            const pageToGoTo =
                response.pageIdToGoTo != null
                    ? pages?.find((page) => page.id === response.pageIdToGoTo)
                    : undefined;
            if (pageToGoTo) setSelectedPage(pageToGoTo);
            // The marchers as fetched again above, so restored marchers can be selected
            const currentMarchers =
                qc.getQueryData(allMarchersQueryOptions().queryKey) ?? marchers;
            if (response.marcherIdsToSelect != null && currentMarchers) {
                setSelectedMarchers(
                    currentMarchers.filter((marcher) =>
                        response.marcherIdsToSelect?.has(marcher.id),
                    ),
                );
            }
        },
    });
};
