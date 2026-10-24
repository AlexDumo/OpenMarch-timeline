import { eq, sql } from "drizzle-orm";
import * as z from "zod";
import { schema } from "@/global/database/db";
import {
    readSavedDistribution,
    type SavedDistribution,
} from "@/shapes/distribute/distribution";
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
    /** What the user wrote about it; absent for nothing */
    readonly description?: string;
    /** How it's filled, for a closed kind; absent for an open kind */
    readonly distribution?: SavedDistribution;
    /**
     * When it was saved and last changed, ISO 8601. Library entries saved before shapes kept
     * dates have none; the show's copy always has them.
     */
    readonly createdAt?: string;
    readonly updatedAt?: string;
}

/** A saved shape's intervals as stored, here and in the user's library */
export const SavedShapeIntervalsSchema = z.record(
    z.string(),
    z.number().finite(),
);

/**
 * A saved shape's distribution as stored, read as a recipe's is; one this version can't read is
 * dropped, so the shape fills the kind's own way
 */
export const SavedDistributionSchema = z
    .unknown()
    .transform(readSavedDistribution);

/**
 * A whole saved shape as stored in the user's library. Everything after the intervals is
 * optional, so entries saved before it still read; a distribution that doesn't read is dropped,
 * not the entry.
 */
export const SavedShapeSchema = z.object({
    id: z.string().min(1),
    name: z.string(),
    kind: z.string(),
    kindVersion: z.number().int(),
    intervals: SavedShapeIntervalsSchema,
    description: z.string().optional().catch(undefined),
    distribution: SavedDistributionSchema.optional().catch(undefined),
    createdAt: z.string().optional().catch(undefined),
    updatedAt: z.string().optional().catch(undefined),
});

type RealDatabaseSavedShape = typeof saved_shapes.$inferSelect;

const parseJson = (text: string): unknown => {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};

/**
 * The row as a saved shape; undefined when its intervals don't read. A distribution that doesn't
 * read is left out, so the shape fills the kind's default way.
 */
function realDatabaseSavedShapeToSavedShape(
    row: RealDatabaseSavedShape,
): SavedShape | undefined {
    const parsed = SavedShapeIntervalsSchema.safeParse(
        parseJson(row.intervals),
    );
    if (!parsed.success) {
        console.warn(`Skipping saved shape ${row.id}`, parsed.error);
        return undefined;
    }
    const distribution =
        row.distribution === null
            ? undefined
            : readSavedDistribution(parseJson(row.distribution));
    return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        kindVersion: row.kind_version,
        intervals: parsed.data,
        ...(row.description !== null && { description: row.description }),
        ...(distribution && { distribution }),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
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

/**
 * Creates the show's copy of `shape`, or brings an existing copy up to date with it. The copy
 * takes the shape's own dates; one without dates (an old library entry) is dated now, and an
 * existing copy keeps the day it was created.
 */
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
        description: shape.description ?? null,
        distribution: shape.distribution
            ? JSON.stringify(shape.distribution)
            : null,
        updated_at: shape.updatedAt ?? sql`(CURRENT_TIMESTAMP)`,
    };
    await tx
        .insert(saved_shapes)
        .values({
            id: shape.id,
            ...values,
            ...(shape.createdAt && { created_at: shape.createdAt }),
        })
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
