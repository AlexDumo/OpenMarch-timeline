/**
 * The show's checks, live (ADR 0002 D-22, C2.6): items and their Placement from the database,
 * positions and put-downs from the timeline resolver store, the cue compiler's notes and Carry
 * hands (`useShowCueChecks`), through the pure producers in
 * `notes/showNotes.ts`. Recomputes on every resolver version, so a drill edit raises or clears a
 * note at once. The crew checks look only at motion breaks (moves' ends, put-downs), so a long
 * show with many props stays cheap (see the benchmark in `showNotes.test.ts`).
 */
import { useMemo } from "react";
import {
    mutationOptions,
    queryOptions,
    useQueries,
    type UseQueryResult,
} from "@tanstack/react-query";
import type {
    CarryChange,
    CueNote,
    FieldProperties,
    PutDownResolver,
    Resolver,
    XY,
} from "@openmarch/core";
import { db, schema } from "@/global/database/db";
import {
    getItemPlacements,
    snapItemToHolder,
    toPlacementChanges,
    type DatabaseItemPlacement,
} from "@/db-functions";
import { asc } from "drizzle-orm";
import type Marcher from "@/global/classes/Marcher";
import {
    warnPropMovesWithoutCrewOf,
    type WorkspaceSettings,
} from "@/settings/workspaceSettings";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { conToastError } from "@/utilities/utils";
import { itemOutlineChanges } from "@/items/itemOutlineTimeline";
import { PIXELS_PER_METER } from "@/items/itemOutlines";
import type { DatabaseItemGeometry } from "@/db-functions/items";
import { platformNotes } from "@/notes/platformNotes";
import { propInputs } from "./useShowProps";
import {
    cueNotes,
    CREW_REACH_STEPS,
    itemNotes,
    sortShowNotes,
    type NoteItem,
    type ShowNote,
} from "@/notes/showNotes";
import { allMarchersQueryOptions } from "./queries/useMarchers";
import {
    allItemsQueryOptions,
    itemGeometryQueryOptions,
} from "./queries/useItems";
import { workspaceSettingsQueryOptions } from "./queries/useWorkspaceSettings";
import { fieldPropertiesQueryOptions } from "./queries/useFieldProperties";
import { useShowCueChecks, type ShowCueChecks } from "./useShowCueChecks";

type ItemRow = Awaited<
    ReturnType<NonNullable<ReturnType<typeof allItemsQueryOptions>["queryFn"]>>
>[number];

/** Under the tables' own keys, so their edits and undo invalidate these (`queries/utils.ts`) */
export const showNotesKeys = {
    placements: () => ["item_placements", "notes"] as const,
    beatOrder: () => ["beats", "notes_beat_order"] as const,
};

const placementsQueryOptions = () =>
    queryOptions({
        queryKey: showNotesKeys.placements(),
        queryFn: () => getItemPlacements({ db }),
    });

/** The beats in position order: a beat's ordinal is its index. A plain read, no transaction. */
type BeatOrder = { beatIds: number[] };

const beatOrderQueryOptions = () =>
    queryOptions({
        queryKey: showNotesKeys.beatOrder(),
        queryFn: async (): Promise<BeatOrder> => ({
            beatIds: (
                await db
                    .select({ id: schema.beats.id })
                    .from(schema.beats)
                    .orderBy(asc(schema.beats.position), asc(schema.beats.id))
                    .all()
            ).map((b) => b.id),
        }),
    });

/** What the checks read from the database. */
export interface ShowNotesData {
    items: readonly ItemRow[];
    placements: readonly DatabaseItemPlacement[];
    grid: BeatOrder;
    marchers: readonly Marcher[];
    settings: WorkspaceSettings | undefined;
    fieldProperties: FieldProperties | undefined;
    /** The items' Outline changes, for the platform and obstacle checks; none until loaded */
    geometry?: readonly DatabaseItemGeometry[];
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
        UseQueryResult<BeatOrder>,
        UseQueryResult<Marcher[]>,
        UseQueryResult<WorkspaceSettings>,
        UseQueryResult<FieldProperties>,
        UseQueryResult<DatabaseItemGeometry[]>,
    ],
): ShowNotesQueries => {
    const [items, placements, grid, marchers, settings, field, geometry] =
        results;
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
            geometry: geometry?.data,
        },
        isLoading,
        hasError,
    };
};

export interface ShowNotes {
    notes: ShowNote[];
    /** An item's name, as the list shows it */
    itemName: (itemId: number) => string;
    /** An item's `marchers` row, which the field selects */
    itemMarcherId: (itemId: number) => number | undefined;
    /** A performer's name or drill number */
    marcherName: (marcherId: number) => string;
    isLoading: boolean;
}

/**
 * What the checks read from the resolver: positions with put-downs, and without (`base`). A
 * resolver without put-downs (`createResolver`) has none.
 */
export type ShowNotesResolver = Pick<
    Resolver,
    "positionAt" | "spanInfos" | "marcherIds"
> &
    Partial<Pick<PutDownResolver, "putDownAnchors" | "base">>;

/** What the checks read besides the database and positions. */
export interface ShowNotesExtras {
    cues?: ShowCueChecks | null;
}

const label = (m: Pick<Marcher, "name" | "drill_number"> | undefined) =>
    m ? m.name || m.drill_number : "";

