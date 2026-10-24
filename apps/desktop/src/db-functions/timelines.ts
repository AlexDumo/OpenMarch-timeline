import { and, asc, eq, inArray } from "drizzle-orm";
import * as schema from "@om-electron/database/migrations/schema";
import { DbConnection, DbTransaction } from "./types";
import { mapDbErrors, refuse } from "./timelineErrors";
import {
    deleteTimelineTransitionRowsInTransaction,
    setTimelineRangeInTransaction,
} from "./timelineTransitionsInTransaction";

/** A row of `timelines`. */
export type DatabaseTimeline = typeof schema.timelines.$inferSelect;

export interface NewTimelineArgs {
    name?: string | null;
    startBeat: number;
    endBeat: number;
}

export interface ModifiedTimelineArgs {
    id: number;
    name?: string | null;
    /**
     * A new range moves every transition in the timeline with it, since each spans the timeline
     * (C-11), and their anchored assignments follow (R-E1, `setTimelineRangeInTransaction`).
     */
    startBeat?: number;
    endBeat?: number;
}

/** Every stored timeline with exactly the range `[start, end)`, oldest first. */
export const timelinesWithRange = async (
    tx: DbTransaction,
    { start, end }: { start: number; end: number },
): Promise<DatabaseTimeline[]> =>
    await tx
        .select()
        .from(schema.timelines)
        .where(
            and(
                eq(schema.timelines.start_beat, start),
                eq(schema.timelines.end_beat, end),
            ),
        )
        .orderBy(asc(schema.timelines.id))
        .all();

/**
 * The stored timeline with exactly this range, or undefined. There is at most one (UI-9 One
 * timeline per range); a file from before that rule could hold two, and then the oldest wins.
 */
export const findTimelineByRange = async (
    tx: DbTransaction,
    range: { start: number; end: number },
): Promise<DatabaseTimeline | undefined> =>
    (await timelinesWithRange(tx, range))[0];

/**
 * Creates timelines. At most one timeline has a given range (C-12, UI-9 One timeline per range),
 * so a range that a stored timeline or another new one already has is refused (E-ARGS) before
 * anything is written. Range edits can still make two share a range (the `ui.md` backlog).
 *
 * `allowSharedRanges` skips that check, for loading a spec scenario as written (`ref/` scenarios
 * and golden vectors predate C-12, and the spec itself allows shared ranges).
 */
export const createTimelinesInTransaction = async ({
    newTimelines,
    tx,
    allowSharedRanges = false,
}: {
    newTimelines: NewTimelineArgs[];
    tx: DbTransaction;
    allowSharedRanges?: boolean;
}): Promise<DatabaseTimeline[]> => {
    if (newTimelines.length === 0) return [];
    const seen = new Set<string>();
    for (const t of allowSharedRanges ? [] : newTimelines) {
        const key = `${t.startBeat},${t.endBeat}`;
        const stored = await tx
            .select({ id: schema.timelines.id })
            .from(schema.timelines)
            .where(
                and(
                    eq(schema.timelines.start_beat, t.startBeat),
                    eq(schema.timelines.end_beat, t.endBeat),
                ),
            )
            .get();
        if (stored || seen.has(key))
            refuse(
                `a timeline over beats [${t.startBeat}, ${t.endBeat}) already exists${
                    stored ? ` (timeline ${stored.id})` : ""
                }; there is one timeline per range`,
            );
        seen.add(key);
    }
    return await mapDbErrors(() =>
        tx
            .insert(schema.timelines)
            .values(
                newTimelines.map((t) => ({
                    name: t.name ?? null,
                    start_beat: t.startBeat,
                    end_beat: t.endBeat,
                })),
            )
            .returning(),
    );
};

