import { useEffect, useMemo } from "react";
import { create } from "zustand";
import type { DbConnection } from "@/db-functions/types";
import { useTimelineDisplayStore } from "@/db-functions/timelineDisplay";
import { readKeptAssignmentIds } from "@/db-functions/timelineKeptMarkers";
import { pageKeepStates, type PageKeepState } from "./timelineKeepLater";
import { pageFlags, type FlagPage } from "./timelinePlayhead";
import { resolverSpans, useTimelineResolverStore } from "./timelineStore";

/**
 * The stored kept markers (`timeline_kept_assignments`) as the renderer sees them, for the keep
 * later pages UI (`timelineKeepLater.ts`). Read by `useKeptAssignmentsHost` after every committed
 * edit, undo or redo that may have changed them: the markers aren't in the change log, so it
 * follows the resolver's version (a kept move's rows) and the display version (the markers).
 */
export const useKeptAssignmentsStore = create<{ ids: ReadonlySet<number> }>(
    () => ({ ids: new Set() }),
);

let reads = 0;

/** Reads the kept markers again into `useKeptAssignmentsStore`; a late older read is dropped. */
export async function refreshKeptAssignments(
    database: DbConnection,
): Promise<void> {
    const read = ++reads;
    try {
        const ids = await readKeptAssignmentIds(database);
        if (read === reads) useKeptAssignmentsStore.setState({ ids });
    } catch (error) {
        console.error("Couldn't read the kept spots", error);
    }
}

/**
 * Keeps `useKeptAssignmentsStore` current while `enabled` (timeline mode): one read per resolver
 * or display version. Mounted once, by `TimelineResolverHost`.
 */
export function useKeptAssignmentsHost(
    database: DbConnection,
    enabled: boolean,
): void {
    const version = useTimelineResolverStore((s) => s.version);
    const display = useTimelineDisplayStore((s) => s.version);
    useEffect(() => {
        if (!enabled) {
            reads++;
            useKeptAssignmentsStore.setState({ ids: new Set() });
            return;
        }
        void refreshKeptAssignments(database);
    }, [database, enabled, version, display]);
}

type NamedPage = FlagPage & { readonly name: string };

/** Every page as `pageKeepStates` takes it, in show order. */
export const keepPagesOf = (pages: readonly NamedPage[]) =>
    pageFlags(pages).map((f) => ({
        id: f.page.id,
        name: f.page.name,
        flag: f.flag,
        range: f.range,
    }));

/**
 * The selection's keep state on every page box (`pageKeepStates`), from the resolver's spans and
 * the kept markers. Empty without a selection or a resolver.
 *
 * @param marcherIds the selected marchers; keep the array stable while the selection is
 */
export function usePageKeepStates(
    pages: readonly NamedPage[],
    marcherIds: readonly number[],
): PageKeepState[] {
    const resolver = useTimelineResolverStore((s) => s.resolver);
    const version = useTimelineResolverStore((s) => s.version);
    const kept = useKeptAssignmentsStore((s) => s.ids);
    return useMemo(() => {
        void version; // a new version means new spans
        if (!resolver || marcherIds.length === 0) return [];
        return pageKeepStates({
            pages: keepPagesOf(pages),
            marcherIds,
            spansOf: (id) => resolverSpans(resolver, id),
            kept,
        });
    }, [resolver, version, kept, pages, marcherIds]);
}
