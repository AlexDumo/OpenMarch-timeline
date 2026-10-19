/**
 * What the show checks (`showNotes.ts`) need from the cues: the cue compiler's notes
 * (`carry_mismatch`, `silk_aspect`) and what Carry cues give performers, as hands in use for hand
 * conflicts. The show is compiled as the 3D View compiles it (`compileWindowCues`), with the
 * show's Silk Artwork Versions and each flag section's Cut (`view3d/library/cueAspects`), so the
 * notes match the window's. It calls `compileCues` itself, as `compileWindowCues` does, since the
 * window's module pulls three.js into the editor's first chunk.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    carryHands,
    compileCues,
    cueValueLookup,
    type CarryChange,
    type CompiledCues,
    type CueNote,
} from "@openmarch/core";
import { allMarchersQueryOptions } from "@/hooks/queries/useMarchers";
import { showLibraryItemsQueryOptions } from "@/hooks/queries/useShowLibrary";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import {
    useShowPerformerDefaults,
    useStoredCues,
} from "@/view3d/window/performers/useStoredCues";
import { sectionCueCarry } from "@/view3d/core/marchers/hornChannel";
import { carryForSection } from "@/view3d/core/instruments/catalog";
import { cueLibraryItemsOf, cueSectionsOf } from "@/view3d/library/cueAspects";

export interface ShowCueChecks {
    notes: readonly CueNote[];
    /** Each cue's beat id, to place its notes */
    cueBeatId: ReadonlyMap<number, number>;
    /** What Carry cues give, by beat id (`CarryChange.beat` is filled in by the caller) */
    carries: readonly (Omit<CarryChange, "beat"> & { beatId: number })[];
}

/**
 * Each performer's Carry changes from the compile: what a Carry cue gives takes hands from its
 * count on; where no cue gives anything (the default), the hands are free.
 */
export function carryChangesOf(
    compiled: CompiledCues,
    marchers: readonly { id: number; section: string }[],
    countBeatIds: readonly number[],
    lookup: ReturnType<typeof cueValueLookup>,
): ShowCueChecks["carries"] {
    const out: (Omit<CarryChange, "beat"> & { beatId: number })[] = [];
    for (const m of marchers) {
        const usual = sectionCueCarry(m.section);
        let last: string | null = null;
        for (const seg of compiled.segments(m.id, "carry")) {
            const beatId = countBeatIds[seg.from];
            if (beatId === undefined || seg.to <= seg.from) continue;
            const hands =
                seg.cueId === null || seg.value === null || seg.value === "none"
                    ? null
                    : carryHands(lookup(seg.value)?.holds ?? usual);
            const key = `${hands}`;
            if (key === last) continue;
            last = key;
            out.push({ marcherId: m.id, beatId, hands });
        }
    }
    return out;
}

/** The show's cue checks, or null while the show loads. */
export function useShowCueChecks(): ShowCueChecks | null {
    const { data: marchers } = useQuery(allMarchersQueryOptions());
    const { data: showLibrary } = useQuery(showLibraryItemsQueryOptions());
    const { beats } = useTimingObjects();
    const stored = useStoredCues();
    const defaults = useShowPerformerDefaults();
    return useMemo(() => {
        if (!marchers || !stored) return null;
        const libraryItems = cueLibraryItemsOf(showLibrary ?? []);
        const sections = cueSectionsOf(
            marchers.map((m) => ({
                section: m.section,
                family: carryForSection(m.section)?.family ?? null,
            })),
        );
        // The compile's counts are the timed beats in order
        const timed = beats
            .filter((b) => b.duration > 0)
            .sort((a, b) => a.timestamp - b.timestamp);
        const countBeatIds = timed.map((b) => b.id);
        const compiled = compileCues({
            beats: timed.map((b) => ({ id: b.id, duration: b.duration })),
            marchers: marchers.map((m, i) => ({
                id: m.id,
                section: m.section,
                tagIds: [...(stored.tagIds.get(m.id) ?? [])],
                drillOrder: i,
                carries: sectionCueCarry(m.section),
            })),
            cues: stored.cues,
            phraseAssets: stored.phraseAssets,
            libraryItems,
            sections,
            showDefaults: { stepOffFoot: defaults.stepOffFoot },
        });
        const lookup = cueValueLookup(
            stored.phraseAssets,
            { stepOffFoot: defaults.stepOffFoot },
            libraryItems,
        );
        return {
            notes: compiled.notes,
            cueBeatId: new Map(stored.cues.map((c) => [c.id, c.beatId])),
            carries: carryChangesOf(compiled, marchers, countBeatIds, lookup),
        };
    }, [marchers, showLibrary, beats, stored, defaults]);
}
