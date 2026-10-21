import { eq } from "drizzle-orm";
import * as z from "zod";
import { schema } from "@/global/database/db";
import type { DbConnection, DbTransaction } from "./types";

/**
 * The show's copies of the saved shapes it uses (ADR 0006, saved shapes; #353). The user's
 * library keeps saved shapes across shows; a copy here lets the show open with them on a machine
 * whose library doesn't have them. The table is outside undo history: saving a shape isn't a
 * drill edit, so these write in a plain transaction, never `transactionWithHistory`.
 */

const { saved_shapes } = schema;

/**
 * A saved shape: a kind and its intervals, under a name. The same record is the user's library
 * entry and the show's copy, by its id.
 */
export interface SavedShape {
    /** Its own id, the same in the user's library and in every show's copy */
    readonly id: string;
    readonly name: string;
    /** The shape kind's id and generator version, as a recipe stores them */
    readonly kind: string;
    readonly kindVersion: number;
    /** Each interval parameter's key to its value, in steps */
    readonly intervals: Readonly<Record<string, number>>;
}

/** A saved shape's intervals as stored, here and in the user's library */
export const SavedShapeIntervalsSchema = z.record(
    z.string(),
    z.number().finite(),
);

/** A whole saved shape as stored in the user's library */
export const SavedShapeSchema = z.object({
    id: z.string().min(1),
    name: z.string(),
    kind: z.string(),
    kindVersion: z.number().int(),
    intervals: SavedShapeIntervalsSchema,
});

type RealDatabaseSavedShape = typeof saved_shapes.$inferSelect;

/** The row as a saved shape; undefined when its intervals don't read */
function realDatabaseSavedShapeToSavedShape(
    row: RealDatabaseSavedShape,
): SavedShape | undefined {
    let intervals: unknown;
    try {
        intervals = JSON.parse(row.intervals);
    } catch {
        intervals = null;
    }
    const parsed = SavedShapeIntervalsSchema.safeParse(intervals);
    if (!parsed.success) {
        console.warn(`Skipping saved shape ${row.id}`, parsed.error);
        return undefined;
    }
    return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        kindVersion: row.kind_version,
        intervals: parsed.data,
    };
}

/**
 * Every saved shape the show has a copy of, oldest first. A row that doesn't parse is skipped
 * with a warning, so one bad row never stops a show from opening.
 */
export async function getSavedShapes({
    db,
}: {
    db: DbConnection | DbTransaction;
}): Promise<SavedShape[]> {
    const rows = await db
        .select()
        .from(saved_shapes)
        .orderBy(saved_shapes.created_at, saved_shapes.id)
        .all();
    return rows.flatMap((row) => realDatabaseSavedShapeToSavedShape(row) ?? []);
}

/** Creates the show's copy of `shape`, or brings an existing copy up to date with it */
export async function createSavedShapeInTransaction({
    tx,
    shape,
}: {
    tx: DbTransaction;
    shape: SavedShape;
}): Promise<void> {
    const values = {
        name: shape.name,
        kind: shape.kind,
        kind_version: shape.kindVersion,
        intervals: JSON.stringify(shape.intervals),
    };
    await tx
        .insert(saved_shapes)
        .values({ id: shape.id, ...values })
        .onConflictDoUpdate({ target: saved_shapes.id, set: values })
        .run();
}

/** Deletes the show's copy of saved shape `id`; nothing happens when it has none */
export async function deleteSavedShapeInTransaction({
    tx,
    id,
}: {
    tx: DbTransaction;
    id: string;
}): Promise<void> {
    await tx.delete(saved_shapes).where(eq(saved_shapes.id, id)).run();
}
