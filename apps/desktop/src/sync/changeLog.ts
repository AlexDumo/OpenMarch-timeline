/**
 * Reading the session's `sync_change_log` into row changes. No history imports, so
 * `transactionWithHistory` can call it.
 */
import { sql } from "drizzle-orm";
import type { DbTransaction } from "@/db-functions/types";
import { rowValue } from "./tables";
import type { RowChange, RowValues } from "./types";

export interface ChangeLogRow {
    tbl: string;
    row_id: number;
    before: string | null;
    after: string | null;
}

/**
 * Coalesces raw change-log rows into row changes: the first `before` and the last `after` of
 * each row, in the order rows were first touched. A row inserted and deleted in the same edit
 * disappears; an update that ends where it started does too.
 */
export function coalesceLog(logRows: readonly ChangeLogRow[]): RowChange[] {
    const byRow = new Map<
        string,
        {
            table: string;
            id: number;
            before: RowValues | null;
            after: RowValues | null;
        }
    >();
    for (const r of logRows) {
        const k = `${r.tbl}:${r.row_id}`;
        const before =
            r.before === null ? null : (JSON.parse(r.before) as RowValues);
        const after =
            r.after === null ? null : (JSON.parse(r.after) as RowValues);
        const seen = byRow.get(k);
        if (seen) seen.after = after;
        else
            byRow.set(k, { table: r.tbl, id: Number(r.row_id), before, after });
    }
    const changes: RowChange[] = [];
    for (const { table, id, before, after } of byRow.values()) {
        if (!before && !after) continue;
        if (!before) changes.push({ kind: "insert", table, id, row: after! });
        else if (!after)
            changes.push({ kind: "delete", table, id, prev: before });
        else {
            const set: RowValues = {};
            const prev: RowValues = {};
            for (const col of new Set([
                ...Object.keys(before),
                ...Object.keys(after),
            ])) {
                if (before[col] !== after[col]) {
                    set[col] = after[col] ?? null;
                    prev[col] = before[col] ?? null;
                }
            }
            if (Object.keys(set).length > 0)
                changes.push({ kind: "update", table, id, set, prev });
        }
    }
    return changes;
}

/**
 * Reads and empties `temp.sync_change_log`, inside the edit's transaction, and returns its rows
 * as coalesced row changes. If the edit rolls back, the log rows roll back with it.
 */
export async function drainSyncChangeLogInTransaction(
    tx: DbTransaction,
): Promise<RowChange[]> {
    const rows = (await tx.all(
        sql.raw(
            `SELECT seq, tbl, row_id, "before", "after" FROM temp.sync_change_log ORDER BY seq`,
        ),
    )) as unknown[];
    if (rows.length === 0) return [];
    await tx.run(sql.raw(`DELETE FROM temp.sync_change_log`));
    return coalesceLog(
        rows.map((r) => ({
            tbl: String(rowValue(r, 1, "tbl")),
            row_id: Number(rowValue(r, 2, "row_id")),
            before: (rowValue(r, 3, "before") as string | null) ?? null,
            after: (rowValue(r, 4, "after") as string | null) ?? null,
        })),
    );
}
