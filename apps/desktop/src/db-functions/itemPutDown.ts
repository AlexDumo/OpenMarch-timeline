/**
 * Put-down (ADR 0002 D-9, props-spec section 4 "Put down"): a released item lands where its
 * holder was. On a held → placed change the item gets a move ending at its holder's position at
 * that count (the midpoint of its holders' for several), over the span it was held, so it stays
 * there from the put-down on. No "follows marcher" span: when the holder's drill later changes,
 * the item stays where it was put down, the notes list says so ("put down away from its holder"),
 * and Snap to holder writes the move again.
 */
import { asc, eq, inArray } from "drizzle-orm";
import {
    createResolver,
    putDowns,
    putDownSpot,
    type Hand,
    type PlacementChange,
    type XY,
} from "@openmarch/core";
import { schema } from "@/global/database/db";
import { readTimelineTables } from "@/timeline/timelineRows";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { readPageGrid } from "./timelineRipple";
import {
    moveMarchersInRangeInTransaction,
    type TimelineMoveResult,
} from "./timelineMoves";

/** One item's Placement changes with their beats as ordinals, as the resolver counts. */
async function itemChangesInTransaction(
    tx: DbTransaction,
    itemId: number,
    ordinal: ReadonlyMap<number, number>,
): Promise<PlacementChange[]> {
    const rows = await tx
        .select()
        .from(schema.item_placements)
        .where(eq(schema.item_placements.item_id, itemId))
        .all();
    const members =
        rows.length === 0
            ? []
            : await tx
                  .select()
                  .from(schema.item_placement_marchers)
                  .where(
                      inArray(
                          schema.item_placement_marchers.placement_id,
                          rows.map((r) => r.id),
                      ),
                  )
                  .orderBy(asc(schema.item_placement_marchers.id))
                  .all();
    return rows
        .filter((r) => ordinal.has(r.beat_id))
        .map((r) => {
            const own = members.filter((m) => m.placement_id === r.id);
            return {
                id: r.id,
                beat: ordinal.get(r.beat_id)!,
                rank: r.beat_rank,
                state: r.state as PlacementChange["state"],
                holders: own
                    .filter((m) => m.role === "holder")
                    .map((m) => ({
                        marcherId: m.marcher_id,
                        hand: m.hand as Hand,
                    })),
                crew: own
                    .filter((m) => m.role === "crew")
                    .map((m) => m.marcher_id),
                groupId: r.group_id,
            };
        });
}

export interface PutDownResult {
    /** The item's marchers row */
    marcherId: number;
    /** Where it lands, in field units */
    spot: XY;
    /** The move's range, as beat ordinals: from the held change to the put-down */
    range: { start: number; end: number };
    move: TimelineMoveResult;
}

interface ItemContext {
    itemId: number;
    marcherId: number;
    changes: PlacementChange[];
}

async function itemContextOf(
    tx: DbTransaction,
    placementId: number,
): Promise<ItemContext | null> {
    const row = await tx
        .select({
            item_id: schema.item_placements.item_id,
            marcher_id: schema.items.marcher_id,
        })
        .from(schema.item_placements)
        .innerJoin(
            schema.items,
            eq(schema.item_placements.item_id, schema.items.id),
        )
        .where(eq(schema.item_placements.id, placementId))
        .get();
    if (!row) return null;
    const grid = await readPageGrid(tx);
    const ordinal = new Map(grid.beatIds.map((id, i) => [id, i]));
    return {
        itemId: row.item_id,
        marcherId: row.marcher_id,
        changes: await itemChangesInTransaction(tx, row.item_id, ordinal),
    };
}

async function writePutDown(
    tx: DbTransaction,
    context: ItemContext,
    placementId: number,
): Promise<PutDownResult | null> {
    const { changes, marcherId } = context;
    const putDown = putDowns(changes).find((p) => p.changeId === placementId);
    if (!putDown) return null;
    // From the held change it follows: the move runs over the hold, where the item isn't drawn
    const start = Math.max(
        ...changes.filter((c) => c.beat < putDown.beat).map((c) => c.beat),
    );
    const resolver = createResolver((await readTimelineTables(tx)).snapshot);
    const positions = new Map(
        putDown.holders.map(
            (h) =>
                [
                    h.marcherId,
                    resolver.positionAt(h.marcherId, putDown.beat),
                ] as const,
        ),
    );
    const spot = putDownSpot(putDown.holders, positions);
    if (!spot) return null;
    const range = { start, end: putDown.beat };
    const move = await moveMarchersInRangeInTransaction({
        tx,
        range,
        moves: [{ marcherId, x: spot[0], y: spot[1] }],
    });
    return { marcherId, spot, range, move };
}

/**
 * Writes the move that puts an item down at its holder, for the placed change `placementId`.
 * Nothing happens (null) unless that change follows a held one. A move to where the item already
 * is writes nothing.
 */
export async function putDownItemInTransaction({
    tx,
    placementId,
}: {
    tx: DbTransaction;
    placementId: number;
}): Promise<PutDownResult | null> {
    const context = await itemContextOf(tx, placementId);
    return context ? writePutDown(tx, context, placementId) : null;
}

/**
 * After a Placement change is written: puts the item down for that change, and for the change
 * after it, when either is now a held → placed change.
 */
export async function putDownAroundChangeInTransaction({
    tx,
    placementId,
}: {
    tx: DbTransaction;
    placementId: number;
}): Promise<PutDownResult[]> {
    const context = await itemContextOf(tx, placementId);
    if (!context) return [];
    const sorted = [...context.changes].sort(
        (a, b) => a.beat - b.beat || a.id - b.id,
    );
    const index = sorted.findIndex((c) => c.id === placementId);
    const results: PutDownResult[] = [];
    for (const change of sorted.slice(index, index + 2)) {
        const result = await writePutDown(tx, context, change.id);
        if (result) results.push(result);
    }
    return results;
}

/** Thrown inside a snap that writes nothing, so it rolls back instead of leaving an empty undo step. */
class NothingToSnap extends Error {
    constructor(readonly result: PutDownResult | null) {
        super("nothing to snap");
    }
}

const wroteMove = (r: PutDownResult | null) =>
    !!r &&
    (r.move.homes.length > 0 ||
        r.move.slots.length > 0 ||
        r.move.convertedTransitionIds.length > 0 ||
        (r.move.cleared?.length ?? 0) > 0);

/**
 * Snap to holder: puts the item down at its holder's position as it is now, as one undoable edit.
 * Clears the "put down away from its holder" note. A change that isn't a put-down, or an item
 * already at its holder, opens no edit.
 */
export async function snapItemToHolder({
    db,
    placementId,
}: {
    db: DbConnection;
    placementId: number;
}): Promise<PutDownResult | null> {
    try {
        return await transactionWithHistory(
            db,
            "snapItemToHolder",
            async (tx) => {
                const result = await putDownItemInTransaction({
                    tx,
                    placementId,
                });
                if (!wroteMove(result)) throw new NothingToSnap(result);
                return result;
            },
        );
    } catch (e) {
        if (e instanceof NothingToSnap) return e.result;
        throw e;
    }
}
