import { mutationOptions, QueryClient } from "@tanstack/react-query";
import { db } from "@/global/database/db";
import {
    appendPageOfCounts,
    appendPagesToEnd,
} from "@/db-functions/showLength";
import type { AddedPageFlag } from "@/db-functions/pageFlags";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { invalidatePageQueries } from "./usePages";
import { measureKeys } from "./useMeasures";

/**
 * Pages after the last one (E1, with endless counts): **+ N counts** after the last page, and pages
 * every N counts to the end of the music. Both can store counts and measures (and add pages), so
 * they invalidate those queries. A refusal shows its message as a toast.
 */

const invalidateShowLength = async (qc: QueryClient) => {
    await invalidatePageQueries(qc);
    await qc.invalidateQueries({ queryKey: measureKeys.all() });
};

/** **+ N counts**: a page of `counts` counts after the last page. `onAdded` gets the new page. */
export const appendPageOfCountsMutationOptions = (
    qc: QueryClient,
    onAdded?: (added: AddedPageFlag) => void,
) =>
    mutationOptions({
        mutationFn: (counts: number) => appendPageOfCounts({ db, counts }),
        onSuccess: async (added) => {
            await invalidateShowLength(qc);
            onAdded?.(added);
        },
        onError: (e) => toastTimelineError(e),
    });

/** Adds a page every `counts` counts to `untilBeat`, the music's end (FB-7). Resolves to the pages added. */
export const appendPagesToEndMutationOptions = (
    qc: QueryClient,
    onAdded?: (pages: number) => void,
) =>
    mutationOptions({
        mutationFn: ({
            counts,
            untilBeat,
        }: {
            counts: number;
            untilBeat: number;
        }) => appendPagesToEnd({ db, counts, untilBeat }),
        onSuccess: async (pages) => {
            await invalidateShowLength(qc);
            onAdded?.(pages);
        },
        onError: (e) => toastTimelineError(e),
    });
