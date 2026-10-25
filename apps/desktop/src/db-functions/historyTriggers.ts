// cspell:ignore fullkey
/**
 * The undo/redo history triggers: which tables have them, and how they are built, created and
 * dropped. Split from `history.ts` so the main process and its convert-on-open worker (P9.8) can
 * load them without the renderer modules `history.ts` imports. `history.ts` re-exports them.
 */
import { getTableName, sql } from "drizzle-orm";
import * as schema from "@om-electron/database/migrations/schema";
import type { DB } from "../global/database/db";
import { Constants } from "../global/Constants";
import { mainProcessLog } from "../utilities/mainProcessLog";
import type { DbConnection, DbTransaction } from "./types";

export type HistoryType = "undo" | "redo";

export const tablesWithHistory = [
    schema.beats,
    schema.pages,
    schema.measures,
    schema.marchers,
    schema.field_properties,
    schema.section_appearances,
    schema.utility,
    schema.tags,
    schema.tag_appearances,
    schema.marcher_tags,
    // The show's 3D View venue (ADR 0002 D-5)
    schema.view3d_venue,
    // Timeline data tables (ADR 0001 §3, spec §6.1). `timeline_change_log` is bookkeeping and
    // gets no history triggers.
    schema.timelines,
    schema.timeline_shapes,
    schema.timeline_transitions,
    schema.timeline_assignments,
    schema.timeline_slot_destinations,
    // App data beside them: which assignments are kept spots (ADR 0001 amendment 2026-10-09)
    schema.timeline_kept_assignments,
    // Performer cues (ADR 0004 D-5)
    schema.phrase_assets,
    schema.cues,
    schema.cue_marchers,
    schema.page_performer_settings,
    // Items and their Outline changes (ADR 0002 D-10)
    schema.items,
    schema.item_geometry,
    // Where each item is (ADR 0002 D-10), its holders and crew after their change
    schema.item_placements,
    schema.item_placement_marchers,
    // Which Artwork sits on each item slot (ADR 0002 D-10)
    schema.item_artwork_slots,
];

/**
 * Tables with "scoped" history: a write to them is recorded only when the write asks for it, by
 * logging its own undo statement (`recordWorkspaceSettingsUndoInTransaction`). They have no
 * standing triggers, because many of their writers run outside `transactionWithHistory` and would
 * otherwise join the last edit's undo entry. Undo and redo still create triggers on them while
 * replaying, so the inverse lands on the other stack, and drop them afterwards
 * (`switchTriggerMode` in history.ts). docs/tempo/adr-synced-counts.md.
 */
export const tablesWithScopedHistory: readonly string[] = [
    getTableName(schema.workspace_settings),
];

/**
 * The JSON column of a scoped-history table. Its history restores only the top-level keys an edit
 * changed (`scopedRestoreStatementSql`), so undoing or redoing an edit leaves alone keys that
 * writers without history changed since then.
 */
export const scopedHistoryJsonColumn = "json_data";

/**
 * An SQL expression that evaluates to the statement putting a scoped-history row back as it was:
 * every column but the JSON one as `old<column>` has it (`old` is a prefix such as `old.`), and in
 * the JSON column only the top-level keys whose values differ between `old<json>` and `newJson`
 * (an SQL expression), back to their old values; keys the old JSON doesn't have are removed.
 * Other keys are left as they are when the statement runs.
 */
export const scopedRestoreStatementSql = (
    tableName: string,
    columnNames: readonly string[],
    old: string,
    newJson: string,
): string => {
    const column = scopedHistoryJsonColumn;
    const oldJson = `${old}"${column}"`;
    const removed = `(SELECT group_concat(',' || quote(n.fullkey), '') FROM json_each(${newJson}) n
        WHERE json_type(${oldJson}, n.fullkey) IS NULL)`;
    const restored = `(SELECT group_concat(',' || quote(o.fullkey) || ',json(' || quote(${oldJson} -> o.fullkey) || ')', '')
        FROM json_each(${oldJson}) o WHERE (${newJson} -> o.fullkey) IS NOT (${oldJson} -> o.fullkey))`;
    const others = columnNames
        .filter((c) => c !== column)
        .map((c) => `,"${c}"='||quote(${old}"${c}")||'`)
        .join("");
    return `'UPDATE "${tableName}" SET "${column}"=json_set(json_remove("${column}"' || coalesce(${removed}, '')
        || ')' || coalesce(${restored}, '') || ')${others} WHERE rowid=' || ${old}rowid`;
};

