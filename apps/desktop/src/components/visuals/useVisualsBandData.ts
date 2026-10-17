/**
 * Everything Visuals mode's cue band draws for the focused who on the
 * current tab, from the show's stored cues and a compile of them: the lanes
 * (`visualsLanes.ts`), the result row, the counts and what each focused
 * marcher carries. Null with no focus, or while the show loads.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    compileCues,
    type CompiledCues,
    type CueTarget,
    type PerformerCarry,
} from "@openmarch/core";
import { allCuesQueryOptions } from "@/hooks/queries/useCues";
import { allMarchersQueryOptions } from "@/hooks/queries/useMarchers";
import { marcherIdsForAllTagIdsQueryOptions } from "@/hooks/queries/tags/queries";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import {
    useShowPerformerDefaults,
    useStoredCues,
} from "@/view3d/window/performers/useStoredCues";
import { carryForSection } from "@/view3d/core/instruments/catalog";
import { performerCarryOf } from "@/view3d/core/marchers/hornChannel";
import { useVisualsStore } from "@/stores/VisualsStore";
import {
    countIndex,
    resultRow,
    targetOfWho,
    visualsLanes,
    type CountIndex,
    type Lanes,
    type ResultSpan,
} from "./visualsLanes";
import type { VisualsChannel, VisualsWho } from "./visualsWho";

const NO_TAGS: ReadonlyMap<number, readonly number[]> = new Map();

/** What a marcher carries, for the cues that fit them: their section's usual equipment. */
export const sectionCarries = (section: string): PerformerCarry =>
    performerCarryOf(carryForSection(section)?.family ?? null);

export interface VisualsBandData {
    channel: VisualsChannel;
    focus: VisualsWho;
    target: CueTarget | null;
    lanes: Lanes;
    result: ResultSpan[];
    counts: CountIndex;
    compiled: CompiledCues;
    /** What the focused marchers carry, each kind once. */
    carries: PerformerCarry[];
    /** How many marchers are focused. */
    marcherCount: number;
}

/** `enabled` false (outside Visuals mode) skips the compile and returns null. */
export function useVisualsBandData(enabled = true): VisualsBandData | null {
    const channel = useVisualsStore((s) => s.channel);
    const focus = useVisualsStore((s) => s.focus);
    const focusIds = useVisualsStore((s) => s.focusMarcherIds);
    const { data: cues } = useQuery(allCuesQueryOptions());
    const { data: marchers } = useQuery(allMarchersQueryOptions());
    const { data: byTag } = useQuery(marcherIdsForAllTagIdsQueryOptions());
    const { beats } = useTimingObjects();
    const stored = useStoredCues();
    const defaults = useShowPerformerDefaults();
    const { selectedMarchers } = useSelectedMarchers()!;

    const counts = useMemo(() => countIndex(beats), [beats]);
    const compiled = useMemo(() => {
        if (!enabled || !marchers || !stored) return null;
        const duration = new Map(beats.map((b) => [b.id, b.duration]));
        return compileCues({
            beats: counts.beatIdOfCount.map((id) => ({
                id,
                duration: duration.get(id)!,
            })),
            marchers: marchers.map((m, i) => ({
                id: m.id,
                section: m.section,
                tagIds: [...(stored.tagIds.get(m.id) ?? [])],
                drillOrder: i,
                carries: sectionCarries(m.section),
            })),
            cues: stored.cues,
            phraseAssets: stored.phraseAssets,
            showDefaults: { stepOffFoot: defaults.stepOffFoot },
        });
    }, [enabled, marchers, stored, counts, beats, defaults.stepOffFoot]);

    return useMemo(() => {
        if (!focus || !focusIds || !marchers || !cues || !compiled) return null;
        const target = targetOfWho(
            focus,
            selectedMarchers.map((m) => m.id),
        );
        const lanes = visualsLanes({
            cues,
            channel,
            target,
            focusIds,
            marchers,
            marcherIdsByTagId: byTag ?? NO_TAGS,
            counts,
        });
        const focused = marchers.filter((m) => focusIds.has(m.id));
        return {
            channel,
            focus,
            target,
            lanes,
            result: resultRow({
                compiled,
                channel,
                focusIds,
                countCount: counts.beatIdOfCount.length,
                lanes,
            }),
            counts,
            compiled,
            carries: [
                ...new Set(focused.map((m) => sectionCarries(m.section))),
            ],
            marcherCount: focused.length,
        };
    }, [
        focus,
        focusIds,
        marchers,
        cues,
        compiled,
        selectedMarchers,
        channel,
        byTag,
        counts,
    ]);
}
