import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { allMarchersQueryOptions } from "@/hooks/queries/useMarchers";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";

/**
 * Adds marchers to the selection, keeping those selected. A command that also changed marchers it
 * wasn't asked for (the rest of a shape, which is Held whole: owner, 2026-11-15) selects them, so
 * their changed holds show.
 */
export function useAddToSelection(): (ids: readonly number[]) => void {
    const selection = useSelectedMarchers();
    const { data: performers } = useQuery(allMarchersQueryOptions());
    return useCallback(
        (ids: readonly number[]) => {
            if (!selection || !performers) return;
            const have = new Set(selection.selectedMarchers.map((m) => m.id));
            const added = performers.filter(
                (m) => ids.includes(m.id) && !have.has(m.id),
            );
            if (added.length > 0)
                selection.setSelectedMarchers([
                    ...selection.selectedMarchers,
                    ...added,
                ]);
        },
        [selection, performers],
    );
}
