import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    allMarchersQueryOptions,
    allSectionAppearancesQueryOptions,
    allTagAppearancesQueryOptions,
    fieldPropertiesQueryOptions,
    marcherIdsForAllTagIdsQueryOptions,
    tagAppearanceByPageIdMapQueryOptions,
} from "@/hooks/queries";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { dbToMarcherAppearanceTimelines } from "@/services/appearance/db-to-timeline";
import type { MarcherAppearanceTimeline } from "@/services/appearance/type";

/**
 * Every marcher's appearance timeline for the whole show (`dbToMarcherAppearanceTimelines`), or
 * `undefined` until its queries load. Rebuilt when the pages, tags, sections or theme change.
 */
export function useMarcherAppearanceTimelines(
    enabled: boolean,
): Map<number, MarcherAppearanceTimeline> | undefined {
    const { pages } = useTimingObjects();
    const { data: marchers } = useQuery({
        ...allMarchersQueryOptions(),
        enabled,
    });
    const { data: sectionAppearances } = useQuery({
        ...allSectionAppearancesQueryOptions(),
        enabled,
    });
    const { data: tagAppearances } = useQuery({
        ...allTagAppearancesQueryOptions(),
        enabled,
    });
    const { data: marcherIdsByTagId } = useQuery({
        ...marcherIdsForAllTagIdsQueryOptions(),
        enabled,
    });
    const { data: tagAppearanceIdsByPageId } = useQuery({
        ...tagAppearanceByPageIdMapQueryOptions(),
        enabled,
    });
    const { data: fieldProperties } = useQuery({
        ...fieldPropertiesQueryOptions(),
        enabled,
    });
    return useMemo(() => {
        if (
            !enabled ||
            !marchers ||
            !sectionAppearances ||
            !tagAppearances ||
            !marcherIdsByTagId ||
            !tagAppearanceIdsByPageId ||
            !fieldProperties
        )
            return undefined;
        return dbToMarcherAppearanceTimelines({
            pages,
            marchers,
            sectionAppearances,
            marcherIdsByTagId,
            tagAppearances,
            tagAppearanceIdsByPageId,
            fieldProperties,
        });
    }, [
        enabled,
        pages,
        marchers,
        sectionAppearances,
        tagAppearances,
        marcherIdsByTagId,
        tagAppearanceIdsByPageId,
        fieldProperties,
    ]);
}
