import { useEffect } from "react";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import {
    useMoveMemberSelectionStore,
    type MoveMemberSelection,
} from "@/stores/MoveMemberSelectionStore";
import {
    isolatedTimeline,
    selectedStoredTimeline,
    useTimelineSelectionStore,
    type TimelineSelectionState,
} from "@/stores/TimelineSelectionStore";

/**
 * The move the window is on: the isolated one, else the stored timeline the window resolves to
 * when it is off the page boxes (a page's own timeline isn't a move). `null` otherwise.
 */
export function windowMoveId(s: TimelineSelectionState): number | null {
    const timeline = isolatedTimeline(s) ?? selectedStoredTimeline(s);
    if (!timeline) return null;
    const onPageBox = s.pageBoxes.some(
        (b) => b.start === timeline.start && b.end === timeline.end,
    );
    return onPageBox ? null : timeline.id;
}

/**
 * Whether going to move `moveId` should clear the selection (UI-14 round-2 review): **Select
 * them** selected another move's marchers, and they are still exactly the selection. A selection
 * changed since (a marcher added or removed) is the designer's own, and stays.
 */
export function isLeftoverMoveSelection(
    recorded: MoveMemberSelection | null,
    selectedIds: readonly number[],
    moveId: number,
): boolean {
    if (!recorded || recorded.timelineId === moveId) return false;
    return (
        selectedIds.length === recorded.marcherIds.size &&
        selectedIds.every((id) => recorded.marcherIds.has(id))
    );
}

/**
 * Clicking another move (its clip, a double-click, **Edit move**) clears a selection left by
 * the previous move's **Select them** (UI-14 round-2 review), so the inspector shows the new
 * move's card rather than the old move's marchers. The record goes once another move is on.
 */
export function useClearLeftoverMoveSelection(): void {
    const context = useSelectedMarchers();
    const moveId = useTimelineSelectionStore(windowMoveId);
    useEffect(() => {
        if (moveId === null) return;
        const store = useMoveMemberSelectionStore.getState();
        const recorded = store.selected;
        if (!recorded || recorded.timelineId === moveId) return;
        store.clear();
        const selectedIds = (context?.selectedMarchers ?? []).map((m) => m.id);
        if (isLeftoverMoveSelection(recorded, selectedIds, moveId))
            context?.setSelectedMarchers([]);
        // Only on going to another move, not on every selection change
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [moveId]);
}
