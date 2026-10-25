import {
    useCallback,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type Page from "@/global/classes/Page";
import { db } from "@/global/database/db";
import {
    commitDrillEdit,
    onDrillPreviewRolledBack,
    previewDrillEdit,
} from "@/db-functions/drillEdits";
import { useTempoLabFlag } from "@/stores/UiSettingsStore";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { impactSummary, tolgeeTranslate as t } from "@/timeline/drillEditText";
import {
    timelineErrorMessage,
    toastTimelineError,
} from "@/timeline/timelineErrorMessages";
import DrillEditDialog, {
    invalidateAfterDrillEdit,
    type DrillEditRequest,
} from "./DrillEditDialog";
import type { TimelineDrillEdits } from "./Timeline";

/**
 * The timeline's count edits with drill choices (tempo experiment E10), behind the Tempo lab flag
 * `drillChoices`: the commands `Timeline` takes as `drillEdits`, and the dialog they open. A page
 * flag drag commits at once (one undo) and toasts what it did to the drill; its readout previews
 * the same while the pointer rests. With the flag off, there are no commands and no dialog.
 */
export function useTimelineDrillEdits({
    pages,
    beatCount,
    isPlaying,
}: {
    pages: readonly Page[];
    beatCount: number;
    isPlaying: boolean;
}): { drillEdits: TimelineDrillEdits | undefined; dialog: ReactNode } {
    const enabled = useTempoLabFlag("drillChoices");
    const queryClient = useQueryClient();
    const [request, setRequest] = useState<DrillEditRequest | null>(null);

    // A preview shares the database connection with the app's reads: a query that fetched while
    // its transaction was open may hold rows that were rolled back. Fetch those again (any query
    // fetching then, or updated since it began; docs/tempo/decisions.md has the real fix).
    useEffect(() => {
        if (!enabled) return;
        return onDrillPreviewRolledBack(({ start }) => {
            void queryClient.invalidateQueries({
                predicate: (query) =>
                    query.state.fetchStatus === "fetching" ||
                    query.state.dataUpdatedAt >= start,
            });
        });
    }, [enabled, queryClient]);

    const open = useCallback(
        (next: DrillEditRequest) => {
            if (!isPlaying) setRequest(next);
        },
        [isPlaying],
    );

    const drillEdits = useMemo<TimelineDrillEdits | undefined>(() => {
        if (!enabled) return undefined;
        return {
            onRemoveCounts: (range, measure) =>
                open({
                    kind: "remove",
                    start: Math.max(1, range.startBeatIndex),
                    end: range.endBeatIndex,
                    ...(measure ? { measure } : {}),
                }),
            onAddCountsAtFlag: (pageId) => {
                const page = pages.find((p) => p.id === pageId);
                const last = page?.beats[page.beats.length - 1];
                if (last)
                    open({ kind: "add", at: last.index + 1, place: "flag" });
            },
            onAddCountsAtPlayhead: () =>
                open({
                    kind: "add",
                    at: Math.min(
                        beatCount,
                        Math.max(
                            1,
                            Math.round(
                                useTimelineSelectionStore.getState()
                                    .playheadBeat,
                            ),
                        ),
                    ),
                    place: "playhead",
                }),
            onMovePageFlag: (pageId, toBeat) => {
                if (isPlaying) return;
                return commitDrillEdit({
                    db,
                    edit: { kind: "moveFlag", pageId, to: toBeat },
                })
                    .then(async (impact) => {
                        await invalidateAfterDrillEdit(queryClient);
                        toast.success(impactSummary(impact, t));
                    })
                    .catch((error: unknown) => toastTimelineError(error));
            },
            previewPageFlagMove: async (pageId, toBeat) => {
                const preview = await previewDrillEdit({
                    db,
                    edit: { kind: "moveFlag", pageId, to: toBeat },
                    channel: "page-flag",
                });
                if (!preview) return null;
                if (!preview.ok)
                    return {
                        ok: false,
                        text: timelineErrorMessage(preview.error),
                    };
                // The page lines are already in the readout; say what the moves do
                const moves = preview.impact.moves.filter(
                    (m) => m.change !== "shifted",
                );
                return {
                    ok: true,
                    text:
                        moves.length === 0
                            ? t(
                                  "timeline.drillEdits.flag.noMoves",
                                  "No move lands on this flag.",
                              )
                            : t(
                                  "timeline.drillEdits.flag.movesFollow",
                                  "{n, plural, one {# move follows} other {# moves follow}} the flag",
                                  { n: moves.length },
                              ),
                };
            },
        };
    }, [beatCount, enabled, isPlaying, open, pages, queryClient]);

    const dialog =
        enabled && request ? (
            <DrillEditDialog
                // A new request (an alternative) starts the dialog afresh
                key={JSON.stringify(request)}
                request={request}
                pages={pages}
                beatCount={beatCount}
                onClose={() => setRequest(null)}
                onReopen={setRequest}
                onShowRange={(start, end) =>
                    useTimelineSelectionStore.getState().selectRange(start, end)
                }
            />
        ) : null;
    return { drillEdits, dialog };
}
