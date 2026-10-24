import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTimingObjects } from "@/hooks";
import { compareBeats } from "@/global/classes/Beat";
import { workspaceSettingsQueryOptions } from "@/hooks/queries/useWorkspaceSettings";
import { useTempoSyncedBeatIds } from "@/hooks/queries/useTempo";
import {
    deriveTempoMap,
    linedUpCounts,
    marksByMeasure,
    type TempoMapMeasure,
} from "@/timeline/tempo";

/**
 * The show's counts, measures and tempo map marks as the tempo map takes them, with the derived
 * rows. Shared by the tempo map panel and the Align view (units in its labels, typed sections),
 * and by Tap the beat (which synced counts are really lined up with the music).
 */
export function useTempoMapState() {
    const { beats, measures } = useTimingObjects()!;
    const { data: settings } = useQuery(workspaceSettingsQueryOptions());
    const syncedBeatIds = useTempoSyncedBeatIds();
    return useMemo(() => {
        const sorted = [...beats].sort(compareBeats);
        const beatIds = sorted.map((b) => b.id);
        const durations = sorted.map((b) => b.duration);
        const ordinal = new Map(beatIds.map((id, i) => [id, i]));
        const mapMeasures: TempoMapMeasure[] = [];
        const measureStartBeatIds: number[] = [];
        for (const m of measures) {
            const firstCount = ordinal.get(m.startBeat.id);
            if (firstCount === undefined) continue;
            mapMeasures.push({
                number: m.number,
                rehearsalMark: m.rehearsalMark,
                firstCount,
                counts: m.counts,
            });
            measureStartBeatIds.push(m.startBeat.id);
        }
        const marks = marksByMeasure(
            settings?.tempoMapMarks,
            measureStartBeatIds,
        );
        const rows = deriveTempoMap({
            durations,
            measures: mapMeasures,
            marks,
        });
        const synced = new Set(syncedBeatIds);
        // Synced counts that aren't a ● row's edge: lined up with the recording (DE-6)
        const linedUpBeatIds = linedUpCounts(
            beatIds.flatMap((id, i) => (synced.has(id) ? [i] : [])),
            rows,
        ).map((i) => beatIds[i]!);
        return {
            beatIds,
            measureStartBeatIds,
            syncedBeatIds,
            linedUpBeatIds,
            state: { durations, measures: mapMeasures, marks, rows },
        };
    }, [beats, measures, settings?.tempoMapMarks, syncedBeatIds]);
}
