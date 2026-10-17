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
 */
import { and, asc, eq, inArray, notExists, sql } from "drizzle-orm";
import type { Hand, Holder, PlacementChange } from "@openmarch/core";
import { schema } from "@/global/database/db";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";

export type PlacementState = (typeof schema.PLACEMENT_STATES)[number];

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
    /** The item ripple it is part of, or null */
    groupId: number | null;
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
    groupId: row.group_id,
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

/**
 * Sets an item's Placement from a beat on: adds a change on that beat, or replaces the one already
 * there in place. A visible trade of equipment between performers is one of these. `groupId`
 * puts the change in an item ripple; left out, a replaced change keeps its group.
 */
export async function setItemPlacementInTransaction({
    tx,
    itemId,
    beatId,
    placement,
    groupId,
}: {
    tx: DbTransaction;
    itemId: number;
    beatId: number;
    placement: PlacementArgs;
    groupId?: number | null;
}): Promise<DatabaseItemPlacement> {
    const wanted = wantedMembers(placement);
    await assertPerformers(tx, [...wanted.keys()]);

    const existing = await tx
        .select({ id: schema.item_placements.id })
        .from(schema.item_placements)
        .where(
            and(
                eq(schema.item_placements.item_id, itemId),
                eq(schema.item_placements.beat_id, beatId),
            ),
        )
        .get();
    const values = {
        state: placement.state,
        ...(groupId !== undefined ? { group_id: groupId } : {}),
    };
    const id = existing
        ? (
              await tx
                  .update(schema.item_placements)
                  .set(values)
                  .where(eq(schema.item_placements.id, existing.id))
                  .returning({ id: schema.item_placements.id })
                  .get()
          ).id
        : (
              await tx
                  .insert(schema.item_placements)
                  .values({ item_id: itemId, beat_id: beatId, ...values })
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
    groupId?: number | null;
}): Promise<DatabaseItemPlacement> {
    return transactionWithHistory(db, "setItemPlacement", (tx) =>
        setItemPlacementInTransaction({ tx, ...args }),
    );
}

/**
 * An item ripple: one Placement change per item at its own (staggered) beat, all with the same
 * value and a new group id, so they edit and delete together. The caller picks the beats from a
 * ripple order (drill, left to right, right to left, down the form).
 */
export async function createItemPlacementRippleInTransaction({
    tx,
    rows,
    placement,
}: {
    tx: DbTransaction;
    rows: readonly { itemId: number; beatId: number }[];
    placement: PlacementArgs;
}): Promise<DatabaseItemPlacement[]> {
    if (rows.length === 0) return [];
    if (new Set(rows.map((r) => r.itemId)).size !== rows.length)
        throw new Error("An item ripple has one change per item");
    const { max } = (await tx
        .select({
            max: sql<number>`coalesce(max(${schema.item_placements.group_id}), 0)`,
        })
        .from(schema.item_placements)
        .get()) ?? { max: 0 };
    const groupId = max + 1;
    const created: DatabaseItemPlacement[] = [];
    for (const { itemId, beatId } of rows)
        created.push(
            await setItemPlacementInTransaction({
                tx,
                itemId,
                beatId,
                placement,
                groupId,
            }),
        );
    return created;
}

export async function createItemPlacementRipple({
    db,
    ...args
}: {
    db: DbConnection;
    rows: readonly { itemId: number; beatId: number }[];
    placement: PlacementArgs;
}): Promise<DatabaseItemPlacement[]> {
    return transactionWithHistory(db, "createItemPlacementRipple", (tx) =>
        createItemPlacementRippleInTransaction({ tx, ...args }),
    );
}

const groupRows = (tx: DbTransaction, groupId: number) =>
    tx
        .select()
        .from(schema.item_placements)
        .where(eq(schema.item_placements.group_id, groupId))
        .orderBy(asc(schema.item_placements.id))
        .all();

/** Sets the value of every change in an item ripple, keeping their beats. */
export async function setItemPlacementGroupInTransaction({
    tx,
    groupId,
    placement,
}: {
    tx: DbTransaction;
    groupId: number;
    placement: PlacementArgs;
}): Promise<DatabaseItemPlacement[]> {
    const updated: DatabaseItemPlacement[] = [];
    for (const row of await groupRows(tx, groupId))
        updated.push(
            await setItemPlacementInTransaction({
                tx,
                itemId: row.item_id,
                beatId: row.beat_id,
                placement,
            }),
        );
    return updated;
}

export async function setItemPlacementGroup({
    db,
    ...args
}: {
    db: DbConnection;
    groupId: number;
    placement: PlacementArgs;
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

/** Every Placement change with its performers, by item and then beat order. */
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
        .orderBy(schema.item_placements.item_id, schema.beats.position)
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
