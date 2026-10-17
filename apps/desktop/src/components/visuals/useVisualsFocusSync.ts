import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { allMarchersQueryOptions } from "@/hooks/queries/useMarchers";
import { marcherIdsForAllTagIdsQueryOptions } from "@/hooks/queries/tags/queries";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useVisualsStore } from "@/stores/VisualsStore";
import { whoMarcherIds } from "./visualsWho";

const NO_TAGS: ReadonlyMap<number, readonly number[]> = new Map();

/**
 * Keeps the Visuals store's `focusMarcherIds` current: the focused who's
 * marchers, recomputed when the show's marchers or tags change, and as the
 * selection changes when the selection is focused.
 */
export function useVisualsFocusSync(): void {
    const focus = useVisualsStore((s) => s.focus);
    const setFocusMarcherIds = useVisualsStore((s) => s.setFocusMarcherIds);
    const { data: marchers } = useQuery(allMarchersQueryOptions());
    const { data: byTag } = useQuery(marcherIdsForAllTagIdsQueryOptions());
    const { selectedMarchers } = useSelectedMarchers()!;
    const selectedIds = useMemo(
        () => selectedMarchers.map((m) => m.id),
        [selectedMarchers],
    );

    useEffect(() => {
        if (!focus || !marchers) {
            setFocusMarcherIds(null);
            return;
        }
        setFocusMarcherIds(
            whoMarcherIds(focus, marchers, byTag ?? NO_TAGS, selectedIds),
        );
    }, [focus, marchers, byTag, selectedIds, setFocusMarcherIds]);
}
