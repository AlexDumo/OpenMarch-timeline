import { mutationOptions, QueryClient } from "@tanstack/react-query";
import { db } from "@/global/database/db";
import {
    appendPageOfCounts,
    appendPagesToEnd,
    extendCountsTo,
} from "@/db-functions/showLength";
import type { AddedPageFlag } from "@/db-functions/pageFlags";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { invalidatePageQueries } from "./usePages";
import { measureKeys } from "./useMeasures";

/**
 * Counts past the end of the show (tempo experiment E1): **+ N counts** after the last page, and
 * extending the counts to the end of the music. Both add beats and measures (and the first a page),
 * so they invalidate those queries. A refusal shows its message as a toast.
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

/** Adds a page every `counts` counts to the end of the show (FB-6). Resolves to the pages added. */
export const appendPagesToEndMutationOptions = (
    qc: QueryClient,
    onAdded?: (pages: number) => void,
) =>
    mutationOptions({
        mutationFn: (counts: number) => appendPagesToEnd({ db, counts }),
        onSuccess: async (pages) => {
            await invalidateShowLength(qc);
            onAdded?.(pages);
        },
        onError: (e) => toastTimelineError(e),
    });

/** Extends the counts until `untilSeconds`, the end of the music. Resolves to the counts added. */
export const extendCountsToMutationOptions = (
    qc: QueryClient,
    onExtended?: (counts: number) => void,
) =>
    mutationOptions({
        mutationFn: (untilSeconds: number) =>
            extendCountsTo({ db, untilSeconds }),
        onSuccess: async (counts) => {
            await invalidateShowLength(qc);
            onExtended?.(counts);
        },
        onError: (e) => toastTimelineError(e),
    });