/**
 * The update trigger for a scoped-history table, used while undo or redo replays it: it logs the
 * inverse of the change with `scopedRestoreStatementSql`, so the redo of an undo (and the undo of
 * a redo) restores only the keys the edit's own undo statement does.
 */
function buildScopedHistoryUpdateTriggerSql(
    tableName: string,
    columnNames: readonly string[],
    type: HistoryType,
    sideEffect: string,
): string {
    const historyTableName =
        type === "undo"
            ? Constants.UndoHistoryTableName
            : Constants.RedoHistoryTableName;
    const groupColumn = type === "undo" ? "cur_undo_group" : "cur_redo_group";
    const statement = scopedRestoreStatementSql(
        tableName,
        columnNames,
        "old.",
        `new."${scopedHistoryJsonColumn}"`,
    );
    return `CREATE TRIGGER IF NOT EXISTS '${historyTriggerNames(tableName).update}' AFTER UPDATE ON "${tableName}"
        BEGIN
        INSERT INTO ${historyTableName} ("sequence" , "history_group", "sql")
            VALUES(NULL, (SELECT ${groupColumn} FROM history_stats), ${statement});
        ${sideEffect}
    END;`;
}

/**
 * Creates triggers for a table to record undo/redo history in the database.
 * These actions happen automatically when a row is inserted, updated, or deleted.
 *
 * @param db The database connection
 * @param tableName name of the table to create triggers for
 */
export async function createUndoTriggers(
    db: DbConnection | DB,
    tableName: string,
) {
    await createTriggers(db, tableName, "undo", true);
}

/**
 * Creates triggers for all tables in the database that are not undo/redo history tables.
 *
 * @param db The database connection
 */
export async function createAllUndoTriggers(db: DbConnection | DB) {
    // Only the tables the file has: a page-era file gets the tables the timeline-only migrations
    // add (the performer cues) when it converts, and the conversion creates their triggers. A
    // table that isn't there can't be edited, so it needs no history.
    const rows = await db.all<{ name: string } | [string]>(
        sql`SELECT name FROM sqlite_schema WHERE type = 'table'`,
    );
    const existing = new Set(
        rows.map((row) => (Array.isArray(row) ? row[0] : row.name)),
    );
    // await db.transaction(async (tx) => {
    const promises: Promise<void>[] = [];
    for (const table of tablesWithHistory) {
        const name = getTableName(table);
        if (existing.has(name)) promises.push(createUndoTriggers(db, name));
    }
    await Promise.all(promises);
    // });
}

/**
 * Drops the triggers for a table if they exist. I.e. disables undo tracking for the given table.
 *
 * @param db database connection
 * @param tableName name of the table to drop triggers for
 */
export async function dropUndoTriggers(
    db: DbConnection | DB | DbTransaction,
    tableName: string,
) {
    await db.run(sql.raw(`DROP TRIGGER IF EXISTS "${tableName}_it";`));
    await db.run(sql.raw(`DROP TRIGGER IF EXISTS "${tableName}_ut";`));
    await db.run(sql.raw(`DROP TRIGGER IF EXISTS "${tableName}_dt";`));
}

/**
 * Drops all undo triggers from all user tables in the database.
 * Excludes SQLite internal tables and history/undo/redo tables.
 *
 * @param db database connection
 */
export async function dropAllUndoTriggers(db: DbConnection | DB) {
    for (const table of tablesWithHistory) {
        const name = getTableName(table);
        await dropUndoTriggers(db, name);
    }
}

const historyTriggerNames = (tableName: string) => ({
    insert: `${tableName}_it`,
    update: `${tableName}_ut`,
    delete: `${tableName}_dt`,
});

