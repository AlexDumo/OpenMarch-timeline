/**
 * Applying row changes that came from the session (CONTRACT.md, "Remote apply"): a peer's op,
 * the inverse of a refused local op, or a whole snapshot on join.
 *
 * It runs under the same write lock as `transactionWithHistory` and undo, so batches reach the
 * timeline listeners in commit order. It leaves no undo history behind: capture recording is off,
 * and the `history_undo` rows the history triggers wrote are removed again (the triggers also
 * clear the redo stack, which is acceptable: in a session undo is per user). Foreign keys are off,
 * as undo has them, because the changes already hold every cascade the sender's database ran.
 *
 * Nothing above the data layer needs to know where a change came from: the timeline change log
 * is drained and delivered as for any edit, and the caller invalidates `queryKeys`.
 */
import { sql, type SQL } from "drizzle-orm";
import { withTimelineWriteLock } from "@/db-functions/history";
import {
    checkAndDrainTimelineChangesInTransaction,
    emitTimelineChange,
    notifyTimelineBatch,
} from "@/db-functions/timelineChanges";
import {
    bumpTimelineDisplayVersion,
    touchesTimelineDisplayTables,
} from "@/db-functions/timelineDisplay";
import type { DbConnection, DbTransaction } from "@/db-functions/types";
import { tableNamesToQueryKeys } from "@/hooks/queries/utils";
import type { ChangeBatch } from "@openmarch/core";
import { isCapturing, setRecording } from "./capture";
import {
    readSyncedTables,
    rowImageSql,
    rowValue,
    quoteIdent,
    type SyncDb,
    type SyncedTable,
} from "./tables";
import type { RowChange, RowValues, SyncSnapshot } from "./types";

export interface ApplyResult {
    /** The tables a statement actually wrote */
    tables: Set<string>;
    /** `tableNamesToQueryKeys(tables)`, for the caller to invalidate */
    queryKeys: string[][];
}

export interface ApplyOptions {
    /**
     * Fields with a pending local write: they keep the local value (the server's ack brings the
     * final one). For an insert, skipping the key column skips the row.
     */
    skip?: (table: string, id: number, column: string) => boolean;
}

/** The inverse of a list of changes, in reverse order. */
export function invertChanges(changes: readonly RowChange[]): RowChange[] {
    return [...changes].reverse().map((ch): RowChange => {
        if (ch.kind === "insert")
            return { kind: "delete", table: ch.table, id: ch.id, prev: ch.row };
        if (ch.kind === "delete")
            return { kind: "insert", table: ch.table, id: ch.id, row: ch.prev };
        return {
            kind: "update",
            table: ch.table,
            id: ch.id,
            set: ch.prev,
            prev: ch.set,
        };
    });
}

const toParam = (value: unknown): unknown =>
    typeof value === "boolean" ? (value ? 1 : 0) : (value ?? null);

const tableInfoMap = async (db: SyncDb) =>
    new Map((await readSyncedTables(db)).map((t) => [t.name, t]));

const knownColumns = (table: SyncedTable, values: RowValues): string[] => {
    const allowed = new Set(table.columns.map((c) => c.name));
    const cols = Object.keys(values);
    for (const c of cols)
        if (!allowed.has(c))
            throw new Error(
                `Unknown column ${table.name}.${c} in a sync change`,
            );
    return cols;
};

async function rowExists(tx: DbTransaction, table: SyncedTable, id: number) {
    const rows = (await tx.all(
        sql`SELECT 1 FROM ${sql.identifier(table.name)} WHERE rowid = ${id}`,
    )) as unknown[];
    return rows.length > 0;
}

async function updateRow(
    tx: DbTransaction,
    table: SyncedTable,
    id: number,
    values: RowValues,
    cols: readonly string[],
) {
    if (cols.length === 0) return false;
    const assignments: SQL[] = cols.map(
        (c) => sql`${sql.identifier(c)} = ${toParam(values[c])}`,
    );
    await tx.run(
        sql`UPDATE ${sql.identifier(table.name)} SET ${sql.join(assignments, sql`, `)} WHERE rowid = ${id}`,
    );
    return true;
}

