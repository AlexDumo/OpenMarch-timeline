import {
    mutationOptions,
    QueryClient,
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query";
import { db } from "@/global/database/db";
import {
    retimeBeats,
    setTempoSyncedBeatIds,
    type RetimeBeatsArgs,
} from "@/db-functions/tempo";
import { conToastError } from "@/utilities/utils";
import tolgee from "@/global/singletons/Tolgee";
import { beatKeys } from "./useBeats";
import { measureKeys } from "./useMeasures";
import { pageKeys } from "./usePages";
import {
    workspaceSettingsKeys,
    workspaceSettingsQueryOptions,
} from "./useWorkspaceSettings";

/**
 * Refreshes what a retime changes: beats first (measures and pages are built from them), then
 * measures, pages and the workspace settings (audio offset, synced counts).
 */
export async function invalidateAfterRetime(qc: QueryClient): Promise<void> {
    await qc.invalidateQueries({ queryKey: beatKeys.all() });
    void qc.invalidateQueries({ queryKey: measureKeys.all() });
    void qc.invalidateQueries({ queryKey: pageKeys.all() });
    void qc.invalidateQueries({ queryKey: workspaceSettingsKeys.all() });
}

/**
 * Writes a retime (new beat durations, and optionally the audio offset and synced counts) as one
 * undo entry. Build `newDurationsByBeatId` with `durationsByBeatId(beatIds, result.durations)` and
 * pass `result.originShift` from the pure tempo library (`@/timeline/tempo`).
 */
export const retimeBeatsMutationOptions = (qc: QueryClient) =>
    mutationOptions({
        mutationFn: (args: RetimeBeatsArgs) => retimeBeats({ db, ...args }),
        onSuccess: () => invalidateAfterRetime(qc),
        onError: (e, variables) => {
            conToastError(tolgee.t("tempo.retimeError"), e, variables);
        },
    });

/** Replaces the synced counts (by beat id) as one undo entry. */
export const setTempoSyncedBeatIdsMutationOptions = (qc: QueryClient) =>
    mutationOptions({
        mutationFn: (syncedBeatIds: readonly number[]) =>
            setTempoSyncedBeatIds({ db, syncedBeatIds }),
        onSuccess: () =>
            qc.invalidateQueries({ queryKey: workspaceSettingsKeys.all() }),
        onError: (e, variables) => {
            conToastError(tolgee.t("tempo.syncError"), e, variables);
        },
    });

/** `retimeBeatsMutationOptions` as a hook. */
export const useRetimeBeats = () =>
    useMutation(retimeBeatsMutationOptions(useQueryClient()));

/** `setTempoSyncedBeatIdsMutationOptions` as a hook. */
export const useSetTempoSyncedBeatIds = () =>
    useMutation(setTempoSyncedBeatIdsMutationOptions(useQueryClient()));

const selectSyncedBeatIds = (settings: {
    tempoSyncedBeatIds?: number[];
}): number[] => settings.tempoSyncedBeatIds ?? [];

/**
 * The synced counts' beat ids, as stored (ascending). May name beats that were deleted since;
 * look them up against the current beats. Empty while the settings load.
 */
export function useTempoSyncedBeatIds(): number[] {
    const { data } = useQuery({
        ...workspaceSettingsQueryOptions(),
        select: selectSyncedBeatIds,
    });
    return data ?? EMPTY;
}

const EMPTY: number[] = [];
