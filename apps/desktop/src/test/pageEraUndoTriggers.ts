import { getTableName, sql } from "drizzle-orm";
import {
    createUndoTriggers,
    tablesWithHistory,
} from "@/db-functions/historyTriggers";
import type { DbConnection } from "@/db-functions/types";

/**
 * Creates the undo triggers a page-era release created on open: those of the history tables a
 * page-era file has. Tables the timeline-only migrations add, such as the performer cue tables
 * (ADR 0004 D-5), get theirs when the file converts (`convertFileOnOpen`).
 */
export async function createPageEraUndoTriggers(db: DbConnection) {
    const rows = await db.all<{ name: string } | [string]>(
        sql`SELECT name FROM sqlite_schema WHERE type = 'table'`,
    );
    const existing = new Set(
        rows.map((row) => (Array.isArray(row) ? row[0] : row.name)),
    );
    for (const table of tablesWithHistory) {
        const name = getTableName(table);
        if (existing.has(name)) await createUndoTriggers(db, name);
    }
}
