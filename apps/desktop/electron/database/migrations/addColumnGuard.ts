/**
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so the migration runners skip an `ALTER TABLE …
 * ADD COLUMN` whose column the table already has. With `CREATE TABLE IF NOT EXISTS` and `CREATE
 * INDEX IF NOT EXISTS`, that makes a migration safe to run on a file that already took it under
 * another date: a fork build's earlier copy of it, or one that took a later-dated migration first
 * and so needed it re-dated (drizzle runs only migrations dated after a file's newest one).
 *
 * Pure, so the desktop migration service and the web harness share it.
 */

/** Leading `--` comment lines, then `ALTER TABLE <table> ADD [COLUMN] <column>`. */
const ADD_COLUMN =
    /^(?:\s*--[^\n]*\n)*\s*ALTER\s+TABLE\s+[`"]?(\w+)[`"]?\s+ADD\s+(?:COLUMN\s+)?[`"]?(\w+)[`"]?/i;

/** The table and column an `ADD COLUMN` statement adds, or null for any other statement. */
export function addedColumn(
    statement: string,
): { table: string; column: string } | null {
    const match = ADD_COLUMN.exec(statement);
    return match ? { table: match[1]!, column: match[2]! } : null;
}

/**
 * Whether to skip `statement`: an `ADD COLUMN` whose table already has the column.
 * `columnsOf` lists a table's columns now (empty for a missing table).
 */
export function skipsExistingColumn(
    statement: string,
    columnsOf: (table: string) => readonly string[],
): boolean {
    const added = addedColumn(statement);
    if (!added) return false;
    const wanted = added.column.toLowerCase();
    return columnsOf(added.table).some((c) => c.toLowerCase() === wanted);
}
