import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
    deleteTimeline,
    renameTimeline,
    shiftTimeline,
} from "@/db-functions/timelineCommands";
import { addMarchersToTimeline } from "@/db-functions/timelineMembership";
import type { DbConnection } from "@/db-functions/types";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { usePerformHistoryAction } from "@/hooks/queries/useHistory";
import { allMarchersQueryOptions } from "@/hooks/queries/useMarchers";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { moveLabel } from "@/timeline/timelineViewModel";
import { useMoveCardRevealStore } from "@/stores/MoveCardRevealStore";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import type { TimelineInput } from "./Timeline";
import type { TimelineAddMarchersMenu } from "./TimelineRangeMenu";
import type {
    TimelineBeatRange,
    TimelineRangeChange,
} from "./TimelineViewModel";

/**
 * The timeline's commands (P8.9, ui.md's mapping table), wired to the write path. Everything here
 * arrives in spec beats (`Timeline` converts from its view axis, UI-5).
 */

/**
 * The spec timeline a clip move shifts and by how much: the clip's track carries the spec timeline
 * as `linkId`, and every clip of it moves by the clip's drag. `null` for an unknown clip or one
 * dropped where it started (a no-op the write path would reject as an empty edit).
 */
export function timelineShiftFor(
    change: TimelineRangeChange,
    timelines: readonly TimelineInput[],
): { timelineId: number; delta: number } | null {
    const track = timelines.find((t) => t.id === change.timelineId);
    if (!track || track.linkId === undefined) return null;
    const delta = change.startBeatIndex - track.startBeatIndex;
    if (delta === 0) return null;
    return { timelineId: Number(track.linkId), delta };
}

/** Why **Add selected marchers** is unavailable, or null when it can run. */
export function addSelectedMarchersBlocker(
    selectedMarcherIds: ReadonlySet<number>,
): string | null {
    return selectedMarcherIds.size === 0
        ? "Select marchers first: at home, on a range with no timeline yet, or in a timeline they're in."
        : null;
}

/**
 * The panel's side of the commands: the callbacks that run each command as one undoable edit and
 * show a refusal's friendly message (P8.6) as a toast. A clip move of the selected timeline moves
 * the selection with it (UI-9).
 *
 * Create Track isn't offered in timeline mode (P8.15): with one timeline per page it would give a
 * marcher a second transition in a page timeline. **Add selected marchers** replaces it (UI-9
 * Creating a timeline).
 */
export function useTimelineCommands({
    database,
    timelines,
    selectedMarcherIds,
}: {
    database: DbConnection;
    timelines: readonly TimelineInput[];
    selectedMarcherIds: ReadonlySet<number>;
}) {
    const commitTimelineRange = useCallback(
        (change: TimelineRangeChange) => {
            const shift = timelineShiftFor(change, timelines);
            const track = timelines.find((t) => t.id === change.timelineId);
            if (!shift || !track) return;
            const from = {
                start: track.startBeatIndex,
                end: track.endBeatIndex,
            };
            shiftTimeline({ db: database, ...shift }).then(
                (result) => {
                    if (result)
                        useTimelineSelectionStore
                            .getState()
                            .followTimelineShift(from, shift.delta);
                },
                (error: unknown) => toastTimelineError(error),
            );
        },
        [database, timelines],
    );

    return {
        commitTimelineRange,
        addSelectedMarchers: useAddSelectedMarchers(
            database,
            selectedMarcherIds,
        ),
    };
}

/**
 * UI-9 Adding marchers: the selected marchers join the timeline over the right-clicked range
 * (spec beats), which is created if none has it, as one undoable edit; a refusal is a toast. The
 * menu doesn't change the selection.
 */
function useAddSelectedMarchers(
    database: DbConnection,
    selectedMarcherIds: ReadonlySet<number>,
): TimelineAddMarchersMenu {
    return useMemo(
        (): TimelineAddMarchersMenu => ({
            disabledReason: addSelectedMarchersBlocker(selectedMarcherIds),
            onAdd: (range: TimelineBeatRange) => {
                if (selectedMarcherIds.size === 0) return;
                addMarchersToTimeline({
                    db: database,
                    range: {
                        start: range.startBeatIndex,
                        end: range.endBeatIndex,
                    },
                    marcherIds: [...selectedMarcherIds],
                }).catch((error: unknown) => toastTimelineError(error));
            },
        }),
        [database, selectedMarcherIds],
    );
}

/** Why **Edit move** and **Delete move** are unavailable (UI-14), or null when they can run. */
export function moveCommandBlocker(isPlaying: boolean): string | null {
    return isPlaying ? "Pause to edit or delete a move." : null;
}

/**
 * A move's commands (ui.md UI-14), for the timeline's clips and the inspector's Move card. Each
 * write is one undoable edit, and a refusal is a toast (P8.6).
 *
 * - **Delete move** deletes the timeline, its transitions and assignments; moves it passed through
 *   come back (UI-10). The window stays put, and an isolated move that goes ends isolation (the
 *   store's "timeline goes away" path). A toast names what went, with **Undo** (the app's undo).
 * - **Rename** stores the name as `renameTimeline` normalizes it; an unchanged name writes nothing.
 * - **Select its marchers** selects the marchers with an assignment in it on the canvas.
 * - **Edit move** selects the move's window (S on its start, pinned when that isn't a flag; P on
 *   its end), selects its marchers, and brings the inspector's Move card into view. It doesn't
 *   isolate (double-click does).
 */
export function useMoveCommands(database: DbConnection) {
    const { mutate: performHistoryAction } = usePerformHistoryAction();
    const queryClient = useQueryClient();
    const setSelectedMarchers = useSelectedMarchers()?.setSelectedMarchers;
    return useMemo(() => {
        const stored = (timelineId: number) =>
            useTimelineSelectionStore
                .getState()
                .storedTimelines?.find((t) => t.id === timelineId);
        const selectMarchers = async (timelineId: number) => {
            const members = stored(timelineId)?.marcherIds;
            if (!members || !setSelectedMarchers) return;
            try {
                const marchers = await queryClient.ensureQueryData(
                    allMarchersQueryOptions(),
                );
                setSelectedMarchers(marchers.filter((m) => members.has(m.id)));
            } catch (error: unknown) {
                console.error("Couldn't read the marchers", error);
            }
        };
        return {
            deleteMove: (timelineId: number) => {
                const label = moveLabel(
                    stored(timelineId) ?? { id: timelineId },
                );
                deleteTimeline({ db: database, timelineId }).then(
                    () =>
                        toast.success(`Deleted ${label}`, {
                            action: {
                                label: "Undo",
                                onClick: () => performHistoryAction("undo"),
                            },
                        }),
                    (error: unknown) => toastTimelineError(error),
                );
            },
            renameMove: (timelineId: number, name: string | null) => {
                renameTimeline({ db: database, timelineId, name }).catch(
                    (error: unknown) => toastTimelineError(error),
                );
            },
            selectMarchers,
            editMove: (timelineId: number) => {
                const timeline = stored(timelineId);
                if (!timeline) return;
                useTimelineSelectionStore
                    .getState()
                    .selectRange(timeline.start, timeline.end);
                // The card comes into view once the selected marchers' editors are in the
                // inspector above it, so they don't push it back out
                void selectMarchers(timelineId).then(() =>
                    useMoveCardRevealStore.getState().reveal(timelineId),
                );
            },
        };
    }, [database, performHistoryAction, queryClient, setSelectedMarchers]);
}