async function insertRow(
    tx: DbTransaction,
    table: SyncedTable,
    id: number,
    row: RowValues,
) {
    const values = { ...row, [table.key]: id };
    const cols = knownColumns(table, values);
    await tx.run(
        sql`INSERT INTO ${sql.identifier(table.name)} (${sql.join(
            cols.map((c) => sql.identifier(c)),
            sql`, `,
        )}) VALUES (${sql.join(
            cols.map((c) => sql`${toParam(values[c])}`),
            sql`, `,
        )})`,
    );
}

/** Runs `changes` as statements: upsert-ish insert, update if the row exists, delete if it does. */
async function writeChanges(
    tx: DbTransaction,
    tables: Map<string, SyncedTable>,
    changes: readonly RowChange[],
    skip: NonNullable<ApplyOptions["skip"]>,
): Promise<Set<string>> {
    const touched = new Set<string>();
    for (const ch of changes) {
        const table = tables.get(ch.table);
        if (!table) throw new Error(`${ch.table} is not a synced table`);
        const exists = await rowExists(tx, table, ch.id);
        let wrote = false;
        if (ch.kind === "insert") {
            if (exists) {
                const cols = knownColumns(table, ch.row).filter(
                    (c) => c !== table.key && !skip(ch.table, ch.id, c),
                );
                wrote = await updateRow(tx, table, ch.id, ch.row, cols);
            } else if (!skip(ch.table, ch.id, table.key)) {
                await insertRow(tx, table, ch.id, ch.row);
                wrote = true;
            }
        } else if (ch.kind === "update") {
            if (exists) {
                const cols = knownColumns(table, ch.set).filter(
                    (c) => !skip(ch.table, ch.id, c),
                );
                wrote = await updateRow(tx, table, ch.id, ch.set, cols);
            }
        } else if (exists) {
            await tx.run(
                sql`DELETE FROM ${sql.identifier(table.name)} WHERE rowid = ${ch.id}`,
            );
            wrote = true;
        }
        if (wrote) touched.add(ch.table);
    }
    return touched;
}

/**
 * Runs `write` in one transaction with recording off and foreign keys off, removes the undo rows
 * it caused, drains the timeline change log, and delivers it (`batch`) or a cold build (`reset`).
 */
async function applyWithoutHistory(
    db: DbConnection,
    delivery: "batch" | "reset",
    write: (
        tx: DbTransaction,
        tables: Map<string, SyncedTable>,
    ) => Promise<Set<string>>,
): Promise<ApplyResult> {
    return await withTimelineWriteLock(async () => {
        let committed: { tables: Set<string>; batch: ChangeBatch } | undefined;
        // A no-op inside a transaction, so first (as undo does)
        await db.run(sql.raw("PRAGMA foreign_keys = OFF"));
        try {
            committed = await db.transaction(async (tx) => {
                const capturing = await isCapturing(tx);
                if (capturing) await setRecording(tx, false);
                const seqRow = (await tx.all(
                    sql.raw(
                        `SELECT coalesce(max(sequence), 0) AS s FROM history_undo`,
                    ),
                )) as unknown[];
                const lastUndoSeq = Number(rowValue(seqRow[0], 0, "s") ?? 0);
                const statsRow = (await tx.all(
                    sql.raw(`SELECT cur_undo_group AS g FROM history_stats`),
                )) as unknown[];
                const undoGroup =
                    statsRow.length > 0
                        ? Number(rowValue(statsRow[0], 0, "g"))
                        : undefined;

                const tables = await write(tx, await tableInfoMap(tx));

                // Leave the undo stack exactly as it was
                await tx.run(
                    sql`DELETE FROM history_undo WHERE sequence > ${lastUndoSeq}`,
                );
                if (undoGroup !== undefined)
                    await tx.run(
                        sql`UPDATE history_stats SET cur_undo_group = ${undoGroup}`,
                    );

                const batch =
                    await checkAndDrainTimelineChangesInTransaction(tx);
                if (capturing) await setRecording(tx, true);
                return { tables, batch };
            });
        } finally {
            await db.run(sql.raw("PRAGMA foreign_keys = ON"));
        }
        const { tables, batch } = committed!;
        if (delivery === "reset") {
            emitTimelineChange({ kind: "reset" });
            bumpTimelineDisplayVersion();
        } else {
            notifyTimelineBatch(batch);
            if (touchesTimelineDisplayTables(tables))
                bumpTimelineDisplayVersion();
        }
        return { tables, queryKeys: tableNamesToQueryKeys(tables) };
    });
}

