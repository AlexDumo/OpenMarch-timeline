/**
 * Change capture for a collaboration session (CONTRACT.md, "Capture").
 *
 * Everything here is `TEMP`: connection-local, never written to the file, and created only when
 * a session starts. The renderer's SQL all runs on the main process's one persistent connection,
 * so the temp triggers see every renderer write. Solo shows never run any of it.
 *
 * Each synced table gets three triggers that write a JSON before/after image of the changed row,
 * keyed by rowid, to `temp.sync_change_log` while `temp.sync_state.recording` is 1. They fire for
 * foreign-key cascades too, so a deleted marcher's assignments come out as deletes of their own.
 */
import { sql } from "drizzle-orm";
import { withTimelineWriteLock } from "@/db-functions/history";
import type { DbConnection } from "@/db-functions/types";
import {
    quoteIdent,
    readSyncedTables,
    rowImageSql,
    type SyncDb,
    type SyncedTable,
} from "./tables";

const triggerNames = (table: string) => ({
    insert: `${table}_sync_ins`,
    update: `${table}_sync_upd`,
    delete: `${table}_sync_del`,
});

const WHEN = `WHEN (SELECT recording FROM sync_state) = 1`;

/** The three capture triggers for a table, as `CREATE TEMP TRIGGER` statements. */
export function captureTriggerSql(table: SyncedTable): string[] {
    const names = triggerNames(table.name);
    const t = quoteIdent(table.name);
    const log = (rowId: string, before: string, after: string) =>
        `BEGIN INSERT INTO sync_change_log (tbl, row_id, "before", "after") VALUES ('${table.name}', ${rowId}, ${before}, ${after}); END`;
    return [
        `CREATE TEMP TRIGGER ${quoteIdent(names.insert)} AFTER INSERT ON main.${t} ${WHEN} ` +
            log("NEW.rowid", "NULL", rowImageSql(table, "NEW")),
        `CREATE TEMP TRIGGER ${quoteIdent(names.update)} AFTER UPDATE ON main.${t} ${WHEN} ` +
            log(
                "NEW.rowid",
                rowImageSql(table, "OLD"),
                rowImageSql(table, "NEW"),
            ),
        `CREATE TEMP TRIGGER ${quoteIdent(names.delete)} AFTER DELETE ON main.${t} ${WHEN} ` +
            log("OLD.rowid", rowImageSql(table, "OLD"), "NULL"),
    ];
}

async function dropCaptureObjects(db: SyncDb, tableNames: readonly string[]) {
    for (const table of tableNames) {
        const names = triggerNames(table);
        for (const name of [names.insert, names.update, names.delete])
            await db.run(
                sql.raw(`DROP TRIGGER IF EXISTS temp.${quoteIdent(name)}`),
            );
    }
}

/**
 * Creates the temp change log, the recording flag and the capture triggers on every synced table
 * (columns from `pragma_table_info`). Starts recording with an empty log. Safe to call again: it
 * rebuilds everything.
 */
export async function startCapture(db: DbConnection): Promise<void> {
    // Under the write lock, so the DDL can't land inside (and roll back with) someone's edit
    await withTimelineWriteLock(async () => {
        const tables = await readSyncedTables(db);
        await db.run(
            sql.raw(
                `CREATE TEMP TABLE IF NOT EXISTS sync_change_log (seq INTEGER PRIMARY KEY, tbl TEXT NOT NULL, row_id INTEGER NOT NULL, "before" TEXT, "after" TEXT)`,
            ),
        );
        await db.run(
            sql.raw(
                `CREATE TEMP TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY CHECK (id = 1), recording INTEGER NOT NULL)`,
            ),
        );
        await db.run(
            sql.raw(
                `INSERT OR REPLACE INTO temp.sync_state (id, recording) VALUES (1, 1)`,
            ),
        );
        await db.run(sql.raw(`DELETE FROM temp.sync_change_log`));
        await dropCaptureObjects(
            db,
            tables.map((t) => t.name),
        );
        for (const table of tables)
            for (const statement of captureTriggerSql(table))
                await db.run(sql.raw(statement));
    });
}

/** Drops the capture triggers and the temp tables. Unsent log rows are discarded. */
export async function stopCapture(db: DbConnection): Promise<void> {
    await withTimelineWriteLock(async () => {
        const tables = await readSyncedTables(db);
        await dropCaptureObjects(
            db,
            tables.map((t) => t.name),
        );
        await db.run(sql.raw(`DROP TABLE IF EXISTS temp.sync_change_log`));
        await db.run(sql.raw(`DROP TABLE IF EXISTS temp.sync_state`));
    });
}

/** Whether capture is running on this connection. */
export async function isCapturing(db: SyncDb): Promise<boolean> {
    const rows = (await db.all(
        sql.raw(
            `SELECT 1 FROM temp.sqlite_schema WHERE type = 'table' AND name = 'sync_state'`,
        ),
    )) as unknown[];
    return rows.length > 0;
}

/** Turns capture recording on or off; inside a transaction, it rolls back with it. */
export async function setRecording(db: SyncDb, on: boolean): Promise<void> {
    await db.run(
        sql.raw(`UPDATE temp.sync_state SET recording = ${on ? 1 : 0}`),
    );
}
