/**
 * Item Placement: where each item is, count by count (ADR 0002 D-10, props-spec section 4).
 *
 * A Placement change on a beat holds the item by one or more performers (each with a hand),
 * places it at its own position with an optional crew, or takes it Off field. The lookups that
 * read these rows (`placementAt`, `handsAt`, `handConflicts`, `crewDistances`) are pure, in
 * `@openmarch/core`; `toPlacementChanges` maps rows to their input.
 *
 * Storage keeps the columns consistent (the CHECKs in `schema.ts`); these functions keep what a
 * CHECK can't: a held change has at least one holder, only a placed change has crew, and holders
 * and crew are performers. Hand conflicts are allowed and never change data here.
 *
 * A write makes its change the newest on its beat (`beat_rank`), so of two items' changes on one
 * count the one written last wins, as before a replace kept its old id.
 *
 * An item ripple (C3.7's "edit like a cue ripple") is one change per item, each with its own
 * value (each flag to its own performer), spread from a start count over the ripple's span in the
 * ripple's order. Its rows share a group id and the ripple, so it can be re-timed and its state
 * edited together; a group edit changes the state, never who holds what.
 */
import { and, asc, eq, inArray, ne, notExists, sql } from "drizzle-orm";
import type { Hand, Holder, PlacementChange } from "@openmarch/core";
import { schema } from "@/global/database/db";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";

export type PlacementState = (typeof schema.PLACEMENT_STATES)[number];
export type ItemRippleOrder = (typeof schema.ITEM_RIPPLE_ORDERS)[number];

/** How an item ripple spreads its changes, as a cue ripple (`cues.ripple_json`). */
export interface ItemRipple {
    /** Counts the changes are spread over, inclusive: the first on the start count */
    span: number;
    order: ItemRippleOrder;
}

/** A Placement value, as written. */
export type PlacementArgs =
    | { state: "held"; holders: readonly Holder[] }
    | { state: "placed"; crew?: readonly number[] }
    | { state: "off_field" };

/** One Placement change with its performers inlined. */
export interface DatabaseItemPlacement {
    id: number;
    itemId: number;
    beatId: number;
    state: PlacementState;
    /** Held: its holders, by marcher id. Empty otherwise. */
    holders: Holder[];
    /** Placed: its crew, by marcher id. Empty otherwise. */
    crew: number[];
    /** Of two changes on one beat, the higher rank is newer, then the higher id */
    rank: number;
    /** The item ripple it is part of, or null */
    groupId: number | null;
    /** That ripple's span and order, or null */
    ripple: ItemRipple | null;
    createdAt: string;
    updatedAt: string;
}

type RealPlacement = typeof schema.item_placements.$inferSelect;
type RealPlacementMarcher = typeof schema.item_placement_marchers.$inferSelect;

interface Members {
    holders: Holder[];
    crew: number[];
}

const membersByPlacement = async (
    db: DbConnection | DbTransaction,
    placementIds?: readonly number[],
): Promise<Map<number, Members>> => {
    const rows = await db
        .select()
        .from(schema.item_placement_marchers)
        .where(
            placementIds
                ? inArray(schema.item_placement_marchers.placement_id, [
                      ...placementIds,
                  ])
                : undefined,
        )
        .orderBy(asc(schema.item_placement_marchers.id))
        .all();
    const members = new Map<number, Members>();
    for (const row of rows) {
        let entry = members.get(row.placement_id);
        if (!entry) {
            entry = { holders: [], crew: [] };
            members.set(row.placement_id, entry);
        }
        if (row.role === "holder")
            entry.holders.push({
                marcherId: row.marcher_id,
                hand: row.hand as Hand,
            });
        else entry.crew.push(row.marcher_id);
    }
    return members;
};

const parseRipple = (json: string | null): ItemRipple | null => {
    if (json === null) return null;
    const { span, order } = JSON.parse(json) as ItemRipple;
    return { span, order };
};

const serializeRipple = (ripple: ItemRipple) => {
    if (!Number.isInteger(ripple.span) || ripple.span < 1)
        throw new Error("An item ripple spans at least one count");
    if (!schema.ITEM_RIPPLE_ORDERS.includes(ripple.order))
        throw new Error(`Unknown ripple order ${ripple.order}`);
    return JSON.stringify({
        version: 1,
        span: ripple.span,
        order: ripple.order,
    });
};

