/**
 * Lanes, pathways step 24 (ADR 0015, spec v0.10 J.1 and J.8): a lane binds one slot of one
 * transition to a route, so a path no longer moves marchers out of their move. This module holds
 * what every procedure that touches slots shares:
 *
 * - reads: the lane on a slot, the lanes of transitions or of a route;
 * - **AP-H2** (`refuseLanedRows`): a procedure that would move a laned row to another transition,
 *   or renumber, peel or copy its slot, and can't carry the lane yet, refuses with a reason;
 * - **AP-H3** (`sweepOrphanRoutesInTransaction`): at the end of a procedure that deletes or
 *   re-points lanes or rows, a route none of whose lanes has a marcher goes, with its lanes;
 * - **AP-R3** (`deleteLanesOfTransitionsInTransaction`): a deleted transition's lanes go first;
 * - **AP-R20** (`deleteLanesFromSlotInTransaction`): lanes above a lowered slot count go first;
 * - the file version (11) written with a file's first lane (ADR 0015 §9).
 *
 * Standalone on purpose (schema and drizzle only), so the transition and membership procedures
 * can use it without importing the route procedures.
 */
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { XY } from "@openmarch/core";
import {
    ADJUST_MODEL_USER_VERSION,
    LANE_MODEL_USER_VERSION,
} from "@om-electron/database/fileVersion";
import { schema } from "@/global/database/db";
import type { DbConnection, DbTransaction } from "./types";

/** A row of `timeline_lanes`. */
export type DatabaseTimelineLane = typeof schema.timeline_lanes.$inferSelect;

/** A lane's start offset `o_s`, or null for an own lane (I-LN4). */
export const laneOffset = (lane: DatabaseTimelineLane): XY | null =>
    lane.offset_x === null || lane.offset_y === null
        ? null
        : [lane.offset_x, lane.offset_y];

/** Whether `lane` is a group path's lane (it has an offset). */
export const isGroupLane = (lane: DatabaseTimelineLane): boolean =>
    lane.offset_x !== null;

/** The lane on slot `slot` of transition `transitionId`, if any (I-LN3: at most one). */
export async function laneOn(
    db: DbConnection | DbTransaction,
    transitionId: number,
    slot: number,
): Promise<DatabaseTimelineLane | undefined> {
    const L = schema.timeline_lanes;
    return await db
        .select()
        .from(L)
        .where(and(eq(L.transition_id, transitionId), eq(L.slot_index, slot)))
        .get();
}

/** Every lane on `transitionIds`, by transition then slot. */
export async function lanesOfTransitions(
    db: DbConnection | DbTransaction,
    transitionIds: Iterable<number>,
): Promise<DatabaseTimelineLane[]> {
    const ids = [...new Set(transitionIds)];
    if (ids.length === 0) return [];
    const L = schema.timeline_lanes;
    return await db
        .select()
        .from(L)
        .where(inArray(L.transition_id, ids))
        .orderBy(asc(L.transition_id), asc(L.slot_index))
        .all();
}

/** Every lane of route `routeId`, by id. */
export async function lanesOfRoute(
    db: DbConnection | DbTransaction,
    routeId: number,
): Promise<DatabaseTimelineLane[]> {
    const L = schema.timeline_lanes;
    return await db
        .select()
        .from(L)
        .where(eq(L.route_id, routeId))
        .orderBy(asc(L.id))
        .all();
}

/** `(transition, slot)` as a key. */
export const slotKey = (transitionId: number, slot: number) =>
    `${transitionId}:${slot}`;

/** The keys of the laned slots among `rows`' transitions. */
export async function lanedSlots(
    db: DbConnection | DbTransaction,
    rows: readonly { transition_id: number }[],
): Promise<Set<string>> {
    const lanes = await lanesOfTransitions(
        db,
        rows.map((r) => r.transition_id),
    );
    return new Set(lanes.map((l) => slotKey(l.transition_id, l.slot_index)));
}

