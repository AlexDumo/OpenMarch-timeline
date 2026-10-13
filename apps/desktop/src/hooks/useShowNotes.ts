/**
 * The show's notes, live (C2.6): items, their Placement and the page grid from the database, and
 * positions from the timeline resolver store, through the pure `collectShowNotes`. Recomputes on
 * every resolver version, so a drill edit raises or clears a put-down or crew note at once.
 */
import { useMemo } from "react";
import {
    mutationOptions,
    queryOptions,
    useQueries,
    type UseQueryResult,
} from "@tanstack/react-query";
import type { FieldProperties, XY } from "@openmarch/core";
import { db } from "@/global/database/db";
import {
    getItemPlacements,
    getItems,
    snapItemToHolder,
    toPlacementChanges,
    type DatabaseItemPlacement,
} from "@/db-functions";
import { readPageGrid, type PageGrid } from "@/db-functions/timelineRipple";
import type Marcher from "@/global/classes/Marcher";
import {
    warnPropMovesWithoutCrewOf,
    type WorkspaceSettings,
} from "@/settings/workspaceSettings";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { conToastError } from "@/utilities/utils";
import {
    collectShowNotes,
    CREW_REACH_STEPS,
    type NoteItem,
    type NotePage,
    type ShowNote,
} from "@/notes/showNotes";
import { allMarchersQueryOptions } from "./queries/useMarchers";
import { workspaceSettingsQueryOptions } from "./queries/useWorkspaceSettings";
import { fieldPropertiesQueryOptions } from "./queries/useFieldProperties";

type ItemRow = Awaited<ReturnType<typeof getItems>>[number];

/** Under the tables' own keys, so their edits and undo invalidate these (`queries/utils.ts`) */
export const showNotesKeys = {
    items: () => ["items", "notes"] as const,
    placements: () => ["item_placements", "notes"] as const,
    pageGrid: () => ["beats", "notes_page_grid"] as const,
};

const itemsQueryOptions = () =>
    queryOptions({
        queryKey: showNotesKeys.items(),
        queryFn: () => getItems({ db }),
    });

const placementsQueryOptions = () =>
    queryOptions({
        queryKey: showNotesKeys.placements(),
        queryFn: () => getItemPlacements({ db }),
    });

const pageGridQueryOptions = () =>
    queryOptions({
        queryKey: showNotesKeys.pageGrid(),
        queryFn: () => db.transaction((tx) => readPageGrid(tx)),
    });

/** What the notes read, short of positions. */
export interface ShowNotesData {
    items: ItemRow[];
    placements: DatabaseItemPlacement[];
    grid: PageGrid;
    marchers: Marcher[];
    settings: WorkspaceSettings | undefined;
    fieldProperties: FieldProperties | undefined;
}

export type ShowNotesQueries = {
    data: ShowNotesData | null;
    isLoading: boolean;
    hasError: boolean;
};

export const _combineShowNotesQueries = (
    results: [
        UseQueryResult<ItemRow[]>,
        UseQueryResult<DatabaseItemPlacement[]>,
        UseQueryResult<PageGrid>,
        UseQueryResult<Marcher[]>,
        UseQueryResult<WorkspaceSettings>,
        UseQueryResult<FieldProperties>,
    ],
): ShowNotesQueries => {
    const [items, placements, grid, marchers, settings, field] = results;
    const isLoading = results.some((r) => r.isLoading);
    const hasError = results.some((r) => r.isError);
    if (!items.data || !placements.data || !grid.data || !marchers.data)
        return { data: null, isLoading, hasError };
    return {
        data: {
            items: items.data,
            placements: placements.data,
            grid: grid.data,
            marchers: marchers.data,
            settings: settings.data,
            fieldProperties: field.data,
        },
        isLoading,
        hasError,
    };
};

export interface ShowNotes {
    notes: ShowNote[];
    /** The pages, to name each note's count (`noteCountAt`) */
    pages: NotePage[];
    /** An item's name, as the list shows it */
    itemName: (itemId: number) => string;
    /** A performer's name or drill number */
    marcherName: (marcherId: number) => string;
    isLoading: boolean;
}

const label = (m: Pick<Marcher, "name" | "drill_number"> | undefined) =>
    m ? m.name || m.drill_number : "";

/** The notes from the data and a resolver's positions. */
export function showNotesFrom(
    data: ShowNotesData,
    positionAt: (marcherId: number, beat: number) => XY | null,
): Omit<ShowNotes, "isLoading"> {
    const ordinal = new Map(data.grid.beatIds.map((id, i) => [id, i]));
    const items: NoteItem[] = data.items.map((i) => ({
        id: i.id,
        marcherId: i.marcher_id,
        kind: i.kind as NoteItem["kind"],
    }));
    const notes = collectShowNotes({
        items,
        changesByItem: toPlacementChanges(data.placements, ordinal),
        beatCount: data.grid.beatIds.length,
        positionAt,
        crewReach:
            CREW_REACH_STEPS * (data.fieldProperties?.pixelsPerStep ?? 12),
        warnPropMovesWithoutCrew: warnPropMovesWithoutCrewOf(data.settings),
    });
    const marchers = new Map(data.marchers.map((m) => [m.id, m]));
    const itemMarcher = new Map(data.items.map((i) => [i.id, i.marcher]));
    return {
        notes,
        pages: data.grid.pages,
        itemName: (itemId) => {
            const m = itemMarcher.get(itemId);
            return m ? m.name || `${m.drill_prefix}${m.drill_order}` : "";
        },
        marcherName: (marcherId) => label(marchers.get(marcherId)),
    };
}

const noNotes: ShowNote[] = [];

/** The show's notes. Empty until the data and the resolver are ready. */
export function useShowNotes(): ShowNotes {
    const queries = useQueries({
        queries: [
            itemsQueryOptions(),
            placementsQueryOptions(),
            pageGridQueryOptions(),
            allMarchersQueryOptions(),
            workspaceSettingsQueryOptions(),
            fieldPropertiesQueryOptions(),
        ],
        combine: _combineShowNotesQueries,
    });
    const resolver = useTimelineResolverStore((s) => s.resolver);
    const version = useTimelineResolverStore((s) => s.version);
    return useMemo(() => {
        void version; // a new version means new positions
        if (!queries.data || !resolver)
            return {
                notes: noNotes,
                pages: [],
                itemName: () => "",
                marcherName: () => "",
                isLoading: queries.isLoading,
            };
        const ids = new Set(resolver.marcherIds());
        return {
            ...showNotesFrom(queries.data, (marcherId, beat) =>
                ids.has(marcherId)
                    ? resolver.positionAt(marcherId, beat)
                    : null,
            ),
            isLoading: queries.isLoading,
        };
    }, [queries.data, queries.isLoading, resolver, version]);
}

/** Snap to holder, the put-down drift note's one-click fix: one undoable edit. */
export const snapItemToHolderMutationOptions = () =>
    mutationOptions({
        mutationFn: (placementId: number) =>
            snapItemToHolder({ db, placementId }),
        // The move is a timeline write: the resolver store follows it, and the notes with it
        onError: (e, placementId) =>
            conToastError(
                "Error snapping an item to its holder",
                e,
                placementId,
            ),
    });
