/**
 * Artwork slot assignments: which Artwork sits on each item slot, from each count (ADR 0002
 * D-10, props-spec section 4).
 *
 * A change on (item, slot, beat) puts an Artwork Version on the slot from that beat on, with fill
 * or fit, pan and pad color, or leaves the slot bare. The lookups that read these rows
 * (`assignmentAt`, `slotAssignmentsAt`, `dormantAssignments`, `slotsForItem`) are pure, in
 * `@openmarch/core`; `toArtworkAssignments` maps rows to their input.
 *
 * An assignment names an Artwork Version the show has embedded (`library_items`); one it doesn't
 * hold is refused, so a slot never points at nothing.
 *
 * Rows are stored by slot id and never rewritten when an item's slots change, so an assignment
 * whose slot an update drops stays here, dormant, and is live again on revert. That is also why
 * nothing here checks the slot against the item's model: dormant rows are allowed by design.
 */
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import {
    defaultAssignmentScope,
    type ArtworkAssignment,
    type ArtworkFit,
    type ArtworkPan,
    type AssignmentScope,
    type LibraryVersionRef,
} from "@openmarch/core";
import { schema } from "@/global/database/db";
import {
    ARTWORK_SLOT_ID_RULE,
    isArtworkSlotId,
} from "@om-electron/database/migrations/artworkSlotId";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";

/** An assignment's value, as written. Left out: fill, centered, default padding. */
export interface ArtworkAssignmentArgs {
    /** The Artwork Version, or null to leave the slot bare from this count */
    artwork: LibraryVersionRef | null;
    fit?: ArtworkFit;
    pan?: ArtworkPan;
    /** `#rrggbb` (any case, stored lower case), or null for the surface's default padding */
    padColor?: string | null;
}

/** One assignment change. */
export interface DatabaseItemArtworkSlot {
    id: number;
    itemId: number;
    slot: string;
    beatId: number;
    artwork: LibraryVersionRef | null;
    fit: ArtworkFit;
    pan: ArtworkPan;
    padColor: string | null;
    createdAt: string;
    updatedAt: string;
}

type RealArtworkSlot = typeof schema.item_artwork_slots.$inferSelect;

