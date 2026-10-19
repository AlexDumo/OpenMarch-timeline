/**
 * Items: props and equipment with their own identity in the show (ADR 0002 D-9 and D-10,
 * props-spec sections 4 and 5).
 *
 * An item is a `marchers` row of type `item`, so the timeline resolver positions it and its moves
 * and undo are inherited, plus an `items` row and its beat-keyed Outline changes in
 * `item_geometry`. Items exist only in timeline mode: in page mode a new marchers row would get
 * `marcher_pages` rows, which items never have.
 */
import { and, eq, sql } from "drizzle-orm";
import type { XY } from "@openmarch/core";
import { schema } from "@/global/database/db";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { createMarchersInTransaction } from "./marcher";
import { updateMarcherHomesInTransaction } from "./marcherHome";
import { beatsAfterDeletion } from "./cues";

export { itemLibraryKeeps } from "./itemLibraryKeeps";

export type DatabaseItem = typeof schema.items.$inferSelect;
export type DatabaseItemGeometry = typeof schema.item_geometry.$inferSelect;
export type ItemKind = (typeof schema.ITEM_KINDS)[number];
export type SurfaceType = (typeof schema.SURFACE_TYPES)[number];
export type OutlineType = (typeof schema.OUTLINE_TYPES)[number];
export type LeadingEdge = (typeof schema.LEADING_EDGES)[number];

/** One Outline change. Sizes in meters, rotation in degrees. */
export interface ItemGeometryArgs {
    outlineType: OutlineType;
    width: number;
    depth: number;
    /** 0 by default: a flat Floor prop */
    height?: number;
    rotation?: number;
    /** JSON points backing a polygon, freehand or arc Outline */
    customOutline?: unknown;
    /** In counts; 1 (instant) by default */
    transitionLength?: number;
    /** Floor props: the edge a roll-out reveals Artwork from, or none */
    rollsOutFrom?: LeadingEdge | null;
}

export interface NewItemArgs {
    kind: ItemKind;
    name?: string | null;
    /** Props only */
    surfaceType?: SurfaceType;
    /** Where it was drawn: its home, `[x, y]` in canvas coordinates like a marcher's */
    home: XY;
    /** The beat it was created on: Off field before it, on field from it */
    beatId: number;
    geometry: ItemGeometryArgs;
    /** A Library model and the Version it pins */
    library?: { itemId: string; versionHash: string };
}

/** Each kind has its own section and drill prefix, apart from every performer's */
const KIND_NUMBERING: Record<ItemKind, { section: string; prefix: string }> = {
    prop: { section: "Prop", prefix: "PROP" },
    equipment: { section: "Equipment", prefix: "EQUIP" },
};

const geometryValues = (geometry: ItemGeometryArgs) => ({
    outline_type: geometry.outlineType,
    width: geometry.width,
    depth: geometry.depth,
    height: geometry.height ?? 0,
    rotation: geometry.rotation ?? 0,
    custom_outline:
        geometry.customOutline === undefined || geometry.customOutline === null
            ? null
            : JSON.stringify(geometry.customOutline),
    transition_length: geometry.transitionLength ?? 1,
    rolls_out: geometry.rollsOutFrom ? 1 : 0,
    leading_edge: geometry.rollsOutFrom ?? null,
});

async function nextDrillOrders(
    tx: DbTransaction,
    newItems: readonly NewItemArgs[],
): Promise<number[]> {
    const next = new Map<string, number>();
    const orders: number[] = [];
    for (const item of newItems) {
        const { prefix } = KIND_NUMBERING[item.kind];
        if (!next.has(prefix)) {
            const row = await tx
                .select({
                    max: sql<number>`coalesce(max(${schema.marchers.drill_order}), 0)`,
                })
                .from(schema.marchers)
                .where(eq(schema.marchers.drill_prefix, prefix))
                .get();
            next.set(prefix, (row?.max ?? 0) + 1);
        }
        const order = next.get(prefix)!;
        next.set(prefix, order + 1);
        orders.push(order);
    }
    return orders;
}

/**
 * Creates items at home where they were drawn, on field from their beat: a marchers row, its
 * home, the item row and its first Outline change.
 */