/**
 * Builds the three history triggers for a table. It is pure, so tests can also build the
 * triggers an older file would hold, such as ones from before a column was added.
 *
 * @param tableName name of the table the triggers are on
 * @param columnNames the table's columns, in `pragma_table_info` order
 * @param type either "undo" or "redo"
 * @param deleteRedoRows see `createTriggers`
 * @returns the `CREATE TRIGGER IF NOT EXISTS` statements
 */
export function buildHistoryTriggerSql(
    tableName: string,
    columnNames: readonly string[],
    type: HistoryType,
    deleteRedoRows: boolean = true,
): { insert: string; update: string; delete: string } {
    const names = historyTriggerNames(tableName);
    const historyTableName =
        type === "undo"
            ? Constants.UndoHistoryTableName
            : Constants.RedoHistoryTableName;
    const groupColumn = type === "undo" ? "cur_undo_group" : "cur_redo_group";

    // When the triggers are in undo mode, we need to delete all of the items from the redo table once an item is entered in the redo table
    const sideEffect =
        type === "undo" && deleteRedoRows
            ? `DELETE FROM ${Constants.RedoHistoryTableName};
            UPDATE ${Constants.HistoryStatsTableName} SET "cur_redo_group" = 0;`
            : "";

    // INSERT trigger
    const insertTrigger = `CREATE TRIGGER IF NOT EXISTS '${names.insert}'
        AFTER INSERT ON "${tableName}"
        BEGIN
            INSERT INTO ${historyTableName} ("sequence" , "history_group", "sql")
            VALUES(
                NULL,
                (SELECT ${groupColumn} FROM history_stats),
                'DELETE FROM "${tableName}" WHERE rowid=' || NEW.rowid
            );
            ${sideEffect}
        END;`;

    // UPDATE trigger
    const updateTrigger = `CREATE TRIGGER IF NOT EXISTS '${names.update}' AFTER UPDATE ON "${tableName}"
        BEGIN
        INSERT INTO ${historyTableName} ("sequence" , "history_group", "sql")
            VALUES(
                NULL,
                (SELECT ${groupColumn} FROM history_stats),
                'UPDATE "${tableName}" SET ${columnNames
                    .map((c) => `"${c}"='||quote(old."${c}")||'`)
                    .join(",")} WHERE rowid='||old.rowid);
        ${sideEffect}
    END;`;

    // DELETE trigger
    const deleteTrigger = `CREATE TRIGGER IF NOT EXISTS '${names.delete}' BEFORE DELETE ON "${tableName}"
        BEGIN
        INSERT INTO ${historyTableName} ("sequence" , "history_group", "sql")
        VALUES(NULL, (
            SELECT ${groupColumn} FROM history_stats),
            'INSERT INTO "${tableName}" (${columnNames
                .map((c) => `"${c}"`)
                .join(",")}) VALUES (${columnNames
                .map((c) => `'||quote(old."${c}")||'`)
                .join(",")})');
          ${sideEffect}
      END;`;

    return {
        insert: insertTrigger,
        update: tablesWithScopedHistory.includes(tableName)
            ? buildScopedHistoryUpdateTriggerSql(
                  tableName,
                  columnNames,
                  type,
                  sideEffect,
              )
            : updateTrigger,
        delete: deleteTrigger,
    };
}

/** `db.all` returns rows as objects or, through the proxy, as arrays in SELECT order. */
const rowValue = (row: unknown, index: number, key: string): unknown =>
    Array.isArray(row) ? row[index] : (row as Record<string, unknown>)[key];

/**
 * The columns a history trigger copies from `old`. The update and delete triggers both quote
 * every column as `old."<column>"`.
 */
