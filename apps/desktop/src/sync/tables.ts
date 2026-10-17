/**
 * Which tables sync, what their columns are, and the SQL that turns a row into a JSON image.
 *
 * Every table in `tablesWithHistory` syncs (CONTRACT.md, "Scope"). All of them have an
 * `INTEGER PRIMARY KEY`, so the rowid is the key: `id` for most, `assignment_id` for
 * `timeline_kept_assignments` and `page_id` for `page_performer_settings`. `readSyncedTables`
 * checks that and refuses a table without one.
 */
import { getTableName, sql } from "drizzle-orm";
import { tablesWithHistory } from "@/db-functions/historyTriggers";
import type { DbConnection, DbTransaction } from "@/db-functions/types";

export type SyncDb = DbConnection | DbTransaction;

export interface SyncedColumn {
    name: string;
    /** Declared type, upper case */
    type: string;
}

export interface SyncedTable {
    name: string;
    /** The rowid-alias primary key column */
    key: string;
    /** Every column but BLOB ones, in table order (blobs are out of scope) */
    columns: SyncedColumn[];
    /** Synced or not, the tables this one's foreign keys point at */
    parents: string[];
}

/** The synced table names, in `tablesWithHistory` order (`readSyncedTables` sorts them parents first). */
export const syncedTableNames = (): string[] =>
    tablesWithHistory.map((t) => getTableName(t));

/** `db.all` returns rows as objects or, through the proxy, as arrays in SELECT order. */
export const rowValue = (row: unknown, index: number, key: string): unknown =>
    Array.isArray(row) ? row[index] : (row as Record<string, unknown>)[key];

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
export { quoteIdent };

/**
 * The synced tables this file has, with their columns. A page-era file lacks some (the cues);
 * only timeline files are collaborative, but the check costs nothing.
 */
export async function readSyncedTables(db: SyncDb): Promise<SyncedTable[]> {
    const existingRows = (await db.all(
        sql`SELECT name FROM main.sqlite_schema WHERE type = 'table'`,
    )) as unknown[];
    const existing = new Set(
        existingRows.map((r) => String(rowValue(r, 0, "name"))),
    );
    const out: SyncedTable[] = [];
    for (const name of syncedTableNames()) {
        if (!existing.has(name)) continue;
        const info = (await db.all(
            sql`SELECT name, type, pk FROM pragma_table_info(${name})`,
        )) as unknown[];
        const cols = info.map((r) => ({
            name: String(rowValue(r, 0, "name")),
            type: String(rowValue(r, 1, "type") ?? "").toUpperCase(),
            pk: Number(rowValue(r, 2, "pk") ?? 0),
        }));
        const pks = cols.filter((c) => c.pk > 0);
        if (pks.length !== 1 || pks[0]!.type !== "INTEGER")
            throw new Error(
                `Synced table ${name} has no INTEGER PRIMARY KEY, so its rowid is not stable`,
            );
        const fks = (await db.all(
            sql`SELECT "table" FROM pragma_foreign_key_list(${name})`,
        )) as unknown[];
        out.push({
            name,
            key: pks[0]!.name,
            columns: cols
                .filter((c) => c.type !== "BLOB")
                .map(({ name, type }) => ({ name, type })),
            parents: [
                ...new Set(fks.map((r) => String(rowValue(r, 0, "table")))),
            ].filter((p) => p !== name),
        });
    }
    return parentsFirst(out);
}

/**
 * Orders tables so every table comes after the tables its foreign keys point at. Inserts must go
 * in this order: the timeline `BEFORE INSERT` triggers look up parent rows at once, whatever the
 * foreign key setting (the server's `generated/tables.json` `order` is the same rule).
 */
function parentsFirst(tables: SyncedTable[]): SyncedTable[] {
    const byName = new Map(tables.map((t) => [t.name, t]));
    const out: SyncedTable[] = [];
    const state = new Map<string, "visiting" | "done">();
    const visit = (t: SyncedTable) => {
        const s = state.get(t.name);
        if (s === "done") return;
        if (s === "visiting")
            throw new Error(`Foreign key cycle through ${t.name}`);
        state.set(t.name, "visiting");
        for (const p of t.parents) {
            const parent = byName.get(p);
            if (parent) visit(parent);
        }
        state.set(t.name, "done");
        out.push(t);
    };
    for (const t of tables) visit(t);
    return out;
}

/**
 * `json_object(...)` over a row's columns. REAL values are printed with 17 significant digits,
 * so they parse back to the same double (SQLite's JSON uses 15), as the timeline change log does.
 */
export function rowImageSql(table: SyncedTable, alias: string): string {
    const parts = table.columns.map((c) => {
        const ref = `${alias}.${quoteIdent(c.name)}`;
        return `'${c.name}', CASE typeof(${ref}) WHEN 'real' THEN json(printf('%!.17g', ${ref})) ELSE ${ref} END`;
    });
    return `json_object(${parts.join(", ")})`;
}
