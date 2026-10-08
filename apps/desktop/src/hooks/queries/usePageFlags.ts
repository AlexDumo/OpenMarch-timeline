import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
    mutationOptions,
    QueryClient,
    useMutation,
    useQueryClient,
} from "@tanstack/react-query";
import { db } from "@/global/database/db";
import {
    addPageFlag,
    deletePageFlags,
    pageFlagGrid,
    planPageFlagInsertion,
    type AddedPageFlag,
    type PageFlagInsertion,
} from "@/db-functions/pageFlags";
import {
    deletePageYankWithMoves,
    deletePagesWithMoves,
    pageDeleteWithMovesMessage,
    type PageDeleteWithMovesResult,
} from "@/db-functions/pageDelete";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { invalidatePageQueries } from "./usePages";
import { invalidateTagQueries } from "./tags/queries";

/**
 * Page flag writes in timeline mode (ui.md UI-9 **+** and Deleting a flag, P8.13). They change only
 * page rows and `last_page_counts`, so they invalidate the page queries and nothing on the
 * timeline side. A refusal (E-ARGS) shows its message as a toast.
 */

/**
 * **+** at a beat. Resolves to the new page and its range `[startBeat, endBeat)`, the page timeline
 * the UI selects next (`onAdded`).
 */
export const addPageFlagMutationOptions = (
    qc: QueryClient,
    onAdded?: (added: AddedPageFlag) => void,
) =>
    mutationOptions({
        mutationFn: (beat: number) => addPageFlag({ db, beat }),
        onSuccess: (added) => {
            void invalidatePageQueries(qc);
            onAdded?.(added);
        },
        onError: (e) => toastTimelineError(e),
    });

/**
 * Deleting page flags: each page's row only, so motion is unchanged. In timeline mode this is
 * **Delete page**. A deleted page's tag appearances move to the next page.
 */
export const deletePageFlagsMutationOptions = (qc: QueryClient) =>
    mutationOptions({
        mutationFn: (pageIds: ReadonlySet<number>) =>
            deletePageFlags({ db, pageIds }),
        onSuccess: () => {
            void invalidatePageQueries(qc);
            invalidateTagQueries(qc);
        },
        onError: (e) => toastTimelineError(e),
    });

const toastDeleteWithMoves = (result: PageDeleteWithMovesResult) => {
    if (result.deleted.length > 0)
        toast.success(pageDeleteWithMovesMessage(result));
};

/**
 * **Delete page and its moves** (timeline mode): the page goes with its page moves, through the
 * timeline ripple. The toast names the pages that now look different.
 */
export const deletePagesWithMovesMutationOptions = (qc: QueryClient) =>
    mutationOptions({
        mutationFn: (pageIds: ReadonlySet<number>) =>
            deletePagesWithMoves({ db, pageIds }),
        onSuccess: (result) => {
            void invalidatePageQueries(qc);
            invalidateTagQueries(qc);
            toastDeleteWithMoves(result);
        },
        onError: (e) => toastTimelineError(e),
    });

/** **Yank** in timeline mode, with the same toast as `deletePagesWithMovesMutationOptions`. */
export const deletePageYankWithMovesMutationOptions = (qc: QueryClient) =>
    mutationOptions({
        mutationFn: (pageId: number) => deletePageYankWithMoves({ db, pageId }),
        onSuccess: (result) => {
            void invalidatePageQueries(qc);
            invalidateTagQueries(qc);
            toastDeleteWithMoves(result);
        },
        onError: (e) => toastTimelineError(e),
    });

/**
 * **+** for the paused playhead (UI-9): what it would add at `playheadBeat`, or null where it isn't
 * shown (playing, on a flag, at home, past the show's beats), and `add` to run it as one edit.
 * `pages` are the renderer's pages (`useTimingObjects`) and `beatCount` the show's beat count,
 * beat 0 included. `onAdded` gets the new page and its range, for selecting its page timeline.
 */
export function useAddPageFlag({
    pages,
    beatCount,
    playheadBeat,
    isPlaying,
    onAdded,
}: {
    pages: Parameters<typeof pageFlagGrid>[0];
    beatCount: number;
    playheadBeat: number;
    isPlaying: boolean;
    onAdded?: (added: AddedPageFlag) => void;
}): { insertion: PageFlagInsertion | null; add: () => void } {
    const queryClient = useQueryClient();
    const { mutate } = useMutation(
        addPageFlagMutationOptions(queryClient, onAdded),
    );
    const insertion = useMemo(
        () =>
            isPlaying
                ? null
                : planPageFlagInsertion(
                      pageFlagGrid(pages, beatCount),
                      playheadBeat,
                  ),
        [pages, beatCount, playheadBeat, isPlaying],
    );
    const add = useCallback(() => {
        if (insertion) mutate(insertion.beat);
    }, [insertion, mutate]);
    return { insertion, add };
}