const columnsInHistoryTrigger = (triggerSql: string): Set<string> =>
    new Set(Array.from(triggerSql.matchAll(/old\."([^"]+)"/g), (m) => m[1]));

/**
 * Drops a table's history triggers when their column list no longer matches the table.
 *
 * The triggers are stored in the file and created with `IF NOT EXISTS`, so a file that had them
 * before a migration added a column (such as `marchers.home_x`/`home_y` in 0017) would keep
 * triggers that don't record the new column, and undo would silently skip it. Dropping them lets
 * `createTriggers` rebuild them from the current `pragma_table_info`. Triggers that match are
 * left alone, whichever mode (undo or redo) they are in.
 *
 * @returns true if stale triggers were dropped
 */
async function dropStaleHistoryTriggers(
    db: DbConnection | DB | DbTransaction,
    tableName: string,
    columnNames: readonly string[],
): Promise<boolean> {
    const names = historyTriggerNames(tableName);
    const rows = (await db.all(
        sql`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ${tableName} AND name IN (${names.update}, ${names.delete});`,
    )) as unknown[];

    const expected = new Set(columnNames);
    const isStale = rows.some((row) => {
        const actual = columnsInHistoryTrigger(
            String(rowValue(row, 1, "sql") ?? ""),
        );
        return (
            actual.size !== expected.size ||
            [...expected].some((c) => !actual.has(c))
        );
    });
    if (isStale) {
        mainProcessLog(
            "info",
            `Recreating history triggers for "${tableName}": its columns changed`,
        );
        await dropUndoTriggers(db, tableName);
    }
    return isStale;
}

/**
 * Creates triggers for a table to insert undo/redo history.
 *
 * Existing triggers are kept (`IF NOT EXISTS`) unless their column list no longer matches the
 * table; then they are dropped and recreated (see `dropStaleHistoryTriggers`).
 *
 * @param db The database connection
 * @param tableName name of the table to create triggers for
 * @param type either "undo" or "redo"
 * @param deleteRedoRows True if the redo rows should be deleted when inserting new undo rows.
 * This is only used when switching to "undo" mode.
 * The default behavior of the application has this to true so that the redo history is cleared when a new undo action is inserted.
 * It should be false when a redo is being performed and there are triggers inserting into the undo table.
 * @param onConnection True to create the triggers on `db` itself, as every other statement here is.
 * Required inside a transaction (`db` is then the transaction): the renderer's default path runs
 * them on a separate connection, which would wait on the transaction's lock.
 */
export async function createTriggers(
    db: DbConnection | DB | DbTransaction,
    tableName: string,
    type: HistoryType,
    deleteRedoRows: boolean = true,
    onConnection: boolean = false,
) {
    const forbiddenTables = new Set<string>([
        Constants.UndoHistoryTableName,
        Constants.RedoHistoryTableName,
        Constants.HistoryStatsTableName,
    ]);

    if (forbiddenTables.has(tableName))
        throw new Error(
            `Cannot create triggers for ${tableName} as it is a forbidden table`,
        );

    const columns = (await db.all(
        sql`SELECT name FROM pragma_table_info(${tableName});`,
    )) as { name: string }[];

    const columnNames = columns.map((c) => {
        let columnName: string;
        if (Array.isArray(c)) columnName = c[0];
        else if (typeof c === "object") columnName = c.name;
        else throw new Error(`Unknown column type: ${typeof c}`);
        return columnName;
    });

    // A scoped table's update trigger copies only its JSON column, which the column check would
    // take as stale. Its triggers exist only while undo or redo replays, which drops them first.
    if (!tablesWithScopedHistory.includes(tableName))
        await dropStaleHistoryTriggers(db, tableName, columnNames);

    const triggers = buildHistoryTriggerSql(
        tableName,
        columnNames,
        type,
        deleteRedoRows,
    );

    // This had to be done because using the drizzle proxy led to SQLITE syntax errors
    // Likely, because drizzle tries to prepare the SQL statement and then execute it.
    // Tests, the main process and its workers (convert on open) have no renderer bridge, and run
    // the statement on their own `node:sqlite` connection.
    const runDirectly =
        onConnection ||
        (typeof process !== "undefined" && process.env.VITEST) ||
        typeof window === "undefined";
    for (const triggerSql of [
        triggers.insert,
        triggers.update,
        triggers.delete,
    ]) {
        if (runDirectly) await db.run(sql.raw(triggerSql));
        else await window.electron.unsafeSqlProxy(triggerSql);
    }
}
