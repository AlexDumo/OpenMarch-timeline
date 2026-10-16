/**
 * The show's floor (ADR 0002 D-23): a Base floor Artwork embedded in the show's Library tables
 * and named by reference in `field_properties.json_data`, as `floor: { itemId, versionHash }`.
 * It is the field image everywhere: the 2D canvas, exports and the 3D tarp all read its display
 * texture. `field_properties.image` is legacy, read only by convert on open.
 *
 * Setting or clearing the floor is an undoable edit of the JSON alone; the bytes live in
 * `library_items` and `library_blobs`, which have no history triggers.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { FieldFloor } from "@openmarch/core";
// Shared with the main process's convert on open: no renderer database module or history here
import * as schema from "@om-electron/database/migrations/schema";
import type { DbConnection, DbTransaction } from "./types";
import type { LibraryKeep } from "@/view3d/library/showLibraryPrune";

const FIELD_PROPERTIES_ID = 1;

const FieldFloorSchema = z.object({
    itemId: z.string().min(1),
    versionHash: z.string().length(64),
});

const PartsSchema = z.record(z.string(), z.string());

async function readFieldJson(
    db: DbConnection | DbTransaction,
): Promise<Record<string, unknown> | null> {
    const row = await db
        .select({ json: schema.field_properties.json_data })
        .from(schema.field_properties)
        .where(eq(schema.field_properties.id, FIELD_PROPERTIES_ID))
        .get();
    if (!row) return null;
    try {
        const parsed: unknown = JSON.parse(row.json);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

/** The floor the field properties name, or null. A malformed `floor` reads as none. */
export function floorOfFieldJson(
    json: Record<string, unknown> | null,
): FieldFloor | null {
    const floor = FieldFloorSchema.safeParse(json?.floor);
    return floor.success ? floor.data : null;
}

/** The show's floor, or null when it has none. */
export async function getFieldFloor({
    db,
}: {
    db: DbConnection | DbTransaction;
}): Promise<FieldFloor | null> {
    return floorOfFieldJson(await readFieldJson(db));
}

/** Part role to blob hash of an embedded Version, or null when the show doesn't have it. */
async function embeddedParts(
    db: DbConnection | DbTransaction,
    floor: FieldFloor,
): Promise<Record<string, string> | null> {
    const row = await db
        .select({ parts: schema.library_items.parts })
        .from(schema.library_items)
        .where(
            and(
                eq(schema.library_items.item_id, floor.itemId),
                eq(schema.library_items.version_hash, floor.versionHash),
            ),
        )
        .get();
    if (!row) return null;
    try {
        const parts = PartsSchema.safeParse(JSON.parse(row.parts));
        return parts.success ? parts.data : null;
    } catch {
        return null;
    }
}

/**
 * The field image: the floor's display texture (PNG or JPEG), or null when the show has no
 * floor or doesn't hold its Version. Never reads `field_properties.image`.
 */
export async function getFieldFloorImage({
    db,
}: {
    db: DbConnection | DbTransaction;
}): Promise<Uint8Array | null> {
    const floor = await getFieldFloor({ db });
    if (!floor) return null;
    const parts = await embeddedParts(db, floor);
    if (!parts?.display) return null;
    const blob = await db
        .select({ data: schema.library_blobs.data })
        .from(schema.library_blobs)
        .where(eq(schema.library_blobs.hash, parts.display))
        .get();
    return blob?.data ?? null;
}

/**
 * Writes `floor` into the field properties JSON inside `tx`, keeping every other property; null
 * clears it. The Version must already be embedded in the show.
 */
export async function setFieldFloorInTransaction({
    tx,
    floor,
}: {
    tx: DbTransaction;
    floor: FieldFloor | null;
}): Promise<void> {
    if (floor && !(await embeddedParts(tx, floor))) {
        throw new Error(
            `The floor ${floor.itemId}@${floor.versionHash} isn't in this show`,
        );
    }
    const json = await readFieldJson(tx);
    if (!json) throw new Error("Field properties not found");
    const { floor: _previous, ...rest } = json;
    await tx
        .update(schema.field_properties)
        .set({
            json_data: JSON.stringify(
                floor
                    ? {
                          ...rest,
                          floor: {
                              itemId: floor.itemId,
                              versionHash: floor.versionHash,
                          },
                      }
                    : rest,
            ),
        })
        .where(eq(schema.field_properties.id, FIELD_PROPERTIES_ID))
        .run();
}

/** The Version the floor names, which prune keeps (D-23). History is covered separately. */
export async function libraryKeepsFromFloor({
    db,
}: {
    db: DbConnection | DbTransaction;
}): Promise<LibraryKeep[]> {
    const floor = await getFieldFloor({ db });
    return floor ? [{ ...floor }] : [];
}
