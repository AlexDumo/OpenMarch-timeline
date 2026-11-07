/**
 * The show's props as the 3D View stands them (C4.5): each prop's surface type and Outline
 * changes, beats as ordinals (their place among the beats by position), as the timeline resolver
 * counts them.
 */
import { useMemo } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import type { DatabaseBeat } from "@/db-functions";
import type { DatabaseItem, DatabaseItemGeometry } from "@/db-functions/items";
import { allDatabaseBeatsQueryOptions } from "@/hooks/queries/useBeats";
import {
    allItemsQueryOptions,
    itemGeometryQueryOptions,
} from "@/hooks/queries/useItems";
import {
    itemOutlineChanges,
    type ItemOutlineChanges,
} from "@/items/itemOutlineTimeline";
import type { PropInput } from "@/view3d/core/props/propLayout";

type ShowPropItem = Pick<
    DatabaseItem,
    "id" | "marcher_id" | "kind" | "surface_type"
>;

export type ShowPropsReturn = {
    props: PropInput[];
    isLoading: boolean;
    hasError: boolean;
};

const NO_PROPS: PropInput[] = [];
const NONE_HIDDEN: ReadonlySet<number> = new Set();

/**
 * The props among the items (equipment is carried, not stood), with their Outline changes by
 * marchers row. A prop hidden on the field in the editor (`hidden`, by item id) is left out: it
 * isn't drawn, so nobody stands on it.
 */
export function propInputs(
    items: readonly ShowPropItem[],
    outlines: ItemOutlineChanges,
    hidden: ReadonlySet<number> = NONE_HIDDEN,
): PropInput[] {
    return items.flatMap((item) =>
        item.kind === "prop" && item.surface_type && !hidden.has(item.id)
            ? [
                  {
                      id: item.marcher_id,
                      surface: item.surface_type,
                      changes: outlines.get(item.marcher_id) ?? [],
                  },
              ]
            : [],
    );
}

/** Every prop with its item id, before the hidden ones are left out. */
type CombinedProps = {
    items: readonly ShowPropItem[];
    outlines: ItemOutlineChanges;
} | null;

export const _combineShowPropsQueries = (
    results: [
        UseQueryResult<ShowPropItem[]>,
        UseQueryResult<DatabaseItemGeometry[]>,
        UseQueryResult<Pick<DatabaseBeat, "id" | "position">[]>,
    ],
): { combined: CombinedProps; isLoading: boolean; hasError: boolean } => {
    const [items, geometry, beats] = results;
    const isLoading = results.some((r) => r.isLoading);
    const hasError = results.some((r) => r.isError);
    if (isLoading || hasError || !items.data || !geometry.data || !beats.data)
        return { combined: null, isLoading, hasError };

    const ordered = [...beats.data].sort(
        (a, b) => a.position - b.position || a.id - b.id,
    );
    const outlines = itemOutlineChanges({
        items: items.data,
        geometry: geometry.data,
        beatIndexes: new Map(ordered.map((b, i) => [b.id, i])),
    });
    return {
        combined: { items: items.data, outlines },
        isLoading: false,
        hasError: false,
    };
};

/**
 * The show's props, for the 3D View window.
 *
 * @param hidden - item ids hidden on the field in the editor
 */
export function useShowProps(
    hidden: ReadonlySet<number> = NONE_HIDDEN,
): ShowPropsReturn {
    const { combined, isLoading, hasError } = useQueries({
        queries: [
            allItemsQueryOptions(),
            itemGeometryQueryOptions(),
            allDatabaseBeatsQueryOptions(),
        ],
        combine: _combineShowPropsQueries,
    });
    const props = useMemo(
        () =>
            combined
                ? propInputs(combined.items, combined.outlines, hidden)
                : NO_PROPS,
        [combined, hidden],
    );
    return { props, isLoading, hasError };
}
