import { eq } from "drizzle-orm";
import * as z from "zod";
import { schema } from "@/global/database/db";
import type { SavedShape } from "@/shapes/library/savedShapes";
import type { DbConnection, DbTransaction } from "./types";

/**
 * The show's copies of the saved shapes it uses (ADR 0006, saved shapes; #353). The user's
 * library keeps saved shapes across shows; a copy here lets the show open with them on a machine
 * whose library doesn't have them. The table is outside undo history: saving a shape isn't a
 * drill edit, so undo and redo never change it.
 */

const table = schema.saved_shapes;

const IntervalsSchema = z.record(z.string(), z.number().finite());

/**
 * Every saved shape the show has a copy of, oldest first. A row that doesn't parse is skipped
 * with a warning, so one bad row never stops a show from opening.
 */
export async function getShowSavedShapes({
    db,
}: {
    db: DbConnection | DbTransaction;
}): Promise<SavedShape[]> {
    const rows = await db
        .select()
        .from(table)
        .orderBy(table.created_at, table.id)
        .all();
    return rows.flatMap((row) => {
        let intervals: unknown;
        try {
            intervals = JSON.parse(row.intervals);
        } catch {
            intervals = null;
        }
        const parsed = IntervalsSchema.safeParse(intervals);
        if (!parsed.success) {
            console.warn(`Skipping saved shape ${row.id}`, parsed.error);
            return [];
        }
        return [
            {
                id: row.id,
                name: row.name,
                kind: row.kind,
                kindVersion: row.kind_version,
                intervals: parsed.data,
            },
        ];
    });
}

/** Copies `shape` into the show, or brings the show's copy up to date with it */
export async function putShowSavedShape({
    db,
    shape,
}: {
    db: DbConnection | DbTransaction;
    shape: SavedShape;
}): Promise<void> {
    const values = {
        name: shape.name,
        kind: shape.kind,
        kind_version: shape.kindVersion,
        intervals: JSON.stringify(shape.intervals),
    };
    await db
        .insert(table)
        .values({ id: shape.id, ...values })
        .onConflictDoUpdate({ target: table.id, set: values })
        .run();
}

/** Deletes the show's copy of saved shape `id`; nothing happens when it has none */
export async function deleteShowSavedShape({
    db,
    id,
}: {
    db: DbConnection | DbTransaction;
    id: string;
}): Promise<void> {
    await db.delete(table).where(eq(table.id, id)).run();
}
