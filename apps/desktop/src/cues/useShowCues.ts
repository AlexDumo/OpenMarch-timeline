import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { allCuesQueryOptions } from "@/hooks/queries/useCues";
import { allMarchersQueryOptions } from "@/hooks/queries/useMarchers";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { useDatabaseReady } from "@/hooks/useDatabaseReady";
import type { DatabaseCue } from "@/db-functions/cues";
import type Marcher from "@/global/classes/Marcher";
import type { CueValue } from "@openmarch/core";
import { useShowFlags } from "@/hooks/queries/useShowFlags";
import { flagCueValues, type ShowFlag } from "@/showAssets/flags";
import { compileShowCues, type ShowCues } from "./showCues";

export interface EditorCues extends ShowCues {
    /** The stored cues, in id order. */
    readonly cues: readonly DatabaseCue[];
    /** The show's performers. */
    readonly marchers: readonly Marcher[];
    /** The show's flags (fork #985), which Equipment cues hand out like catalog items */
    readonly flags: readonly ShowFlag[];
    /** The values the show adds to the cue library (its flags'), for compiles of a changed show */
    readonly values: readonly CueValue[];
}

const NO_CUES: readonly DatabaseCue[] = [];

/**
 * The show's cues compiled in the editor (`compileShowCues`), or null until the cues, performers
 * and beats have loaded. A file without the cue tables reads as no cues. Compiled again only when
 * one of those changes.
 */
export function useShowCues(): EditorCues | null {
    const ready = useDatabaseReady();
    const cuesQuery = useQuery({ ...allCuesQueryOptions(), enabled: ready });
    const { data: marchers } = useQuery({
        ...allMarchersQueryOptions(),
        enabled: ready,
    });
    const beats = useTimingObjects()?.beats;
    const flags = useShowFlags(ready);
    const cues = cuesQuery.isError ? NO_CUES : cuesQuery.data;
    return useMemo(() => {
        if (!cues || !marchers || !beats) return null;
        const values = flagCueValues(flags);
        return {
            ...compileShowCues(marchers, beats, cues, values),
            cues,
            marchers,
            flags,
            values,
        };
    }, [cues, marchers, beats, flags]);
}
