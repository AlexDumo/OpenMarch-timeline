/**
 * The show's floor (ADR 0002 D-23): a Base floor Artwork embedded in the show's Library tables
 * and named by reference in `field_properties.json_data`, as `floor: { itemId, versionHash }`.
 * It is the field image everywhere. The 2D canvas and the exports draw its original when that
 * is a PNG or JPEG (a vector original draws as its display texture), the 3D tarp draws the
 * display texture, and every one of them places it at the floor's physical size.
 *
 * `field_properties.image` is legacy: convert on open turns it into the floor. Until that
 * succeeds (an image the conversion can't read), the field still draws it, as before.
 *
 * Setting or clearing the floor is an undoable edit of the JSON alone; the bytes live in
 * `library_items` and `library_blobs`, which have no history triggers. Installing a floor
 * writes the floor-model file version, so a build that only knows 8 refuses the file.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { FieldFloor } from "@openmarch/core";
// Shared with the main process's convert on open: no renderer database module or history here
import * as schema from "@om-electron/database/migrations/schema";
import type { DbConnection, DbTransaction } from "./types";
import type { LibraryKeep } from "@/view3d/library/showLibraryPrune";
import { FLOOR_MODEL_USER_VERSION } from "@om-electron/database/fileVersion";
import {
    ARTWORK_PARTS,
    decodeArtworkSidecar,
} from "@om-electron/main/artwork-import/sidecar";
import { sniffArtworkFormat } from "@om-electron/main/artwork-import/formats";

const FIELD_PROPERTIES_ID = 1;

const FieldFloorSchema = z.object({
    itemId: z.string().min(1),
    versionHash: z.string().length(64),
});

const PartsSchema = z.record(z.string(), z.string());

export async function readFieldJson(
    db: DbConnection | DbTransaction,
): Promise<Record<string, unknown> | null> {
    const row = await db
        .select({ json: schema.field_properties.json_data })
        .from(schema.field_properties)
        .where(eq(schema.field_properties.id, FIELD_PROPERTIES_ID))
        .get();
    return row ? parseFieldJson(row.json) : null;
}

/** Field properties JSON as an object, or null when it doesn't parse to one. */
export function parseFieldJson(text: string): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(text);
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

/** The bytes of one part of the floor's Version, or null when the show doesn't hold it. */
async function floorPartBytes(
    db: DbConnection | DbTransaction,
    parts: Record<string, string> | null,
    role: string,
): Promise<Uint8Array | null> {
    const hash = parts?.[role];
    if (!hash) return null;
    const blob = await db
        .select({ data: schema.library_blobs.data })
        .from(schema.library_blobs)
        .where(eq(schema.library_blobs.hash, hash))
        .get();
    return blob?.data ?? null;
}

/**
 * One part of the floor's Version, such as `display` or `original`, or null when the show has
 * no floor or doesn't hold its Version.
 */
export async function getFieldFloorPart({
    db,
    role,
}: {
    db: DbConnection | DbTransaction;
    role: "display" | "original" | "sidecar";
}): Promise<Uint8Array | null> {
    const floor = await getFieldFloor({ db });
    if (!floor) return null;
    return floorPartBytes(db, await embeddedParts(db, floor), role);
}

/** A floor's physical size in meters. */
export interface FieldImageSize {
    widthM: number;
    heightM: number;
}

/** The field image as a reader draws it. */
export interface FieldImage {
    /** PNG or JPEG bytes, except for a legacy image, which is whatever was uploaded */
    bytes: Uint8Array;
    /** The floor's physical size, centered on the field; null places it by fill or fit */
    size: FieldImageSize | null;
    /** The show's floor, or the legacy image a conversion hasn't turned into one yet */
    source: "floor" | "legacy";
}

/**
 * The field image for a reader: the floor's `original` for 2D and exports (`"print"`, or the
 * display texture when the original is a vector), its `display` texture for the 3D tarp
 * (`"display"`). With no floor, the legacy image, which convert on open couldn't turn into one.
 * Null when the show has neither.
 */
