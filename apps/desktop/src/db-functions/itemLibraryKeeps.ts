import { sql } from "drizzle-orm";
import * as schema from "@om-electron/database/migrations/schema";
import type { DbConnection, DbTransaction } from "./types";

/*
 * Item reads the main process runs too (the show Library prune on close and before Save Copy):
 * they import only the schema, never the renderer's stores or database.
 */

/** Whether the file has the item tables: a page-era file gets them when it converts. */
export const hasItemTables = async (db: DbConnection | DbTransaction) =>
    !!(
        await db
            .select({ n: sql<number>`count(*)` })
            .from(sql`sqlite_schema`)
            .where(sql`type = 'table' AND name = 'item_geometry'`)
            .get()
    )?.n;

/**
 * The Library Versions items pin, for the show Library's prune to keep (C1.11, props-spec
 * section 2). Shaped like the prune's `LibraryKeep`.
 */
export async function itemLibraryKeeps({
    db,
}: {
    db: DbConnection | DbTransaction;
}): Promise<{ itemId: string; versionHash: string }[]> {
    // A page-era file has no item tables, and keeps nothing for items
    if (!(await hasItemTables(db))) return [];
    const rows = await db
        .selectDistinct({
            itemId: schema.items.library_item_id,
            versionHash: schema.items.library_version_hash,
        })
        .from(schema.items)
        .where(sql`${schema.items.library_item_id} IS NOT NULL`)
        .orderBy(
            schema.items.library_item_id,
            schema.items.library_version_hash,
        )
        .all();
    return rows.flatMap((r) =>
        r.itemId && r.versionHash
            ? [{ itemId: r.itemId, versionHash: r.versionHash }]
            : [],
    );
}
