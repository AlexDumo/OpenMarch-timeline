/**
 * Convert on open for the show's floor (ADR 0002 D-23). A show with a legacy field image
 * (`field_properties.image`) and no floor gets one: the image goes through the Artwork pipeline
 * as a Base floor (the caller's `makeFloor`), is embedded in the show, and is named in the field
 * properties; the column is then cleared. It is quiet, outside undo history like the timeline
 * conversion, and never touches the local Library. A file that gets a floor is written as the
 * floor-model version (9), so an older build refuses it; a file with no field image keeps its
 * version, so opening it to look never changes it.
 *
 * Content decides, not the version: a 9 that still holds an image (such as a repaired copy of an
 * 8) converts too. A page-model file (7) is left for the timeline conversion, which runs first.
 *
 * An image that can't become a floor stays in the file, and the field keeps drawing it
 * (`getFieldImage`). It is tried once per image each time the app runs, and the failure is
 * logged once, so reopening the show doesn't repeat the work or the log.
 */
import type { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { FieldProperties, type FieldFloor } from "@openmarch/core";
import {
    embedLibraryVersionInTransaction,
    ShowLibraryMetadataSchema,
    type EmbedLibraryVersion,
} from "@/db-functions/showLibrary";
import { LIBRARY_LIMITS } from "@/view3d/library/protocol";
import {
    floorOfFieldJson,
    markFloorModelInTransaction,
    parseFieldJson,
    readFieldJson,
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
    /**
     * The image couldn't become a floor; the file is unchanged and the field keeps drawing the
     * image. The app tries it again the next time it runs.
     */
    | "failed";

/** Images that couldn't become a floor while the app has been running, by their bytes' hash. */
const failedImages = new Set<string>();

async function imageKey(image: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(image));
    return Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
    ).join("");
}

/** Forgets earlier failures, for tests. */
export function resetFieldImageFailures(): void {
    failedImages.clear();
}

interface FieldRow {
    json_data: string;
    image: Uint8Array | null;
}

export async function convertFieldImageOnOpen(
    db: DatabaseSync,
    { makeFloor }: { makeFloor: MakeFloor },
): Promise<FieldImageConversion> {
    const version = readUserVersion(db);
    if (version < TIMELINE_MODEL_USER_VERSION) return "none";

    const row = db
        .prepare("SELECT json_data, image FROM field_properties WHERE id = 1")
        .get() as FieldRow | undefined;
    const json = row ? parseFieldJson(row.json_data) : null;
    const hasImage = !!row?.image && row.image.byteLength > 0;
    const hasFloor = floorOfFieldJson(json) !== null;

    // Without readable field properties there's no size for a floor: keep the image for later
    if (hasImage && !hasFloor && !json) return "failed";

    if (!hasImage) {
        // A floor in a file below 9 (written back by hand, say) still keeps older builds out
        if (hasFloor && version < FLOOR_MODEL_USER_VERSION)
            await (getOrm(db) as unknown as DbConnection).transaction(
                markFloorModelInTransaction,
            );
        // Otherwise the file stays exactly as it was, version and all
        return "none";
    }

    let floor: EmbedLibraryVersion | null = null;
    if (!hasFloor && json) {
        const image = new Uint8Array(row!.image!);
        const key = await imageKey(image);
        if (failedImages.has(key)) return "failed";
        try {
            floor = await makeFloor(image, new FieldProperties(json as never));
        } catch (error) {
            failedImages.add(key);
            console.error(
                "Couldn't make the field image into a floor; the field keeps drawing it",
                error,
            );
            return "failed";
        }
    }
    if (hasFloor)
        // An older build wrote an image into a file that has a floor, which wins (D-23)
        console.warn(
            "Clearing a field image written beside the show's floor by an older build",
        );

    const orm = getOrm(db) as unknown as DbConnection;
    const hadUndoTriggers = await hasFieldUndoTriggers(orm);
    await orm.transaction(async (tx: DbTransaction) => {
        await installFloorInTransaction(tx, floor, { hadUndoTriggers });
        // Installing a floor writes 9 itself; a floor already there keeps it
        if (hasFloor) await markFloorModelInTransaction(tx);
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
 * Embeds `floor` (when given), names it in the field properties (which writes the floor-model
 * version) and clears the legacy image, none of it undoable: the person never made this edit.
 * Puts back only the undo triggers the file had.
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
    const json = await readFieldJson(db);
    if (!json) throw new Error("Field properties not found");
    const floor = await makeFloor(image, new FieldProperties(json as never));
    const hadUndoTriggers = await hasFieldUndoTriggers(db);
    await db.transaction((tx) =>
        installFloorInTransaction(tx, floor, { hadUndoTriggers }),
    );
    return { itemId: floor.itemId, versionHash: floor.versionHash };
}

/** The most a copied floor's parts may hold: an Artwork original plus its display and sidecar. */
const MAX_FLOOR_VERSION_BYTES = LIBRARY_LIMITS.artworkBytes + 64 * 1024 * 1024;

const FloorVersionSchema = z.object({
    itemId: z.string().min(1),
    versionHash: z.string().length(64),
    kind: z.literal("artwork"),
    name: z.string().min(1),
    builtIn: z.boolean(),
    metadata: ShowLibraryMetadataSchema,
    pins: z.array(z.object({ itemId: z.string(), versionHash: z.string() })),
    parts: z.record(z.string(), z.instanceof(Uint8Array)),
});

/** A floor Version that came over IPC, checked; throws when it isn't one. */
export function parseFloorVersion(value: unknown): EmbedLibraryVersion {
    const version = FloorVersionSchema.parse(value);
    const total = Object.values(version.parts).reduce(
        (n, part) => n + part.byteLength,
        0,
    );
    if (total === 0 || total > MAX_FLOOR_VERSION_BYTES)
        throw new Error("Not a floor");
    return version;
}

/**
 * Makes a previous show's floor Version the open show's floor as it is: same item, Version,
 * name and license (`newShow:setFloorFromVersion`). Outside undo history, like
 * `setFloorFromImage`. Throws, writing nothing, when the parts don't match the Version.
 */
export async function setFloorFromVersion(
    db: DbConnection,
    floor: EmbedLibraryVersion,
): Promise<FieldFloor> {
    if (floor.kind !== "artwork") throw new Error("A floor is Artwork");
    const hadUndoTriggers = await hasFieldUndoTriggers(db);
    await db.transaction((tx) =>
        installFloorInTransaction(tx, floor, { hadUndoTriggers }),
    );
    return { itemId: floor.itemId, versionHash: floor.versionHash };
}