export const updateTimelinesInTransaction = async ({
    modifiedTimelines,
    tx,
}: {
    modifiedTimelines: ModifiedTimelineArgs[];
    tx: DbTransaction;
}): Promise<DatabaseTimeline[]> => {
    const updated: DatabaseTimeline[] = [];
    for (const m of modifiedTimelines) {
        if (m.startBeat !== undefined || m.endBeat !== undefined) {
            const existing = await tx
                .select()
                .from(schema.timelines)
                .where(eq(schema.timelines.id, m.id))
                .get();
            if (!existing) refuse(`timeline ${m.id} does not exist`);
            await setTimelineRangeInTransaction({
                tx,
                timelineId: m.id,
                start: m.startBeat ?? existing.start_beat,
                end: m.endBeat ?? existing.end_beat,
            });
        }
        const set: Partial<typeof schema.timelines.$inferInsert> = {};
        if (m.name !== undefined) set.name = m.name;
        const row = await mapDbErrors(async () =>
            Object.keys(set).length === 0
                ? await tx
                      .select()
                      .from(schema.timelines)
                      .where(eq(schema.timelines.id, m.id))
                      .get()
                : await tx
                      .update(schema.timelines)
                      .set(set)
                      .where(eq(schema.timelines.id, m.id))
                      .returning()
                      .get(),
        );
        if (!row) refuse(`timeline ${m.id} does not exist`);
        updated.push(row);
    }
    return updated;
};

/**
 * Deletes timelines and everything under them, child first (C-1, P4.6): each timeline's
 * assignments and slot destinations, then its transitions, then the timeline. The foreign keys
 * are RESTRICT, and the history trigger logs rows in deletion order, so deleting a parent first
 * would break undo. Shapes are shared and are left alone. Missing ids are ignored.
 *
 * A timeline in `keep` loses everything under it but its row stays, empty (`oldestOnSharedRange`).
 * It is still returned.
 */
export const deleteTimelinesInTransaction = async ({
    timelineIds,
    tx,
    keep = new Set(),
}: {
    timelineIds: Set<number>;
    tx: DbTransaction;
    keep?: ReadonlySet<number>;
}): Promise<DatabaseTimeline[]> => {
    if (timelineIds.size === 0) return [];
    const ids = [...timelineIds];
    const transitions = await tx
        .select({ id: schema.timeline_transitions.id })
        .from(schema.timeline_transitions)
        .where(inArray(schema.timeline_transitions.timeline_id, ids))
        .all();
    await deleteTimelineTransitionRowsInTransaction({
        transitionIds: new Set(transitions.map((t) => t.id)),
        tx,
    });
    const kept = ids.filter((id) => keep.has(id));
    const gone = ids.filter((id) => !keep.has(id));
    const keptRows =
        kept.length === 0
            ? []
            : await tx
                  .select()
                  .from(schema.timelines)
                  .where(inArray(schema.timelines.id, kept))
                  .all();
    const deleted =
        gone.length === 0
            ? []
            : await mapDbErrors(() =>
                  tx
                      .delete(schema.timelines)
                      .where(inArray(schema.timelines.id, gone))
                      .returning(),
              );
    return [...keptRows, ...deleted];
};

/**
 * Of `timelineIds`, the ones that are the oldest over their range while a newer timeline outside
 * `timelineIds` shares it. On a page's box that oldest is the page's own timeline (UI-25), so
 * deleting it would make a move split off it the page's instead: callers empty it and keep it.
 */
export const oldestOnSharedRange = async (
    tx: DbTransaction,
    timelineIds: Iterable<number>,
): Promise<Set<number>> => {
    const ids = new Set(timelineIds);
    const out = new Set<number>();
    if (ids.size === 0) return out;
    const rows = await tx
        .select()
        .from(schema.timelines)
        .where(inArray(schema.timelines.id, [...ids]))
        .all();
    for (const row of rows) {
        const [oldest, ...newer] = await timelinesWithRange(tx, {
            start: row.start_beat,
            end: row.end_beat,
        });
        if (oldest?.id === row.id && newer.some((t) => !ids.has(t.id)))
            out.add(row.id);
    }
    return out;
};

/** Whether timeline `id` is stored (UI-14: a stale button or field may name one that's gone). */
export const timelineExists = async (
    db: DbConnection | DbTransaction,
    id: number,
): Promise<boolean> =>
    (await db
        .select({ id: schema.timelines.id })
        .from(schema.timelines)
        .where(eq(schema.timelines.id, id))
        .get()) !== undefined;

/** The end beats of the moves `ids`, by id; moves that are gone are left out */
export const readTimelineEndBeats = async (
    db: DbConnection | DbTransaction,
    ids: readonly number[],
): Promise<Map<number, number>> => {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return new Map();
    const rows = await db
        .select({ id: schema.timelines.id, end: schema.timelines.end_beat })
        .from(schema.timelines)
        .where(inArray(schema.timelines.id, wanted))
        .all();
    return new Map(rows.map((r) => [r.id, r.end]));
};
