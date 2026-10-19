/**
 * Put-down (ADR 0002 D-9, props-spec section 4 "Put down"): a released item lands where its
 * holder is. Nothing is written for it: the timeline resolver's positions are wrapped
 * (`withPutDowns` in `@openmarch/core`), so the put-down is derived from Placement and the
 * holder's drill and can't outlive the release. This file reads what the wrapper needs and has
 * Snap to holder, the one put-down that writes: when the item's own move ends on the put-down
 * (the designer placed it there) and it isn't at its holder, Snap rewrites that move's end.
 */
import { asc } from "drizzle-orm";
import {
    createResolver,
    putDownAnchors,
    type PutDownItem,
    type XY,
} from "@openmarch/core";
import { schema } from "@/global/database/db";
import { readTimelineTables } from "@/timeline/timelineRows";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { getItems } from "./items";
import {
    getItemPlacements,
    toPlacementChanges,
    type DatabaseItemPlacement,
} from "./itemPlacements";
import {
    moveMarchersInRangeInTransaction,
    type TimelineMoveResult,
} from "./timelineMoves";

/**
 * The put-down input from the rows: each item's `marchers` row with its Placement changes, beats
 * as ordinals (`beatIds` in position order, as `readPageGrid` gives them).
 */
export function putDownItemsOf(
    items: readonly { id: number; marcher_id: number }[],
    placements: readonly DatabaseItemPlacement[],
    beatIds: readonly number[],
): PutDownItem[] {
    const ordinal = new Map(beatIds.map((id, i) => [id, i]));
    const byItem = toPlacementChanges(placements, ordinal);
    return items.flatMap((item) => {
        const changes = byItem.get(item.id);
        return changes ? [{ marcherId: item.marcher_id, changes }] : [];
    });
}

/** Every item's put-down input, read from the database. */
export async function readPutDownItems(
    db: DbConnection | DbTransaction,
): Promise<PutDownItem[]> {
    const items = await getItems({ db });
    const placements = await getItemPlacements({ db });
    const beats = await db
        .select({ id: schema.beats.id })
        .from(schema.beats)
        .orderBy(asc(schema.beats.position), asc(schema.beats.id))
        .all();
    return putDownItemsOf(
        items,
        placements,
        beats.map((b) => b.id),
    );
}

export interface SnapResult {
    /** The item's marchers row */
    marcherId: number;
    /** Where it lands, in field units */
    spot: XY;
    /** The item's own move whose end was rewritten, as beat ordinals */
    range: { start: number; end: number };
    move: TimelineMoveResult;
}

/** Thrown inside a snap that writes nothing, so it rolls back instead of leaving an empty undo step. */
class NothingToSnap extends Error {
    constructor() {
        super("nothing to snap");
    }
}

const wroteMove = (r: TimelineMoveResult) =>
    r.homes.length > 0 ||
    r.slots.length > 0 ||
    r.convertedTransitionIds.length > 0 ||
    (r.cleared?.length ?? 0) > 0;

async function snapInTransaction(
    tx: DbTransaction,
    placementId: number,
): Promise<SnapResult | null> {
    const resolver = createResolver((await readTimelineTables(tx)).snapshot);
    for (const item of await readPutDownItems(tx)) {
        if (!item.changes.some((c) => c.id === placementId)) continue;
        const anchor = putDownAnchors(resolver, item).find(
            (a) => a.changeId === placementId,
        );
        if (anchor?.kind !== "own_move" || !anchor.spot) return null;
        const range = { start: anchor.move.start, end: anchor.move.end };
        const move = await moveMarchersInRangeInTransaction({
            tx,
            range,
            moves: [
                {
                    marcherId: item.marcherId,
                    x: anchor.spot[0],
                    y: anchor.spot[1],
                },
            ],
        });
        return { marcherId: item.marcherId, spot: anchor.spot, range, move };
    }
    return null;
}

/**
 * Snap to holder: the item's own move that ends on the put-down `placementId` now ends at its
 * holder, as one undoable edit. Clears the "put down away from its holder" note. Null, opening no
 * edit, when the put-down is derived (always at its holder) or already there.
 */
export async function snapItemToHolder({
    db,
    placementId,
}: {
    db: DbConnection;
    placementId: number;
}): Promise<SnapResult | null> {
    try {
        return await transactionWithHistory(
            db,
            "snapItemToHolder",
            async (tx) => {
                const result = await snapInTransaction(tx, placementId);
                if (!result || !wroteMove(result.move))
                    throw new NothingToSnap();
                return result;
            },
        );
    } catch (e) {
        if (e instanceof NothingToSnap) return null;
        throw e;
    }
}