/**
 * Applies changes from the session (a peer's applied op, or an inverse when a local op is
 * refused) without recording them, in their order.
 */
export async function applyRemoteChanges(
    db: DbConnection,
    changes: readonly RowChange[],
    options: ApplyOptions = {},
): Promise<ApplyResult> {
    const skip = options.skip ?? (() => false);
    if (changes.length === 0) return { tables: new Set(), queryKeys: [] };
    return await applyWithoutHistory(db, "batch", (tx, tables) =>
        writeChanges(tx, tables, changes, skip),
    );
}

async function readTableImages(
    db: SyncDb,
    table: SyncedTable,
): Promise<Map<number, RowValues>> {
    const rows = (await db.all(
        sql.raw(
            `SELECT rowid AS id, ${rowImageSql(table, quoteIdent(table.name))} AS img FROM ${quoteIdent(table.name)} ORDER BY rowid`,
        ),
    )) as unknown[];
    return new Map(
        rows.map((r) => [
            Number(rowValue(r, 0, "id")),
            JSON.parse(String(rowValue(r, 1, "img"))) as RowValues,
        ]),
    );
}

/** Every synced table's rows, as JSON images (`{ [table]: row[] }`), ordered by rowid. */
export async function readSyncedSnapshot(db: SyncDb): Promise<SyncSnapshot> {
    const out: SyncSnapshot = {};
    for (const table of await readSyncedTables(db))
        out[table.name] = [...(await readTableImages(db, table)).values()];
    return out;
}

/**
 * Rows the app's triggers refuse to delete (beat 0, page 0, the utility row): a changed one is
 * updated in place instead.
 */
const isProtectedRow = (table: string, id: number) =>
    id === 0 && (table === "beats" || table === "pages" || table === "utility");

/**
 * The changes that turn the current rows into `snapshot`. Rows that already match are not
 * written. A changed row is deleted and inserted again rather than updated: the timeline
 * invariant triggers check each statement against the rows around it (a transition's
 * `slot_count` against its assignments, for example), so updating the tables one after another
 * can pass through states they refuse. All deletes go first (children first), then every insert,
 * parents first; foreign keys are off, so nothing cascades.
 */
async function diffToSnapshot(
    tx: DbTransaction,
    tables: Map<string, SyncedTable>,
    snapshot: SyncSnapshot,
): Promise<RowChange[]> {
    const deletes: RowChange[] = [];
    const updates: RowChange[] = [];
    const inserts: RowChange[] = [];
    for (const [name, table] of tables) {
        const wanted = snapshot[name];
        if (!wanted) continue;
        const current = await readTableImages(tx, table);
        const wantedIds = new Set<number>();
        for (const row of wanted) {
            const id = Number(row[table.key]);
            wantedIds.add(id);
            const have = current.get(id);
            if (!have) {
                inserts.push({ kind: "insert", table: name, id, row });
                continue;
            }
            const set: RowValues = {};
            const prev: RowValues = {};
            for (const col of Object.keys(row))
                if (row[col] !== have[col]) {
                    set[col] = row[col];
                    prev[col] = have[col];
                }
            if (Object.keys(set).length === 0) continue;
            if (isProtectedRow(name, id))
                updates.push({ kind: "update", table: name, id, set, prev });
            else {
                deletes.push({ kind: "delete", table: name, id, prev: have });
                inserts.push({ kind: "insert", table: name, id, row });
            }
        }
        for (const [id, prev] of current)
            if (!wantedIds.has(id))
                deletes.push({ kind: "delete", table: name, id, prev });
    }
    return [...updates, ...deletes.reverse(), ...inserts];
}

/**
 * Join: makes every synced table in `snapshot` hold exactly its rows, without recording, then
 * has the timeline listeners cold-build. Tables missing from the snapshot are left alone.
 */
export async function replaceAllSyncedTables(
    db: DbConnection,
    snapshot: SyncSnapshot,
): Promise<ApplyResult> {
    return await applyWithoutHistory(db, "reset", async (tx, tables) => {
        const changes = await diffToSnapshot(tx, tables, snapshot);
        const touched = await writeChanges(tx, tables, changes, () => false);
        // Every query refreshes on a join, not just the touched tables'
        for (const name of tables.keys()) if (snapshot[name]) touched.add(name);
        return touched;
    });
}