export async function getFieldImage({
    db,
    use,
}: {
    db: DbConnection | DbTransaction;
    use: "print" | "display";
}): Promise<FieldImage | null> {
    const floor = await getFieldFloor({ db });
    if (!floor) {
        const legacy = await readLegacyFieldImage(db);
        return legacy ? { bytes: legacy, size: null, source: "legacy" } : null;
    }
    const parts = await embeddedParts(db, floor);
    if (!parts) return null;
    const size = floorSizeOf(
        await floorPartBytes(db, parts, ARTWORK_PARTS.sidecar),
    );
    if (use === "print") {
        const original = await floorPartBytes(
            db,
            parts,
            ARTWORK_PARTS.original,
        );
        const format = original ? sniffArtworkFormat(original) : null;
        if (original && (format === "png" || format === "jpeg"))
            return { bytes: original, size, source: "floor" };
    }
    const display = await floorPartBytes(db, parts, ARTWORK_PARTS.display);
    return display ? { bytes: display, size, source: "floor" } : null;
}

/** The physical size a floor's sidecar records, or null when it has none that reads. */
function floorSizeOf(sidecar: Uint8Array | null): FieldImageSize | null {
    if (!sidecar) return null;
    try {
        const { size } = decodeArtworkSidecar(sidecar);
        return size.width.m > 0 && size.height.m > 0
            ? { widthM: size.width.m, heightM: size.height.m }
            : null;
    } catch {
        return null;
    }
}

/** The legacy `field_properties.image`, or null when it's empty. */
async function readLegacyFieldImage(
    db: DbConnection | DbTransaction,
): Promise<Uint8Array | null> {
    const row = await db
        .select({ image: schema.field_properties.image })
        .from(schema.field_properties)
        .where(eq(schema.field_properties.id, FIELD_PROPERTIES_ID))
        .get();
    return row?.image && row.image.byteLength > 0 ? row.image : null;
}

/**
 * The field image's display texture: the floor's, else the legacy image, or null. The 3D tarp's
 * image; 2D and exports read `getFieldImage` with `"print"`.
 */
export async function getFieldFloorImage({
    db,
}: {
    db: DbConnection | DbTransaction;
}): Promise<Uint8Array | null> {
    return (await getFieldImage({ db, use: "display" }))?.bytes ?? null;
}

/**
 * Writes the floor-model file version (9) inside `tx`, so a build that only knows 8 refuses a
 * file once it has a floor. A file without one stays at the version it had (D-23): opening it
 * to look never changes it.
 */
export async function markFloorModelInTransaction(
    tx: DbTransaction,
): Promise<void> {
    const row = await tx
        .select({ version: sql<number>`user_version` })
        .from(sql`pragma_user_version`)
        .get();
    if ((row?.version ?? 0) < FLOOR_MODEL_USER_VERSION)
        await tx.run(
            sql.raw(`PRAGMA user_version = ${FLOOR_MODEL_USER_VERSION}`),
        );
}

/**
 * Writes `floor` into the field properties JSON inside `tx`, keeping every other property; null
 * clears it. `patch` sets other properties in the same write, such as `showFieldImage`. The
 * Version must already be embedded in the show. Setting a floor writes the floor-model version.
 */
export async function setFieldFloorInTransaction({
    tx,
    floor,
    patch = {},
}: {
    tx: DbTransaction;
    floor: FieldFloor | null;
    patch?: Record<string, unknown>;
}): Promise<void> {
    if (floor && !(await embeddedParts(tx, floor))) {
        throw new Error(
            `The floor ${floor.itemId}@${floor.versionHash} isn't in this show`,
        );
    }
    const json = await readFieldJson(tx);
    if (!json) throw new Error("Field properties not found");
    const { floor: _previous, ...others } = json;
    const { floor: _ignored, ...extra } = patch;
    const rest = { ...others, ...extra };
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
    if (floor) await markFloorModelInTransaction(tx);
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

/**
 * Writes the field properties JSON, keeping the stored floor and ignoring any `floor` in `json`.
 * Every other field-properties write goes through this: a template, a field file or an edit
 * built from stale properties never drops or changes the floor; only `setFieldFloor` does.
 */
export async function writeFieldJsonKeepingFloorInTransaction({
    tx,
    json,
}: {
    tx: DbTransaction;
    json: string;
}): Promise<string> {
    const stored = floorOfFieldJson(await readFieldJson(tx));
    const { floor: _ignored, ...rest } = JSON.parse(json) as Record<
        string,
        unknown
    >;
    const written = JSON.stringify(stored ? { ...rest, floor: stored } : rest);
    await tx
        .update(schema.field_properties)
        .set({ json_data: written })
        .where(eq(schema.field_properties.id, FIELD_PROPERTIES_ID))
        .run();
    return written;
}
