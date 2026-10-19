/**
 * The items the timeline resolver puts down where their holders release them (ADR 0002 D-9,
 * `withPutDowns` in `@openmarch/core`): each item's marchers row and Placement changes, beats as
 * ordinals. Under the `item_placements` key, so Placement edits and their undo refresh it; items,
 * beats and timeline commits (a deleted holder drops its held changes) refresh it too.
 */
import { useEffect } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PutDownItem } from "@openmarch/core";
import { db } from "@/global/database/db";
import { readPutDownItems } from "@/db-functions/itemPutDown";
import { subscribeTimelineChanges } from "@/db-functions/timelineChanges";
import { DEFAULT_STALE_TIME } from "./constants";
import { allItemsQueryOptions } from "./useItems";
import { allDatabaseBeatsQueryOptions } from "./useBeats";

export const putDownItemsKeys = {
    all: () => ["item_placements", "put_down"] as const,
};

export const putDownItemsQueryOptions = () =>
    queryOptions({
        queryKey: putDownItemsKeys.all(),
        queryFn: () => readPutDownItems(db),
        staleTime: DEFAULT_STALE_TIME,
    });

/** The put-down input, kept fresh. Undefined while it loads. */
export function usePutDownItems(): PutDownItem[] | undefined {
    const queryClient = useQueryClient();
    const { data } = useQuery(putDownItemsQueryOptions());
    const { dataUpdatedAt: itemsAt } = useQuery(allItemsQueryOptions());
    const { dataUpdatedAt: beatsAt } = useQuery(allDatabaseBeatsQueryOptions());
    useEffect(() => {
        void queryClient.invalidateQueries({
            queryKey: putDownItemsKeys.all(),
        });
    }, [queryClient, itemsAt, beatsAt]);
    useEffect(
        () =>
            subscribeTimelineChanges(
                () =>
                    void queryClient.invalidateQueries({
                        queryKey: putDownItemsKeys.all(),
                    }),
            ),
        [queryClient],
    );
    return data;
}
