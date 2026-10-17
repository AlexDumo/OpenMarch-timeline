import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { allMarchersQueryOptions } from "@/hooks/queries/useMarchers";
import { marcherIdsForAllTagIdsQueryOptions } from "@/hooks/queries/tags/queries";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useVisualsStore } from "@/stores/VisualsStore";
import { whoMarcherIds } from "./visualsWho";

const NO_TAGS: ReadonlyMap<number, readonly number[]> = new Map();
const NO_IDS: readonly number[] = [];

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
    // Only a focused selection follows it: another who keeps its set, so
    // what reads it (the band, the dimming) doesn't redo its work per click
    const following = focus?.kind === "selection";
    const selectedIds = useMemo(
        () => (following ? selectedMarchers.map((m) => m.id) : NO_IDS),
        [following, selectedMarchers],
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
