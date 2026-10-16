/**
 * Convert on open for the show's floor (ADR 0002 D-23). A show with a legacy field image
 * (`field_properties.image`) and no floor gets one: the image goes through the Artwork pipeline
 * as a Base floor (the caller's `makeFloor`), is embedded in the show, and is named in the field
 * properties; the column is then cleared. It is quiet, outside undo history like the timeline
 * conversion, and never touches the local Library. Every timeline file it sees is written as the
 * floor-model version, so an older build refuses it.
 *
 * Content decides, not the version: a 9 that still holds an image (such as a repaired copy of an
 * 8) converts too. A page-model file (7) is left for the timeline conversion, which runs first.
 */
import type { DatabaseSync } from "node:sqlite";
import { eq, sql } from "drizzle-orm";
import * as schema from "./migrations/schema";
import { FieldProperties, type FieldFloor } from "@openmarch/core";
import {
    embedLibraryVersionInTransaction,
    type EmbedLibraryVersion,
} from "@/db-functions/showLibrary";
import {
    floorOfFieldJson,
    setFieldFloorInTransaction,
} from "@/db-functions/fieldFloor";
import {
    createUndoTriggers,
    dropUndoTriggers,
} from "@/db-functions/historyTriggers";
import type { DbConnection, DbTransaction } from "@/db-functions/types";
import { getOrm } from "./db";
import {
    FLOOR_MODEL_USER_VERSION,
    readUserVersion,
    TIMELINE_MODEL_USER_VERSION,
} from "./fileVersion";

/** Turns the legacy image into an embeddable Base floor Version, or throws. */
export type MakeFloor = (
    image: Uint8Array,
    fieldProperties: FieldProperties,
) => Promise<EmbedLibraryVersion>;

export type FieldImageConversion =
    /** The image became the show's floor. */
    | "converted"
    /** Nothing to convert (no image, a floor already, or a page-model file). */
    | "none"
    /** The image couldn't become a floor; the file is unchanged, so the next open retries. */
    | "failed";

interface FieldRow {
    json_data: string;
    image: Uint8Array | null;
}

const parseJson = (text: string): Record<string, unknown> | null => {
    try {
        const parsed: unknown = JSON.parse(text);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
};

export async function convertFieldImageOnOpen(
    db: DatabaseSync,
    { makeFloor }: { makeFloor: MakeFloor },
): Promise<FieldImageConversion> {
    const version = readUserVersion(db);
    if (version < TIMELINE_MODEL_USER_VERSION) return "none";

    const row = db
        .prepare("SELECT json_data, image FROM field_properties WHERE id = 1")
        .get() as FieldRow | undefined;
    const json = row ? parseJson(row.json_data) : null;
    const hasImage = !!row?.image && row.image.byteLength > 0;
    const hasFloor = floorOfFieldJson(json) !== null;

    let floor: EmbedLibraryVersion | null = null;
    if (hasImage && !hasFloor && json) {
        try {
            floor = await makeFloor(
                new Uint8Array(row!.image!),
                new FieldProperties(json as never),
            );
        } catch (error) {
            console.error("Couldn't make the field image into a floor", error);
            return "failed";
        }
    }

    const orm = getOrm(db) as unknown as DbConnection;
    const hadUndoTriggers = await hasFieldUndoTriggers(orm);
    await orm.transaction(async (tx: DbTransaction) => {
        if (hasImage)
            await installFloorInTransaction(tx, floor, { hadUndoTriggers });
        if (version < FLOOR_MODEL_USER_VERSION)
            await tx.run(
                sql.raw(`PRAGMA user_version = ${FLOOR_MODEL_USER_VERSION}`),
            );
    });
    return floor ? "converted" : "none";
}

/** True when the show has `field_properties`' undo triggers, which an opened show does. */
async function hasFieldUndoTriggers(
    db: DbConnection | DbTransaction,
): Promise<boolean> {
    const row = await db
        .select({ n: sql<number>`count(*)` })
        .from(sql`sqlite_master`)
        .where(sql`type = 'trigger' AND name = 'field_properties_ut'`)
        .get();
    return (row?.n ?? 0) > 0;
}

/**
 * Embeds `floor` (when given), names it in the field properties and clears the legacy image,
 * none of it undoable: the person never made this edit. Puts back only the undo triggers the
 * file had.
 */
async function installFloorInTransaction(
    tx: DbTransaction,
    floor: EmbedLibraryVersion | null,
    { hadUndoTriggers }: { hadUndoTriggers: boolean },
): Promise<void> {
    await dropUndoTriggers(tx, "field_properties");
    if (floor) {
        await embedLibraryVersionInTransaction({ tx, version: floor });
        await setFieldFloorInTransaction({
            tx,
            floor: { itemId: floor.itemId, versionHash: floor.versionHash },
        });
    }
    await tx.run(sql`UPDATE field_properties SET image = NULL WHERE id = 1`);
    if (hadUndoTriggers)
        await createUndoTriggers(tx as never, "field_properties");
}

/**
 * Makes `image` the open show's floor, outside undo history, and returns it. For a new show
 * that copies a previous show's field image (`newShow:setFloorFromImage`). Throws, writing
 * nothing, when the image can't become a floor.
 */
export async function setFloorFromImage(
    db: DbConnection,
    image: Uint8Array,
    makeFloor: MakeFloor,
): Promise<FieldFloor> {
    const row = await db
        .select({ json: schema.field_properties.json_data })
        .from(schema.field_properties)
        .where(eq(schema.field_properties.id, 1))
        .get();
    const json = row ? parseJson(row.json) : null;
    if (!json) throw new Error("Field properties not found");
    const floor = await makeFloor(image, new FieldProperties(json as never));
    const hadUndoTriggers = await hasFieldUndoTriggers(db);
    await db.transaction((tx) =>
        installFloorInTransaction(tx, floor, { hadUndoTriggers }),
    );
    return { itemId: floor.itemId, versionHash: floor.versionHash };
}