const toDatabaseArtworkSlot = (
    row: RealArtworkSlot,
): DatabaseItemArtworkSlot => ({
    id: row.id,
    itemId: row.item_id,
    slot: row.slot,
    beatId: row.beat_id,
    artwork:
        row.library_item_id !== null && row.library_version_hash !== null
            ? {
                  itemId: row.library_item_id,
                  versionHash: row.library_version_hash,
              }
            : null,
    fit: row.fit as ArtworkFit,
    pan: { x: row.pan_x, y: row.pan_y },
    padColor: row.pad_color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const PAD_COLOR = /^#[0-9a-f]{6}$/;

/** The row values for an assignment. Throws on a value the table would refuse. */
const assignmentValues = (slot: string, assignment: ArtworkAssignmentArgs) => {
    if (!isArtworkSlotId(slot))
        throw new Error(`Slot id "${slot}" must be ${ARTWORK_SLOT_ID_RULE}`);
    const pan = assignment.pan ?? { x: 0, y: 0 };
    for (const v of [pan.x, pan.y])
        if (!Number.isFinite(v) || v < -1 || v > 1)
            throw new Error(`Pan ${v} is outside -1 to 1`);
    const padColor = assignment.padColor?.toLowerCase() ?? null;
    if (padColor !== null && !PAD_COLOR.test(padColor))
        throw new Error(`Pad color "${assignment.padColor}" isn't #rrggbb`);
    return {
        library_item_id: assignment.artwork?.itemId ?? null,
        library_version_hash: assignment.artwork?.versionHash ?? null,
        fit: assignment.fit ?? "fill",
        pan_x: pan.x,
        pan_y: pan.y,
        pad_color: padColor,
    };
};

/** Throws unless the show has `artwork` embedded as an Artwork Version. */
const assertEmbeddedArtwork = async (
    tx: DbTransaction,
    artwork: LibraryVersionRef | null,
) => {
    if (!artwork) return;
    const row = await tx
        .select({ kind: schema.library_items.kind })
        .from(schema.library_items)
        .where(
            and(
                eq(schema.library_items.item_id, artwork.itemId),
                eq(schema.library_items.version_hash, artwork.versionHash),
            ),
        )
        .get();
    if (!row)
        throw new Error(
            `The show doesn't hold Artwork ${artwork.itemId} at Version ${artwork.versionHash}: embed it first`,
        );
    if (row.kind !== "artwork")
        throw new Error(
            `Library item ${artwork.itemId} is a ${row.kind}, not an Artwork`,
        );
};

/**
 * Sets what sits on an item slot from a beat on: adds a change on that beat, or replaces the one
 * already there in place, so undo restores the same row. The Artwork must be embedded in the show.
 */
export async function setItemArtworkSlotInTransaction({
    tx,
    itemId,
    slot,
    beatId,
    assignment,
}: {
    tx: DbTransaction;
    itemId: number;
    slot: string;
    beatId: number;
    assignment: ArtworkAssignmentArgs;
}): Promise<DatabaseItemArtworkSlot> {
    const values = assignmentValues(slot, assignment);
    await assertEmbeddedArtwork(tx, assignment.artwork);
    const existing = await tx
        .select({ id: schema.item_artwork_slots.id })
        .from(schema.item_artwork_slots)
        .where(
            and(
                eq(schema.item_artwork_slots.item_id, itemId),
                eq(schema.item_artwork_slots.slot, slot),
                eq(schema.item_artwork_slots.beat_id, beatId),
            ),
        )
        .get();
    const row = existing
        ? await tx
              .update(schema.item_artwork_slots)
              .set(values)
              .where(eq(schema.item_artwork_slots.id, existing.id))
              .returning()
              .get()
        : await tx
              .insert(schema.item_artwork_slots)
              .values({ item_id: itemId, slot, beat_id: beatId, ...values })
              .returning()
              .get();
    return toDatabaseArtworkSlot(row);
}

export async function setItemArtworkSlot({
    db,
    ...args
}: {
    db: DbConnection;
    itemId: number;
    slot: string;
    beatId: number;
    assignment: ArtworkAssignmentArgs;
}): Promise<DatabaseItemArtworkSlot> {
    return transactionWithHistory(db, "setItemArtworkSlot", (tx) =>
        setItemArtworkSlotInTransaction({ tx, ...args }),
    );
}

/** The slot of each change on one item slot, in no particular order. */
const slotChanges = (tx: DbTransaction, itemId: number, slot: string) =>
    tx
        .select({ slot: schema.item_artwork_slots.slot })
        .from(schema.item_artwork_slots)
        .where(
            and(
                eq(schema.item_artwork_slots.item_id, itemId),
                eq(schema.item_artwork_slots.slot, slot),
            ),
        )
        .all();

const firstBeatId = async (tx: DbTransaction): Promise<number> => {
    const first = await tx
        .select({ id: schema.beats.id })
        .from(schema.beats)
        .orderBy(asc(schema.beats.position))
        .limit(1)
        .get();
    if (!first) throw new Error("The show has no beats");
    return first.id;
};

/**
 * What the item slot picker writes. Scope `show` puts the assignment on the whole show: one change
 * on the first beat, replacing every other change on the slot. Scope `from_count` writes it on
 * `beatId`, from the current count on. Left out, the scope is the whole show while the slot has no
 * changes, otherwise from the current count (`defaultAssignmentScope`); the picker shows it on its
 * button and can switch it.
 */
export async function assignItemArtworkSlotInTransaction({
    tx,
    itemId,
    slot,
    beatId,
    assignment,
    scope,
}: {
    tx: DbTransaction;
    itemId: number;
    slot: string;
    /** The beat of the current count */
    beatId: number;
    assignment: ArtworkAssignmentArgs;
    scope?: AssignmentScope;
}): Promise<{
    scope: AssignmentScope;
    assignment: DatabaseItemArtworkSlot;
}> {
    const existing = await slotChanges(tx, itemId, slot);
    const chosen = scope ?? defaultAssignmentScope(existing, slot);
    if (chosen === "from_count")
        return {
            scope: chosen,
            assignment: await setItemArtworkSlotInTransaction({
                tx,
                itemId,
                slot,
                beatId,
                assignment,
            }),
        };

    const first = await firstBeatId(tx);
    await tx
        .delete(schema.item_artwork_slots)
        .where(
            and(
                eq(schema.item_artwork_slots.item_id, itemId),
                eq(schema.item_artwork_slots.slot, slot),
                ne(schema.item_artwork_slots.beat_id, first),
            ),
        )
        .run();
    return {
        scope: chosen,
        assignment: await setItemArtworkSlotInTransaction({
            tx,
            itemId,
            slot,
            beatId: first,
            assignment,
        }),
    };
}

export async function assignItemArtworkSlot({
    db,
    ...args
}: {
    db: DbConnection;
    itemId: number;
    slot: string;
    beatId: number;
    assignment: ArtworkAssignmentArgs;
    scope?: AssignmentScope;
}): Promise<{
    scope: AssignmentScope;
    assignment: DatabaseItemArtworkSlot;
}> {
    return transactionWithHistory(db, "assignItemArtworkSlot", (tx) =>
        assignItemArtworkSlotInTransaction({ tx, ...args }),
    );
}

/** Deletes assignment changes by id. */
export async function deleteItemArtworkSlotsInTransaction({
    tx,
    assignmentIds,
}: {
    tx: DbTransaction;
    assignmentIds: ReadonlySet<number>;
}): Promise<number[]> {
    if (assignmentIds.size === 0) return [];
    const deleted = await tx
        .delete(schema.item_artwork_slots)
        .where(inArray(schema.item_artwork_slots.id, [...assignmentIds]))
        .returning({ id: schema.item_artwork_slots.id });
    return deleted.map((r) => r.id);
}

export async function deleteItemArtworkSlots({
    db,
    assignmentIds,
}: {
    db: DbConnection;
    assignmentIds: ReadonlySet<number>;
}): Promise<number[]> {
    if (assignmentIds.size === 0) return [];
    return transactionWithHistory(db, "deleteItemArtworkSlots", (tx) =>
        deleteItemArtworkSlotsInTransaction({ tx, assignmentIds }),
    );
}

/** Every assignment change, dormant ones included, by item, slot and then beat order. */
export async function getItemArtworkSlots({
    db,
}: {
    db: DbConnection | DbTransaction;
}): Promise<DatabaseItemArtworkSlot[]> {
    const rows = await db
        .select({ assignment: schema.item_artwork_slots })
        .from(schema.item_artwork_slots)
        .innerJoin(
            schema.beats,
            eq(schema.item_artwork_slots.beat_id, schema.beats.id),
        )
        .orderBy(
            schema.item_artwork_slots.item_id,
            schema.item_artwork_slots.slot,
            schema.beats.position,
        )
        .all();
    return rows.map((r) => toDatabaseArtworkSlot(r.assignment));
}

/**
 * The input of the core assignment lookups, by item id: each change with its beat's position.
 * Changes on a beat with no position are left out.
 */
export function toArtworkAssignments(
    assignments: readonly DatabaseItemArtworkSlot[],
    beatPositions: ReadonlyMap<number, number>,
): Map<number, ArtworkAssignment[]> {
    const byItem = new Map<number, ArtworkAssignment[]>();
    for (const a of assignments) {
        const beat = beatPositions.get(a.beatId);
        if (beat === undefined) continue;
        const change: ArtworkAssignment = {
            id: a.id,
            slot: a.slot,
            beat,
            artwork: a.artwork,
            fit: a.fit,
            pan: a.pan,
            padColor: a.padColor,
        };
        const list = byItem.get(a.itemId);
        if (list) list.push(change);
        else byItem.set(a.itemId, [change]);
    }
    return byItem;
}

/** The Library references the Item tables use (`itemLibraryKeeps`), for callers of this module. */
export { itemLibraryKeeps as getLibraryReferencesInUse } from "./itemLibraryKeeps";
