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
import { sql } from "drizzle-orm";
import { FieldProperties } from "@openmarch/core";
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

    // Put back only what the file had: the open's migrations rebuild every trigger anyway
    const hadUndoTriggers =
        (
            db
                .prepare(
                    "SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name = 'field_properties_ut'",
                )
                .get() as { n: number }
        ).n > 0;

    const orm = getOrm(db) as unknown as DbConnection;
    await orm.transaction(async (tx: DbTransaction) => {
        if (hasImage) {
            // Not an undoable edit: the person never made it
            await dropUndoTriggers(tx, "field_properties");
            if (floor) {
                await embedLibraryVersionInTransaction({ tx, version: floor });
                await setFieldFloorInTransaction({
                    tx,
                    floor: {
                        itemId: floor.itemId,
                        versionHash: floor.versionHash,
                    },
                });
            }
            await tx.run(
                sql`UPDATE field_properties SET image = NULL WHERE id = 1`,
            );
            if (hadUndoTriggers)
                await createUndoTriggers(tx as never, "field_properties");
        }
        if (version < FLOOR_MODEL_USER_VERSION)
            await tx.run(
                sql.raw(`PRAGMA user_version = ${FLOOR_MODEL_USER_VERSION}`),
            );
    });
    return floor ? "converted" : "none";
}
