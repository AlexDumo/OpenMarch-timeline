import { useCallback, useMemo } from "react";
import Marcher, { performersOnly } from "@/global/classes/Marcher";
import { useQuery } from "@tanstack/react-query";
import { fieldPropertiesQueryOptions } from "@/hooks/queries";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useSelectedPage } from "@/context/SelectedPageContext";
import { useDatabaseReady } from "@/hooks/useDatabaseReady";
import {
    planCanvasEdit,
    timelineCoordinateRecords,
    type CanvasEditPlan,
} from "@/timeline/timelineCoordinateWrites";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";

/**
 * Where the selection edits, for `marchers` (see `getSelectedMarcherPages`), by `plan` when the
 * caller already planned the edit.
 */
const coordinateRecordsOf = (
    marchers: readonly Marcher[],
    plan?: CanvasEditPlan,
) => {
    if (marchers.length === 0) return [];
    plan ??= planCanvasEdit();
    if (!plan.ok) return [];
    try {
        return timelineCoordinateRecords(
            plan.beat,
            marchers.map((marcher) => marcher.id),
        );
    } catch (e) {
        toastTimelineError(e);
        return [];
    }
};

/**
 * Shared editor state that most editor action handlers depend on.
 * `ready` replaces the legacy guard in the removed registered-actions handler
 * (selected page and field properties loaded).
 */
export function useEditorReadiness() {
    const selectedPageContext = useSelectedPage();
    const selectedPage = selectedPageContext?.selectedPage ?? null;
    const databaseReady = useDatabaseReady();
    const { data: fieldProperties } = useQuery(
        fieldPropertiesQueryOptions(databaseReady),
    );
    const selectedMarchersContext = useSelectedMarchers();
    const selectedMarchers = useMemo(
        () => selectedMarchersContext?.selectedMarchers ?? [],
        [selectedMarchersContext?.selectedMarchers],
    );
    /**
     * The selected performers, for formation tools (align, distribute, swap, line, circle) that
     * would otherwise treat a selected prop as one more dot (C2.2). Moves, nudges and flips take
     * the whole selection.
     */
    const selectedPerformers = useMemo(
        () => performersOnly(selectedMarchers),
        [selectedMarchers],
    );

    /**
     * The selected marchers' positions where the selection edits (UI-9 Editing, P8.15): the
     * resolver's positions at the selected timeline's end, or homes at beat 0, for every selected
     * marcher. A refused selection gives nothing here; the write (`useUpdateCoordinates` or
     * `useUpdateSelectedMarchers`) says why, once.
     */
    const getSelectedMarcherPages = useCallback(
        () => coordinateRecordsOf(selectedMarchers),
        [selectedMarchers],
    );
    /**
     * `getSelectedMarcherPages` for the selected performers only. Swap passes the plan it writes
     * with, so the edit is planned once.
     */
    const getSelectedPerformerPages = useCallback(
        (plan?: CanvasEditPlan) =>
            coordinateRecordsOf(selectedPerformers, plan),
        [selectedPerformers],
    );

    const ready = !!selectedPage && !!fieldProperties;

    return {
        selectedPage,
        fieldProperties,
        ready,
        getSelectedMarcherPages,
        getSelectedPerformerPages,
        selectedMarchers,
        selectedPerformers,
    };
}

/** `useEditorReadiness`'s result, read once by `EditorActionHandlers` and passed to each handler hook */
export type EditorReadiness = ReturnType<typeof useEditorReadiness>;