/**
 * AP-H2 (refuse half): the first of `rows` whose slot has a lane, or undefined. Callers that can't
 * carry the lane yet refuse with it, naming its marcher (`E-ARGS`, "walks a drawn path").
 */
export async function firstLanedRow<
    R extends { transition_id: number; slot_index: number },
>(
    db: DbConnection | DbTransaction,
    rows: readonly R[],
): Promise<R | undefined> {
    if (rows.length === 0) return undefined;
    const laned = await lanedSlots(db, rows);
    return rows.find((r) => laned.has(slotKey(r.transition_id, r.slot_index)));
}

/**
 * AP-R3: deletes the lanes on `transitionIds`, before the transitions themselves (the lanes'
 * foreign key is RESTRICT). Routes left without a walker go in the sweep (AP-H3).
 */
export async function deleteLanesOfTransitionsInTransaction(
    tx: DbTransaction,
    transitionIds: readonly number[],
): Promise<void> {
    if (transitionIds.length === 0) return;
    const L = schema.timeline_lanes;
    await tx.delete(L).where(inArray(L.transition_id, transitionIds));
}

/**
 * AP-R20: deletes the lanes of `transitionId` on slots `fromSlot` and above, before its slot
 * count drops below them (I-LN1). Returns how many went.
 */
export async function deleteLanesFromSlotInTransaction(
    tx: DbTransaction,
    transitionId: number,
    fromSlot: number,
): Promise<number> {
    const L = schema.timeline_lanes;
    const gone = await tx
        .delete(L)
        .where(
            and(eq(L.transition_id, transitionId), gte(L.slot_index, fromSlot)),
        )
        .returning();
    return gone.length;
}

/**
 * AP-H3 (spec v0.10 J.8), run at the end of every procedure that deletes or re-points lanes or
 * rows: a route none of whose lanes has a marcher at any beat goes, lanes first (the vacancy
 * default, owner Q1: an emptied spot keeps its lane while another lane of the route still has an
 * occupant), and so does a route with no lane that isn't a follow-the-leader trail. Returns the
 * deleted routes' ids.
 */
export async function sweepOrphanRoutesInTransaction(
    tx: DbTransaction,
): Promise<number[]> {
    const rows = (await tx.all(sql`
        SELECT r.id AS id FROM timeline_routes r
         WHERE NOT EXISTS (SELECT 1 FROM timeline_lanes l
                             JOIN timeline_assignments a
                               ON a.transition_id = l.transition_id AND a.slot_index = l.slot_index
                            WHERE l.route_id = r.id)
           AND NOT EXISTS (SELECT 1 FROM timeline_transitions t WHERE t.route_id = r.id)
         ORDER BY r.id`)) as unknown[];
    const orphans = rows.map((row) =>
        Number(Array.isArray(row) ? row[0] : (row as { id: number }).id),
    );
    if (orphans.length === 0) return [];
    const L = schema.timeline_lanes;
    await tx.delete(L).where(inArray(L.route_id, orphans));
    await tx
        .delete(schema.timeline_routes)
        .where(inArray(schema.timeline_routes.id, orphans));
    return orphans;
}

/** Raises the file's version to `version`; never lowers it. */
async function raiseFileVersion(
    tx: DbTransaction,
    version: number,
): Promise<void> {
    const row = await tx
        .select({ version: sql<number>`user_version` })
        .from(sql`pragma_user_version`)
        .get();
    if ((row?.version ?? 0) < version)
        await tx.run(sql.raw(`PRAGMA user_version = ${version}`));
}

/** Writes the lane-model file version (11) with a file's first lane (ADR 0015 §9). */
export const markLaneModelInTransaction = (tx: DbTransaction) =>
    raiseFileVersion(tx, LANE_MODEL_USER_VERSION);

/** Writes the Adjust file version (12) with a file's first Adjust (ADR 0015 §9, step 3b). */
export const markAdjustModelInTransaction = (tx: DbTransaction) =>
    raiseFileVersion(tx, ADJUST_MODEL_USER_VERSION);
