/**
 * Session ids (CONTRACT.md, "IDs"): in a session, every new row gets an explicit id from this
 * member's block `[idBase, idBase + 2 ** 40)`, so ids are global and never collide with another
 * member's. Solo, the values pass through untouched and no SQL runs.
 */
import { getTableColumns, getTableName, sql } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { DbTransaction } from "@/db-functions/types";
import { getSyncSession, ID_BLOCK_SIZE } from "./session";
import { quoteIdent, rowValue } from "./tables";

type WithId = { id?: number | null };

/**
 * Gives each row without an `id` the next free id in this member's block, for `table`. Rows that
 * already carry an id (and tables whose key is not `id`, such as `timeline_kept_assignments`,
 * whose key is the assignment it marks) are left as they are.
 *
 * Call it inside the edit's transaction, right before the insert, so it sees rows inserted
 * earlier in the same edit.
 */
export async function withSessionIds<T extends object>(
    tx: DbTransaction,
    table: SQLiteTable,
    values: T[],
): Promise<T[]>;
export async function withSessionIds<T extends object>(
    tx: DbTransaction,
    table: SQLiteTable,
    values: T,
): Promise<T>;
export async function withSessionIds<T extends object>(
    tx: DbTransaction,
    table: SQLiteTable,
    values: T | T[],
): Promise<T | T[]> {
    const session = getSyncSession();
    if (!session) return values;
    const idColumn = (
        getTableColumns(table) as Record<string, { name: string }>
    ).id;
    if (!idColumn) return values;
    const rows = Array.isArray(values) ? values : [values];
    const missing = rows.filter((r) => (r as WithId).id == null);
    if (missing.length === 0) return values;

    const base = session.idBase;
    const col = quoteIdent(idColumn.name);
    const found = (await tx.all(
        sql.raw(
            `SELECT max(${col}) AS m FROM ${quoteIdent(getTableName(table))} WHERE ${col} >= ${base} AND ${col} < ${base + ID_BLOCK_SIZE}`,
        ),
    )) as unknown[];
    const max = found[0] === undefined ? null : rowValue(found[0], 0, "m");
    let next = max == null ? base : Number(max) + 1;
    if (next + missing.length > base + ID_BLOCK_SIZE)
        throw new Error(
            `This member's id block for ${getTableName(table)} is full`,
        );

    const out = rows.map((r) =>
        (r as WithId).id == null ? { ...r, id: next++ } : r,
    );
    return Array.isArray(values) ? out : out[0]!;
}