/** The platform and obstacle checks, from the props' Outlines and Placement (C4.5). */
function platformNotesFrom(
    data: ShowNotesData,
    changesByItem: ReturnType<typeof toPlacementChanges>,
    ordinal: ReadonlyMap<number, number>,
    positionAt: (marcherId: number, beat: number) => XY | null,
): ShowNote[] {
    const outlines = itemOutlineChanges({
        items: data.items,
        geometry: data.geometry ?? [],
        beatIndexes: ordinal,
    });
    const itemIdOf = new Map(data.items.map((i) => [i.marcher_id, i.id]));
    return platformNotes({
        props: propInputs(
            data.items,
            outlines,
            (item) => changesByItem.get(item.id) ?? [],
        ),
        itemIdOf: (marcherId) => itemIdOf.get(marcherId) ?? -1,
        performers: data.marchers
            .map((m) => m.id)
            .filter((id) => !itemIdOf.has(id)),
        beatCount: data.grid.beatIds.length,
        positionAt,
        unitsPerMeter: PIXELS_PER_METER,
    });
}

/** The checks from the data, a resolver and the extras. */
export function showNotesFrom(
    data: ShowNotesData,
    resolver: ShowNotesResolver,
    extras: ShowNotesExtras = {},
): Omit<ShowNotes, "isLoading"> {
    const ordinal = new Map(data.grid.beatIds.map((id, i) => [id, i]));
    const ids = new Set(resolver.marcherIds());
    const base = resolver.base ?? resolver;
    const anchorsOf = (id: number) =>
        ids.has(id) ? (resolver.putDownAnchors?.(id) ?? []) : [];
    const known =
        (read: (id: number, beat: number) => XY) =>
        (id: number, beat: number): XY | null =>
            ids.has(id) ? read(id, beat) : null;
    const items: NoteItem[] = data.items.map((i) => ({
        id: i.id,
        marcherId: i.marcher_id,
        kind: i.kind as NoteItem["kind"],
    }));
    const breaks = new Map<number, number[]>();
    const breaksOf = (id: number) => {
        let list = breaks.get(id);
        if (list) return list;
        list = [];
        if (ids.has(id)) {
            for (const s of resolver.spanInfos(id))
                if (s.kind !== "hold") list.push(s.start, s.end);
            for (const a of anchorsOf(id)) list.push(a.beat);
        }
        breaks.set(id, list);
        return list;
    };
    const carries: CarryChange[] = (extras.cues?.carries ?? []).flatMap((c) => {
        const beat = ordinal.get(c.beatId);
        return beat === undefined
            ? []
            : [{ marcherId: c.marcherId, beat, hands: c.hands }];
    });
    const cueBeat = (cueId: number) => {
        const beatId = extras.cues?.cueBeatId.get(cueId);
        return beatId === undefined ? null : (ordinal.get(beatId) ?? null);
    };
    const changesByItem = toPlacementChanges(data.placements, ordinal);
    const notes = sortShowNotes([
        ...itemNotes({
            items,
            changesByItem,
            beatCount: data.grid.beatIds.length,
            positionAt: known((id, beat) => resolver.positionAt(id, beat)),
            basePositionAt: known((id, beat) => base.positionAt(id, beat)),
            breaksOf,
            putDownsOf: anchorsOf,
            carries,
            crewReach:
                CREW_REACH_STEPS * (data.fieldProperties?.pixelsPerStep ?? 12),
            warnPropMovesWithoutCrew: warnPropMovesWithoutCrewOf(data.settings),
        }),
        ...platformNotesFrom(data, changesByItem, ordinal, (id, beat) =>
            ids.has(id) ? resolver.positionAt(id, beat) : null,
        ),
        ...cueNotes(extras.cues?.notes ?? ([] as CueNote[]), cueBeat),
    ]);
    const marchers = new Map(data.marchers.map((m) => [m.id, m]));
    const itemRows = new Map(data.items.map((i) => [i.id, i]));
    return {
        notes,
        itemName: (itemId) => {
            const m = itemRows.get(itemId)?.marcher;
            return m ? m.name || `${m.drill_prefix}${m.drill_order}` : "";
        },
        itemMarcherId: (itemId) => itemRows.get(itemId)?.marcher_id,
        marcherName: (marcherId) => label(marchers.get(marcherId)),
    };
}

const noNotes: ShowNote[] = [];

/**
 * The show's checks over `resolver`, recomputed when `version` changes. Empty until the data and
 * the resolver are ready.
 */
export function useShowNotesWith(
    resolver: ShowNotesResolver | null,
    version: unknown,
): ShowNotes {
    const queries = useQueries({
        queries: [
            allItemsQueryOptions(),
            placementsQueryOptions(),
            beatOrderQueryOptions(),
            allMarchersQueryOptions(),
            workspaceSettingsQueryOptions(),
            fieldPropertiesQueryOptions(),
            itemGeometryQueryOptions(),
        ],
        combine: _combineShowNotesQueries,
    });
    const cues = useShowCueChecks();
    return useMemo(() => {
        void version; // a new version means new positions
        if (!queries.data || !resolver)
            return {
                notes: noNotes,
                itemName: () => "",
                itemMarcherId: () => undefined,
                marcherName: () => "",
                isLoading: queries.isLoading,
            };
        return {
            ...showNotesFrom(queries.data, resolver, { cues }),
            isLoading: queries.isLoading,
        };
    }, [queries.data, queries.isLoading, resolver, version, cues]);
}

/** The show's checks over the editor's resolver store. */
export function useShowNotes(): ShowNotes {
    const resolver = useTimelineResolverStore((s) => s.resolver);
    const version = useTimelineResolverStore((s) => s.version);
    return useShowNotesWith(resolver, version);
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