export async function createItemsInTransaction({
    tx,
    newItems,
}: {
    tx: DbTransaction;
    newItems: readonly NewItemArgs[];
}): Promise<DatabaseItem[]> {
    if (newItems.length === 0) return [];

    const orders = await nextDrillOrders(tx, newItems);
    const marchers = await createMarchersInTransaction({
        tx,
        newMarchers: newItems.map((item, i) => ({
            name: item.name ?? null,
            section: KIND_NUMBERING[item.kind].section,
            drill_prefix: KIND_NUMBERING[item.kind].prefix,
            drill_order: orders[i],
            type: "item",
        })),
    });
    await updateMarcherHomesInTransaction({
        tx,
        modifiedHomes: marchers.map((m, i) => ({
            marcherId: m.id,
            home: newItems[i].home,
        })),
    });

    const items: DatabaseItem[] = [];
    for (const [i, newItem] of newItems.entries()) {
        const item = await tx
            .insert(schema.items)
            .values({
                marcher_id: marchers[i].id,
                kind: newItem.kind,
                surface_type:
                    newItem.kind === "prop"
                        ? (newItem.surfaceType ?? "obstacle")
                        : null,
                library_item_id: newItem.library?.itemId ?? null,
                library_version_hash: newItem.library?.versionHash ?? null,
            })
            .returning()
            .get();
        await tx
            .insert(schema.item_geometry)
            .values({
                item_id: item.id,
                beat_id: newItem.beatId,
                ...geometryValues(newItem.geometry),
            })
            .run();
        items.push(item);
    }
    return items;
}

export async function createItems({
    db,
    newItems,
}: {
    db: DbConnection;
    newItems: readonly NewItemArgs[];
}): Promise<DatabaseItem[]> {
    return transactionWithHistory(db, "createItems", (tx) =>
        createItemsInTransaction({ tx, newItems }),
    );
}

/**
 * Sets an item's Outline from a beat on: adds a change on that beat, or replaces the one already
 * there. Never touches the item's moves.
 */
export async function setItemGeometryInTransaction({
    tx,
    itemId,
    beatId,
    geometry,
}: {
    tx: DbTransaction;
    itemId: number;
    beatId: number;
    geometry: ItemGeometryArgs;
}): Promise<DatabaseItemGeometry> {
    const values = geometryValues(geometry);
    const existing = await tx
        .select({ id: schema.item_geometry.id })
        .from(schema.item_geometry)
        .where(
            and(
                eq(schema.item_geometry.item_id, itemId),
                eq(schema.item_geometry.beat_id, beatId),
            ),
        )
        .get();
    // Update in place rather than upsert, so undo restores the same row
    if (existing) {
        return tx
            .update(schema.item_geometry)
            .set(values)
            .where(eq(schema.item_geometry.id, existing.id))
            .returning()
            .get();
    }
    return tx
        .insert(schema.item_geometry)
        .values({ item_id: itemId, beat_id: beatId, ...values })
        .returning()
        .get();
}

export async function setItemGeometry({
    db,
    ...args
}: {
    db: DbConnection;
    itemId: number;
    beatId: number;
    geometry: ItemGeometryArgs;
}): Promise<DatabaseItemGeometry> {
    return transactionWithHistory(db, "setItemGeometry", (tx) =>
        setItemGeometryInTransaction({ tx, ...args }),
    );
}

/** Every item with its marchers row, in creation order. */
export async function getItems({
    db,
}: {
    db: DbConnection | DbTransaction;
}): Promise<
    (DatabaseItem & { marcher: typeof schema.marchers.$inferSelect })[]
> {
    const rows = await db
        .select()
        .from(schema.items)
        .innerJoin(
            schema.marchers,
            eq(schema.items.marcher_id, schema.marchers.id),
        )
        .orderBy(schema.items.id)
        .all();
    return rows.map((row) => ({ ...row.items, marcher: row.marchers }));
}

/** Every Outline change, by item and then beat order. */
export async function getItemGeometry({
    db,
}: {
    db: DbConnection | DbTransaction;
}): Promise<DatabaseItemGeometry[]> {
    return db
        .select({ geometry: schema.item_geometry })
        .from(schema.item_geometry)
        .innerJoin(
            schema.beats,
            eq(schema.item_geometry.beat_id, schema.beats.id),
        )
        .orderBy(schema.item_geometry.item_id, schema.beats.position)
        .all()
        .then((rows) => rows.map((r) => r.geometry));
}

export interface ModifiedItemArgs {
    itemId: number;
    /** The item's name, on its marchers row; null clears it */
    name?: string | null;
    /** Props only */
    surfaceType?: SurfaceType;
}

/** Renames items and changes props' surface types. */
export async function updateItemsInTransaction({
    tx,
    modifiedItems,
}: {
    tx: DbTransaction;
    modifiedItems: readonly ModifiedItemArgs[];
}): Promise<void> {
    for (const { itemId, name, surfaceType } of modifiedItems) {
        const item = await tx
            .select()
            .from(schema.items)
            .where(eq(schema.items.id, itemId))
            .get();
        if (!item) throw new Error(`No item with id ${itemId}`);
        if (name !== undefined)
            await tx
                .update(schema.marchers)
                .set({ name })
                .where(eq(schema.marchers.id, item.marcher_id))
                .run();
        if (surfaceType !== undefined) {
            if (item.kind !== "prop")
                throw new Error("Only props have a surface type");
            await tx
                .update(schema.items)
                .set({ surface_type: surfaceType })
                .where(eq(schema.items.id, itemId))
                .run();
            // Only a Floor prop rolls out: a platform or obstacle drops it at every count
            if (surfaceType !== "floor")
                await tx
                    .update(schema.item_geometry)
                    .set({ rolls_out: 0, leading_edge: null })
                    .where(
                        and(
                            eq(schema.item_geometry.item_id, itemId),
                            eq(schema.item_geometry.rolls_out, 1),
                        ),
                    )
                    .run();
        }
    }
}

