/**
 * The show's props as the 3D View stands them (C4.5): each prop's surface type, Outline changes
 * and Placement changes, beats as ordinals (their place among the beats by position), as the
 * timeline resolver and `readPutDownItems` count them.
 */
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import type { PlacementChange, PutDownItem } from "@openmarch/core";
import type { DatabaseBeat } from "@/db-functions";
import type { DatabaseItem, DatabaseItemGeometry } from "@/db-functions/items";
import { allDatabaseBeatsQueryOptions } from "@/hooks/queries/useBeats";
import {
    allItemsQueryOptions,
    itemGeometryQueryOptions,
} from "@/hooks/queries/useItems";
import { putDownItemsQueryOptions } from "@/hooks/queries/usePutDownItems";
import {
    itemOutlineChanges,
    type ItemOutlineChanges,
} from "@/items/itemOutlineTimeline";
import type { PropInput } from "@/view3d/core/props/propLayout";

export type ShowPropsReturn = {
    props: PropInput[];
    isLoading: boolean;
    hasError: boolean;
};

const NO_PROPS: PropInput[] = [];

/**
 * The props among the items (equipment is the Carry and Placement layers'), with their Outline
 * changes by marchers row and their Placement changes.
 */
export function propInputs<
    T extends Pick<DatabaseItem, "id" | "marcher_id" | "kind" | "surface_type">,
>(
    items: readonly T[],
    outlines: ItemOutlineChanges,
    placementsOf: (item: T) => readonly PlacementChange[],
): PropInput[] {
    return items.flatMap((item) =>
        item.kind === "prop" && item.surface_type
            ? [
                  {
                      id: item.marcher_id,
                      surface: item.surface_type,
                      changes: outlines.get(item.marcher_id) ?? [],
                      placements: placementsOf(item),
                  },
              ]
            : [],
    );
}

export const _combineShowPropsQueries = (
    results: [
        UseQueryResult<
            Pick<DatabaseItem, "id" | "marcher_id" | "kind" | "surface_type">[]
        >,
        UseQueryResult<DatabaseItemGeometry[]>,
        UseQueryResult<PutDownItem[]>,
        UseQueryResult<Pick<DatabaseBeat, "id" | "position">[]>,
    ],
): ShowPropsReturn => {
    const [items, geometry, placements, beats] = results;
    const isLoading = results.some((r) => r.isLoading);
    const hasError = results.some((r) => r.isError);
    if (
        isLoading ||
        hasError ||
        !items.data ||
        !geometry.data ||
        !placements.data ||
        !beats.data
    )
        return { props: NO_PROPS, isLoading, hasError };

    const ordered = [...beats.data].sort(
        (a, b) => a.position - b.position || a.id - b.id,
    );
    const changes = itemOutlineChanges({
        items: items.data,
        geometry: geometry.data,
        beatIndexes: new Map(ordered.map((b, i) => [b.id, i])),
    });
    const placementsOf = new Map(
        placements.data.map((p) => [p.marcherId, p.changes]),
    );
    return {
        props: propInputs(
            items.data,
            changes,
            (item) => placementsOf.get(item.marcher_id) ?? [],
        ),
        isLoading: false,
        hasError: false,
    };
};

/** The show's props, for the 3D View window. */
export function useShowProps(): ShowPropsReturn {
    return useQueries({
        queries: [
            allItemsQueryOptions(),
            itemGeometryQueryOptions(),
            putDownItemsQueryOptions(),
            allDatabaseBeatsQueryOptions(),
        ],
        combine: _combineShowPropsQueries,
    });
}
