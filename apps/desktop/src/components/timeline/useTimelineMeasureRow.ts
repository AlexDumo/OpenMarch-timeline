import { useMemo } from "react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/global/database/db";
import type Measure from "@/global/classes/Measure";
import { editMeasureLines } from "@/db-functions/measureLines";
import { measureKeys } from "@/hooks/queries/useMeasures";
import { usePerformHistoryAction } from "@/hooks/queries/useHistory";
import type { MeasureLineEdit } from "@/timeline/measureLines";
import { conToastError } from "@/utilities/utils";
import type { TimelineMeasureRowCommands } from "./TimelineMeasureRow";
import { measureRowText } from "./measureRowText";

/** The toast after an edit took marks away: one removed by name, or marks lost with their lines */
const droppedMarksMessage = (
    dropped: readonly string[],
    removedMark?: string | null,
) =>
    removedMark
        ? measureRowText("toast.removedMark", "Removed rehearsal mark {mark}", {
              mark: removedMark,
          })
        : measureRowText(
              "toast.droppedMarks",
              "Removed rehearsal {marks} with {count, plural, one {its measure line} other {their measure lines}}",
              { marks: dropped.join(", "), count: dropped.length },
          );

/**
 * The measure row's writes for the app's timeline (tempo E8): each command is one
 * `editMeasureLines` edit, so one undo entry that changes only `measures` rows. Removing a mark
 * says so with an Undo button, and so does an edit that took marks away with their lines. Beats
 * are spec beats (`Timeline` converts).
 */
export function useTimelineMeasureRow(
    measures: readonly Measure[],
): TimelineMeasureRowCommands {
    const queryClient = useQueryClient();
    const { mutate: performHistoryAction } = usePerformHistoryAction();
    const { mutate } = useMutation({
        mutationFn: (edit: MeasureLineEdit) => editMeasureLines({ db, edit }),
        onSettled: () =>
            void queryClient.invalidateQueries({ queryKey: measureKeys.all() }),
        onError: (error, edit) =>
            conToastError(
                measureRowText(
                    "toast.failed",
                    "The measure row couldn't change: {error}",
                    { error: error.message },
                ),
                error,
                edit,
            ),
    });
    return useMemo(() => {
        const undoAction = {
            label: measureRowText("toast.undo", "Undo"),
            onClick: () => performHistoryAction("undo"),
        };
        const markOf = (measureId: number | string) =>
            measures.find((m) => m.id === Number(measureId))?.rehearsalMark ??
            null;
        const run = (edit: MeasureLineEdit, removedMark?: string | null) =>
            mutate(edit, {
                onSuccess: (result) => {
                    const dropped = removedMark
                        ? [removedMark]
                        : result.droppedMarks;
                    if (dropped.length === 0) return;
                    toast(droppedMarksMessage(dropped, removedMark), {
                        action: undoAction,
                    });
                },
            });
        return {
            onSetMark: (measureId, mark) => {
                const before = markOf(measureId);
                const removing = !mark?.trim() && before ? before : null;
                run(
                    { kind: "mark", measureId: Number(measureId), mark },
                    removing,
                );
            },
            onStartMeasure: (beat, mark) =>
                run({ kind: "start", beat, mark: mark ?? undefined }),
            onRemoveLine: (measureId) =>
                run({ kind: "remove", measureId: Number(measureId) }),
            onSetBeats: (measureId, beats, laterKeep) =>
                run({
                    kind: "setBeats",
                    measureId: Number(measureId),
                    beats,
                    laterKeep,
                }),
            onMoveMark: (from, to) =>
                run({
                    kind: "moveMark",
                    fromMeasureId: Number(from),
                    toMeasureId: Number(to),
                }),
            onBeatsFrom: (measureId, beats, until) =>
                run({
                    kind: "beatsFrom",
                    measureId: Number(measureId),
                    beats,
                    until,
                }),
        };
    }, [measures, mutate, performHistoryAction]);
}