/** `updateItemsInTransaction` as one undo step. */
export async function updateItems({
    db,
    modifiedItems,
}: {
    db: DbConnection;
    modifiedItems: readonly ModifiedItemArgs[];
}): Promise<void> {
    if (modifiedItems.length === 0) return;
    await transactionWithHistory(db, "updateItems", (tx) =>
        updateItemsInTransaction({ tx, modifiedItems }),
    );
}

/** An item table keyed by beat: Outline changes (C2.1) and Placement changes (C2.3). */
type BeatKeyedItemTable =
    | typeof schema.item_geometry
    | typeof schema.item_placements;

/** Whether the file has `name`: the item tables come with timeline-only migrations. */
const hasTable = async (tx: DbTransaction, name: string) =>
    !!(
        await tx
            .select({ n: sql<number>`count(*)` })
            .from(sql`sqlite_schema`)
            .where(sql`type = 'table' AND name = ${name}`)
            .get()
    )?.n;

/**
 * Carries the item changes on beats about to be deleted forward, as cues are carried (ADR 0004
 * amendment of 2026-10-15): Outline changes and Placement changes. Call it in the deletion's
 * transaction, before the beats go, so one undo restores both. Per item and table, of the
 * changes on a run of deleted beats only the last is kept: it moves to the first surviving beat
 * after the run, unless the item already has a change there, which wins. With no beat after the
 * run, the changes go with their beats, unless that would leave an item no Outline at all: then
 * its last Outline change moves to the last surviving beat before the run. Without this,
 * deleting the count a prop was made on would leave it Off field for good.
 */
export async function carryItemChangesPastDeletedBeatsInTransaction({
    tx,
    beatIds,
}: {
    tx: DbTransaction;
    beatIds: ReadonlySet<number>;
}): Promise<void> {
    if (beatIds.size === 0) return;
    const tables: [string, BeatKeyedItemTable][] = [
        ["item_geometry", schema.item_geometry],
        ["item_placements", schema.item_placements],
    ];
    let after: Awaited<ReturnType<typeof beatsAfterDeletion>> | null = null;
    for (const [name, table] of tables) {
        if (!(await hasTable(tx, name))) continue;
        const rows = await tx
            .select({
                id: table.id,
                item_id: table.item_id,
                beat_id: table.beat_id,
            })
            .from(table)
            .all();
        if (!rows.some((row) => beatIds.has(row.beat_id))) continue;
        after ??= await beatsAfterDeletion(tx, beatIds);
        const { order, nextBeat } = after;
        // An item's only Outline changes at the end of the show go to the last beat left
        const keepsAnOutline = new Set(
            rows
                .filter((row) => !beatIds.has(row.beat_id))
                .map((r) => r.item_id),
        );
        const survivorsInOrder = [...order.entries()]
            .filter(([id]) => !beatIds.has(id))
            .sort((a, b) => a[1] - b[1]);
        const lastSurvivorBefore = (at: number) =>
            name === "item_geometry"
                ? (survivorsInOrder.findLast(([, i]) => i < at)?.[0] ?? null)
                : null;

        // The last change per item and destination; the rest go with their beats
        const kept = new Map<string, { id: number; to: number; at: number }>();
        for (const row of rows) {
            if (!beatIds.has(row.beat_id)) continue;
            const at = order.get(row.beat_id)!;
            const to =
                nextBeat.get(row.beat_id) ??
                (keepsAnOutline.has(row.item_id)
                    ? null
                    : lastSurvivorBefore(at));
            if (to === null) continue;
            const key = `${row.item_id}|${to}`;
            const current = kept.get(key);
            if (!current || at > current.at)
                kept.set(key, { id: row.id, to, at });
        }
        const taken = new Set(
            rows
                .filter((row) => !beatIds.has(row.beat_id))
                .map((row) => `${row.item_id}|${row.beat_id}`),
        );
        for (const [key, { id, to }] of kept) {
            if (taken.has(key)) continue;
            await tx
                .update(table)
                .set({ beat_id: to })
                .where(eq(table.id, id))
                .run();
        }
    }
}