const toDatabasePlacement = (
    row: RealPlacement,
    members: ReadonlyMap<number, Members>,
): DatabaseItemPlacement => ({
    id: row.id,
    itemId: row.item_id,
    beatId: row.beat_id,
    state: row.state as PlacementState,
    holders: members.get(row.id)?.holders ?? [],
    crew: members.get(row.id)?.crew ?? [],
    rank: row.beat_rank,
    groupId: row.group_id,
    ripple: parseRipple(row.ripple_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

/** The performer rows a Placement value wants, keyed by marcher id. Throws on a bad value. */
const wantedMembers = (
    placement: PlacementArgs,
): Map<number, Pick<RealPlacementMarcher, "role" | "hand">> => {
    const wanted = new Map<
        number,
        Pick<RealPlacementMarcher, "role" | "hand">
    >();
    if (placement.state === "held") {
        if (placement.holders.length === 0)
            throw new Error("A held item needs at least one holder");
        for (const { marcherId, hand } of placement.holders) {
            if (wanted.has(marcherId))
                throw new Error(`Marcher ${marcherId} holds the item twice`);
            wanted.set(marcherId, { role: "holder", hand });
        }
    } else if (placement.state === "placed") {
        for (const marcherId of placement.crew ?? [])
            wanted.set(marcherId, { role: "crew", hand: null });
    }
    return wanted;
};

/** Throws unless every marcher is a performer: items never hold or crew. */
const assertPerformers = async (
    tx: DbTransaction,
    marcherIds: readonly number[],
) => {
    if (marcherIds.length === 0) return;
    const rows = await tx
        .select({ id: schema.marchers.id, type: schema.marchers.type })
        .from(schema.marchers)
        .where(inArray(schema.marchers.id, [...marcherIds]))
        .all();
    const performers = new Set(
        rows.filter((r) => r.type === "marcher").map((r) => r.id),
    );
    const others = marcherIds.filter((id) => !performers.has(id));
    if (others.length > 0)
        throw new Error(
            `Only performers hold or crew an item, not marchers ${others.join(", ")}`,
        );
};

/**
 * Brings a change's performer rows to `wanted`: removed marchers are deleted, kept ones updated
 * only if their role or hand changed, new ones inserted, so undo restores the same rows.
 */
const syncMembers = async (
    tx: DbTransaction,
    placementId: number,
    wanted: ReadonlyMap<number, Pick<RealPlacementMarcher, "role" | "hand">>,
) => {
    const current = await tx
        .select()
        .from(schema.item_placement_marchers)
        .where(eq(schema.item_placement_marchers.placement_id, placementId))
        .all();
    const removed = current
        .filter((m) => !wanted.has(m.marcher_id))
        .map((m) => m.id);
    if (removed.length > 0)
        await tx
            .delete(schema.item_placement_marchers)
            .where(inArray(schema.item_placement_marchers.id, removed))
            .run();
    const byMarcher = new Map(current.map((m) => [m.marcher_id, m]));
    for (const [marcherId, { role, hand }] of wanted) {
        const existing = byMarcher.get(marcherId);
        if (!existing) {
            await tx
                .insert(schema.item_placement_marchers)
                .values({
                    placement_id: placementId,
                    marcher_id: marcherId,
                    role,
                    hand,
                })
                .run();
        } else if (existing.role !== role || existing.hand !== hand) {
            await tx
                .update(schema.item_placement_marchers)
                .set({ role, hand })
                .where(eq(schema.item_placement_marchers.id, existing.id))
                .run();
        }
    }
};

const placementById = async (
    db: DbConnection | DbTransaction,
    id: number,
): Promise<DatabaseItemPlacement> => {
    const row = await db
        .select()
        .from(schema.item_placements)
        .where(eq(schema.item_placements.id, id))
        .get();
    if (!row) throw new Error(`Placement change ${id} not found`);
    return toDatabasePlacement(row, await membersByPlacement(db, [id]));
};

/** The rank that makes a change the newest on its beat: above every other change there. */
const newestRankOn = async (
    tx: DbTransaction,
    beatId: number,
    exceptId?: number,
): Promise<number | null> => {
    const row = await tx
        .select({
            max: sql<number | null>`max(${schema.item_placements.beat_rank})`,
        })
        .from(schema.item_placements)
        .where(
            and(
                eq(schema.item_placements.beat_id, beatId),
                exceptId !== undefined
                    ? ne(schema.item_placements.id, exceptId)
                    : undefined,
            ),
        )
        .get();
    return row?.max === null || row?.max === undefined ? null : row.max + 1;
};

/**
 * Sets an item's Placement from a beat on: adds a change on that beat, or replaces the one already
 * there in place, keeping its ripple. A visible trade of equipment between performers is one of
 * these. The change becomes the newest on its beat.
 */
export async function setItemPlacementInTransaction({
    tx,
    itemId,
    beatId,
    placement,
}: {
    tx: DbTransaction;
    itemId: number;
    beatId: number;
    placement: PlacementArgs;
}): Promise<DatabaseItemPlacement> {
    const wanted = wantedMembers(placement);
    await assertPerformers(tx, [...wanted.keys()]);

    const existing = await tx
        .select({
            id: schema.item_placements.id,
            beat_rank: schema.item_placements.beat_rank,
        })
        .from(schema.item_placements)
        .where(
            and(
                eq(schema.item_placements.item_id, itemId),
                eq(schema.item_placements.beat_id, beatId),
            ),
        )
        .get();
    const rank = await newestRankOn(tx, beatId, existing?.id);
    const id = existing
        ? (
              await tx
                  .update(schema.item_placements)
                  .set({
                      state: placement.state,
                      // Only moves if another change on the beat is ranked at or above it
                      beat_rank:
                          rank === null
                              ? existing.beat_rank
                              : Math.max(existing.beat_rank, rank),
                  })
                  .where(eq(schema.item_placements.id, existing.id))
                  .returning({ id: schema.item_placements.id })
                  .get()
          ).id
        : (
              await tx
                  .insert(schema.item_placements)
                  .values({
                      item_id: itemId,
                      beat_id: beatId,
                      state: placement.state,
                      beat_rank: rank ?? 0,
                  })
                  .returning({ id: schema.item_placements.id })
                  .get()
          ).id;
    await syncMembers(tx, id, wanted);
    return placementById(tx, id);
}

export async function setItemPlacement({
    db,
    ...args
}: {
    db: DbConnection;
    itemId: number;
    beatId: number;
    placement: PlacementArgs;
}): Promise<DatabaseItemPlacement> {
    return transactionWithHistory(db, "setItemPlacement", (tx) =>
        setItemPlacementInTransaction({ tx, ...args }),
    );
}

/**
 * The beats a ripple of `n` changes lands on from the beat at `start` in `beats` (in show order):
 * the first on the start count, the rest spread evenly in time to the span's last count, each on
 * the count whose click is nearest, as a cue ripple spreads its starts (core `compileCues`).
 */
export function rippleBeatIds(
    beats: readonly { id: number; duration: number }[],
    start: number,
    span: number,
    n: number,
): number[] {
    if (start < 0 || start >= beats.length)
        throw new Error("An item ripple starts on a beat of the show");
    const clicks: number[] = [];
    let t = 0;
    for (const b of beats) {
        clicks.push(t);
        t += b.duration;
    }
    const last = Math.min(start + Math.max(span, 1) - 1, beats.length - 1);
    const from = clicks[start]!;
    const to = clicks[last]!;
    const nearest = (time: number) => {
        let best = start;
        for (let i = start; i <= last; i++)
            if (Math.abs(clicks[i]! - time) < Math.abs(clicks[best]! - time))
                best = i;
        return best;
    };
    return Array.from({ length: n }, (_, i) =>
        n === 1 || i === 0
            ? beats[start]!.id
            : beats[nearest(from + ((to - from) * i) / (n - 1))]!.id,
    );
}

const beatsInShowOrder = (tx: DbTransaction) =>
    tx
        .select({ id: schema.beats.id, duration: schema.beats.duration })
        .from(schema.beats)
        .orderBy(asc(schema.beats.position), asc(schema.beats.id))
        .all();

/** The beats `n` ripple changes from `startBeatId` land on. */
const rippleBeats = async (
    tx: DbTransaction,
    startBeatId: number,
    ripple: ItemRipple,
    n: number,
) => {
    const beats = await beatsInShowOrder(tx);
    const start = beats.findIndex((b) => b.id === startBeatId);
    if (start < 0) throw new Error(`Beat ${startBeatId} not found`);
    return rippleBeatIds(beats, start, ripple.span, n);
};

/**
 * An item ripple: one Placement change per item, each with its own value (each flag to its own
 * performer), spread from `startBeatId` over the ripple's span. `rows` come in the ripple's
 * order: the caller sorts them by drill order or by where the items stand (left to right, right
 * to left, down the form), as a cue ripple's compile does. The rows get a new group id and the
 * ripple, so they re-time and edit together. A row on a beat its item already has a change on
 * replaces that change, which joins the ripple.
 */
export async function createItemPlacementRippleInTransaction({
    tx,
    startBeatId,
    ripple,
    rows,
}: {
    tx: DbTransaction;
    startBeatId: number;
    ripple: ItemRipple;
    rows: readonly { itemId: number; placement: PlacementArgs }[];
}): Promise<DatabaseItemPlacement[]> {
    if (rows.length === 0) return [];
    if (new Set(rows.map((r) => r.itemId)).size !== rows.length)
        throw new Error("An item ripple has one change per item");
    const rippleJson = serializeRipple(ripple);
    const beatIds = await rippleBeats(tx, startBeatId, ripple, rows.length);
    const { max } = (await tx
        .select({
            max: sql<number>`coalesce(max(${schema.item_placements.group_id}), 0)`,
        })
        .from(schema.item_placements)
        .get()) ?? { max: 0 };
    const groupId = max + 1;
    const created: DatabaseItemPlacement[] = [];
    for (const [i, { itemId, placement }] of rows.entries()) {
        const change = await setItemPlacementInTransaction({
            tx,
            itemId,
            beatId: beatIds[i]!,
            placement,
        });
        await tx
            .update(schema.item_placements)
            .set({ group_id: groupId, ripple_json: rippleJson })
            .where(eq(schema.item_placements.id, change.id))
            .run();
        created.push(await placementById(tx, change.id));
    }
    return created;
}

export async function createItemPlacementRipple({
    db,
    ...args
}: {
    db: DbConnection;
    startBeatId: number;
    ripple: ItemRipple;
    rows: readonly { itemId: number; placement: PlacementArgs }[];
}): Promise<DatabaseItemPlacement[]> {
    return transactionWithHistory(db, "createItemPlacementRipple", (tx) =>
        createItemPlacementRippleInTransaction({ tx, ...args }),
    );
}

/** A group's rows in their ripple order: by count, then rank, then id. */
const groupRows = (tx: DbTransaction, groupId: number) =>
    tx
        .select({ placement: schema.item_placements })
        .from(schema.item_placements)
        .innerJoin(
            schema.beats,
            eq(schema.item_placements.beat_id, schema.beats.id),
        )
        .where(eq(schema.item_placements.group_id, groupId))
        .orderBy(
            asc(schema.beats.position),
            asc(schema.item_placements.beat_rank),
            asc(schema.item_placements.id),
        )
        .all()
        .then((rows) => rows.map((r) => r.placement));

/**
 * Moves or re-times an item ripple: spreads its changes again from `startBeatId` (left out: the
 * group's first count) over `ripple` (left out: its own), in `itemOrder` (the group's item ids,
 * for a new order; left out: the order they're in). Each change keeps its value. Refused when an
 * item already has another change on the count its change would land on.
 */
export async function moveItemPlacementGroupInTransaction({
    tx,
    groupId,
    startBeatId,
    ripple,
    itemOrder,
}: {
    tx: DbTransaction;
    groupId: number;
    startBeatId?: number;
    ripple?: ItemRipple;
    itemOrder?: readonly number[];
}): Promise<DatabaseItemPlacement[]> {
    const current = await groupRows(tx, groupId);
    if (current.length === 0)
        throw new Error(`Item ripple ${groupId} not found`);
    const byItem = new Map(current.map((r) => [r.item_id, r]));
    let ordered = current;
    if (itemOrder) {
        if (
            itemOrder.length !== current.length ||
            new Set(itemOrder).size !== itemOrder.length ||
            itemOrder.some((id) => !byItem.has(id))
        )
            throw new Error(
                "A ripple's new order names each of its items once",
            );
        ordered = itemOrder.map((id) => byItem.get(id)!);
    }
    const nextRipple = ripple ?? parseRipple(current[0]!.ripple_json)!;
    const rippleJson = serializeRipple(nextRipple);
    const beatIds = await rippleBeats(
        tx,
        startBeatId ?? current[0]!.beat_id,
        nextRipple,
        ordered.length,
    );
    const ids = new Set(current.map((r) => r.id));
    const others = await tx
        .select({
            id: schema.item_placements.id,
            item_id: schema.item_placements.item_id,
            beat_id: schema.item_placements.beat_id,
        })
        .from(schema.item_placements)
        .where(inArray(schema.item_placements.item_id, [...byItem.keys()]))
        .all();
    for (const [i, row] of ordered.entries()) {
        const clash = others.find(
            (o) =>
                !ids.has(o.id) &&
                o.item_id === row.item_id &&
                o.beat_id === beatIds[i],
        );
        if (clash)
            throw new Error(
                `Item ${row.item_id} already has a Placement change on that count`,
            );
    }
    for (const [i, row] of ordered.entries()) {
        const beatId = beatIds[i]!;
        const moved = beatId !== row.beat_id;
        const rank = moved ? await newestRankOn(tx, beatId, row.id) : null;
        await tx
            .update(schema.item_placements)
            .set({
                beat_id: beatId,
                ripple_json: rippleJson,
                ...(moved ? { beat_rank: rank ?? 0 } : {}),
            })
            .where(eq(schema.item_placements.id, row.id))
            .run();
    }
    return Promise.all(current.map((r) => placementById(tx, r.id)));
}

export async function moveItemPlacementGroup({
    db,
    ...args
}: {
    db: DbConnection;
    groupId: number;
    startBeatId?: number;
    ripple?: ItemRipple;
    itemOrder?: readonly number[];
}): Promise<DatabaseItemPlacement[]> {
    return transactionWithHistory(db, "moveItemPlacementGroup", (tx) =>
        moveItemPlacementGroupInTransaction({ tx, ...args }),
    );
}

/**
 * Sets the state of every change in an item ripple, keeping their beats and who holds what. A
 * change already in `state` keeps its holders or crew; one coming to held needs its holders in
 * `values` (by item id), and one coming to placed gets the crew there, or none. `values` can also
 * give any change its own new value in the same state.
 */
export async function setItemPlacementGroupInTransaction({
    tx,
    groupId,
    state,
    values,
}: {
    tx: DbTransaction;
    groupId: number;
    state: PlacementState;
    values?: ReadonlyMap<number, PlacementArgs>;
}): Promise<DatabaseItemPlacement[]> {
    const rows = await groupRows(tx, groupId);
    const members = await membersByPlacement(
        tx,
        rows.map((r) => r.id),
    );
    const updated: DatabaseItemPlacement[] = [];
    for (const row of rows) {
        const given = values?.get(row.item_id);
        if (given && given.state !== state)
            throw new Error(
                `Item ${row.item_id}'s value is ${given.state}, not ${state}`,
            );
        const own = members.get(row.id) ?? { holders: [], crew: [] };
        const keep = row.state === state;
        let placement: PlacementArgs;
        if (given) placement = given;
        else if (state === "held") {
            if (!keep)
                throw new Error(
                    `Item ${row.item_id} needs its holders to be held`,
                );
            placement = { state, holders: own.holders };
        } else if (state === "placed")
            placement = { state, crew: keep ? own.crew : [] };
        else placement = { state };
        updated.push(
            await setItemPlacementInTransaction({
                tx,
                itemId: row.item_id,
                beatId: row.beat_id,
                placement,
            }),
        );
    }
    return updated;
}

export async function setItemPlacementGroup({
    db,
    ...args
}: {
    db: DbConnection;
    groupId: number;
    state: PlacementState;
    values?: ReadonlyMap<number, PlacementArgs>;
}): Promise<DatabaseItemPlacement[]> {
    return transactionWithHistory(db, "setItemPlacementGroup", (tx) =>
        setItemPlacementGroupInTransaction({ tx, ...args }),
    );
}

/** Deletes Placement changes; their performer rows go with them (ON DELETE CASCADE). */
export async function deleteItemPlacementsInTransaction({
    tx,
    placementIds,
}: {
    tx: DbTransaction;
    placementIds: ReadonlySet<number>;
}): Promise<number[]> {
    if (placementIds.size === 0) return [];
    const deleted = await tx
        .delete(schema.item_placements)
        .where(inArray(schema.item_placements.id, [...placementIds]))
        .returning({ id: schema.item_placements.id });
    return deleted.map((r) => r.id);
}

export async function deleteItemPlacements({
    db,
    placementIds,
}: {
    db: DbConnection;
    placementIds: ReadonlySet<number>;
}): Promise<number[]> {
    if (placementIds.size === 0) return [];
    return transactionWithHistory(db, "deleteItemPlacements", (tx) =>
        deleteItemPlacementsInTransaction({ tx, placementIds }),
    );
}

/** Deletes every change in an item ripple. */
export async function deleteItemPlacementGroupInTransaction({
    tx,
    groupId,
}: {
    tx: DbTransaction;
    groupId: number;
}): Promise<number[]> {
    const ids = (await groupRows(tx, groupId)).map((r) => r.id);
    return deleteItemPlacementsInTransaction({
        tx,
        placementIds: new Set(ids),
    });
}

export async function deleteItemPlacementGroup({
    db,
    groupId,
}: {
    db: DbConnection;
    groupId: number;
}): Promise<number[]> {
    return transactionWithHistory(db, "deleteItemPlacementGroup", (tx) =>
        deleteItemPlacementGroupInTransaction({ tx, groupId }),
    );
}

/**
 * Deletes every held change left with no holder. The marcher deletion write path calls it in the
 * same transaction, after the holders went with their marchers, as it does for set cues.
 */
export async function deleteHeldPlacementsWithNoHolderInTransaction({
    tx,
}: {
    tx: DbTransaction;
}): Promise<number[]> {
    // A page-era file has no Placement tables until it converts
    const hasPlacements = await tx
        .select({ n: sql<number>`count(*)` })
        .from(sql`sqlite_schema`)
        .where(sql`type = 'table' AND name = 'item_placements'`)
        .get();
    if (!hasPlacements?.n) return [];
    const deleted = await tx
        .delete(schema.item_placements)
        .where(
            and(
                eq(schema.item_placements.state, "held"),
                notExists(
                    tx
                        .select({ one: sql`1` })
                        .from(schema.item_placement_marchers)
                        .where(
                            and(
                                eq(
                                    schema.item_placement_marchers.placement_id,
                                    schema.item_placements.id,
                                ),
                                eq(
                                    schema.item_placement_marchers.role,
                                    "holder",
                                ),
                            ),
                        ),
                ),
            ),
        )
        .returning({ id: schema.item_placements.id });
    return deleted.map((r) => r.id);
}

/** Every Placement change with its performers, by item, then beat order, then rank. */
export async function getItemPlacements({
    db,
}: {
    db: DbConnection | DbTransaction;
}): Promise<DatabaseItemPlacement[]> {
    const rows = await db
        .select({ placement: schema.item_placements })
        .from(schema.item_placements)
        .innerJoin(
            schema.beats,
            eq(schema.item_placements.beat_id, schema.beats.id),
        )
        .orderBy(
            schema.item_placements.item_id,
            schema.beats.position,
            schema.item_placements.beat_rank,
            schema.item_placements.id,
        )
        .all();
    const members = await membersByPlacement(db);
    return rows.map((r) => toDatabasePlacement(r.placement, members));
}

/**
 * The input of the core Placement lookups, by item id: each change with its beat's position.
 * Changes on a beat with no position are left out.
 */
export function toPlacementChanges(
    placements: readonly DatabaseItemPlacement[],
    beatPositions: ReadonlyMap<number, number>,
): Map<number, PlacementChange[]> {
    const byItem = new Map<number, PlacementChange[]>();
    for (const p of placements) {
        const beat = beatPositions.get(p.beatId);
        if (beat === undefined) continue;
        const change: PlacementChange = {
            id: p.id,
            beat,
            rank: p.rank,
            state: p.state,
            holders: p.holders,
            crew: p.crew,
            groupId: p.groupId,
        };
        const list = byItem.get(p.itemId);
        if (list) list.push(change);
        else byItem.set(p.itemId, [change]);
    }
    return byItem;
}
