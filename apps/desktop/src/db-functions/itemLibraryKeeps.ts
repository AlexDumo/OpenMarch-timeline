import { sql } from "drizzle-orm";
import * as schema from "@om-electron/database/migrations/schema";
import type { DbConnection, DbTransaction } from "./types";

/*
 * Item reads the main process runs too (the show Library prune on close and before Save Copy):
 * they import only the schema, never the renderer's stores or database.
 */

/** Whether the file has table `name`: the item tables come with timeline-only migrations. */
const hasTable = async (db: DbConnection | DbTransaction, name: string) =>
    !!(
        await db
            .select({ n: sql<number>`count(*)` })
            .from(sql`sqlite_schema`)
            .where(sql`type = 'table' AND name = ${name}`)
            .get()
    )?.n;

/**
 * Library references in use by the Item tables, for the save prune to keep (ADR 0002 D-12,
 * props-spec section 2): each distinct `(itemId, versionHash)` an item's model pins (C2.1) or an
 * Artwork slot assignment names (C2.4), dormant assignments included, sorted. Each keeps exactly
 * that Version. Cues and Uniforms add their own references.
 */
export async function itemLibraryKeeps({
    db,
}: {
    db: DbConnection | DbTransaction;
}): Promise<{ itemId: string; versionHash: string }[]> {
    const pinned = async (
        name: string,
        table: typeof schema.items | typeof schema.item_artwork_slots,
    ) =>
        // A page-era file has no item tables, and keeps nothing for items
        (await hasTable(db, name))
            ? db
                  .selectDistinct({
                      itemId: table.library_item_id,
                      versionHash: table.library_version_hash,
                  })
                  .from(table)
                  .where(
                      sql`${table.library_item_id} IS NOT NULL AND ${table.library_version_hash} IS NOT NULL`,
                  )
                  .all()
            : [];
    const refs = new Map<string, { itemId: string; versionHash: string }>();
    for (const { itemId, versionHash } of [
        ...(await pinned("items", schema.items)),
        ...(await pinned("item_artwork_slots", schema.item_artwork_slots)),
    ])
        if (itemId && versionHash)
            refs.set(`${itemId}@${versionHash}`, { itemId, versionHash });
    return [...refs.values()].sort(
        (a, b) =>
            a.itemId.localeCompare(b.itemId) ||
            a.versionHash.localeCompare(b.versionHash),
    );
}
