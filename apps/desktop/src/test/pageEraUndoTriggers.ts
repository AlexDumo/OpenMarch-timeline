import { getTableName, sql } from "drizzle-orm";
import {
    createUndoTriggers,
    tablesWithHistory,
} from "@/db-functions/historyTriggers";
import type { DbConnection } from "@/db-functions/types";

/**
 * Creates the undo triggers of the history tables a page-era file has. Such a file stops before
 * the timeline-only migrations, so tables added after them (the shape recipes) aren't there yet:
 * the conversion adds them and their triggers.
 */
export async function createPageEraUndoTriggers(db: DbConnection) {
    const rows = await db.values<[string]>(
        sql`SELECT name FROM sqlite_schema WHERE type = 'table'`,
    );
    const tables = new Set(rows.map(([name]) => name));
    for (const table of tablesWithHistory) {
        const name = getTableName(table);
        if (tables.has(name)) await createUndoTriggers(db, name);
    }
}
