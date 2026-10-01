import { useEffect, useMemo, useState } from "react";
import { asc } from "drizzle-orm";
import { schema } from "@/global/database/db";
import { withTimelineWriteLock } from "@/db-functions/history";
import type { DbConnection, DbTransaction } from "@/db-functions/types";
import type { TimelineInput } from "@/components/timeline/Timeline";
import { assignmentFromRow } from "./timelineRows";
import { resolverSpans, useTimelineResolverStore } from "./timelineStore";
import {
    buildTimelineTracks,
    type TimelineTrackFilter,
    type TimelineViewTables,
} from "./timelineViewModel";

/**
 * Reads the rows the view-model adapter needs. Call it where no timeline write can commit between
 * its reads, such as inside the write lock.
 */
export async function readTimelineViewTables(
    db: DbConnection | DbTransaction,
): Promise<TimelineViewTables> {
    const timelines = await db.select().from(schema.timelines).all();
    const transitions = await db
        .select()
        .from(schema.timeline_transitions)
        .all();
    const assignments = await db
        .select()
        .from(schema.timeline_assignments)
        .orderBy(asc(schema.timeline_assignments.id))
        .all();
    const shapes = await db
        .select({
            id: schema.timeline_shapes.id,
            name: schema.timeline_shapes.name,
        })
        .from(schema.timeline_shapes)
        .all();
    const marchers = await db
        .select({
            id: schema.marchers.id,
            drill_prefix: schema.marchers.drill_prefix,
            drill_order: schema.marchers.drill_order,
        })
        .from(schema.marchers)
        .all();
    return {
        timelines: timelines.map((t) => ({
            id: t.id,
            name: t.name,
            start: t.start_beat,
            end: t.end_beat,
        })),
        transitions: transitions.map((t) => ({
            id: t.id,
            timelineId: t.timeline_id,
            destShapeId: t.dest_shape_id,
            slotCount: t.slot_count,
            start: t.start_beat,
            end: t.end_beat,
        })),
        assignments: assignments.map(assignmentFromRow),
        shapes,
        marchers: marchers.map((m) => ({
            id: m.id,
            label: `${m.drill_prefix}${m.drill_order}`,
        })),
    };
}

const NO_TRACKS: readonly TimelineInput[] = [];

/**
 * The timeline's tracks for the open file (P8.8): the view-model adapter over the stored tables
 * and the resolver. It rebuilds whenever the resolver store's version changes, which every
 * committed timeline edit, undo, redo and cold build bumps. With `enabled` false (the timeline dev
 * flag off), or before the resolver is ready, it reads nothing and returns no tracks.
 *
 * @param selectedMarcherIds the selection, whose marcher tracks show by default (U-Q1). Pass a
 *        stable set: a new one rebuilds the tracks.
 */
export function useTimelineTracks({
    database,
    enabled,
    selectedMarcherIds,
}: {
    database: DbConnection;
    enabled: boolean;
    selectedMarcherIds: ReadonlySet<number>;
}): readonly TimelineInput[] {
    const resolver = useTimelineResolverStore((s) => s.resolver);
    const version = useTimelineResolverStore((s) => s.version);
    const active = enabled && resolver !== null;

    // The rows as of the latest version. The last ones stay while the next version's load, so the
    // tracks don't flicker.
    const [tables, setTables] = useState<TimelineViewTables | null>(null);
    useEffect(() => {
        if (!active) {
            setTables(null);
            return;
        }
        let current = true;
        withTimelineWriteLock(() => readTimelineViewTables(database)).then(
            (read) => {
                if (current) setTables(read);
            },
            (error: unknown) =>
                console.error("Couldn't read the timeline's tracks", error),
        );
        return () => {
            current = false;
        };
    }, [active, database, version]);

    return useMemo(() => {
        void version; // the resolver answers differently after each version
        if (!active || !resolver || !tables) return NO_TRACKS;
        const filter: TimelineTrackFilter = {
            kind: "default",
            selectedMarcherIds,
        };
        return buildTimelineTracks(
            {
                tables,
                spansOf: (marcherId) => resolverSpans(resolver, marcherId),
                diagnostics: resolver.diagnostics(),
            },
            filter,
        );
    }, [active, resolver, tables, version, selectedMarcherIds]);
}
