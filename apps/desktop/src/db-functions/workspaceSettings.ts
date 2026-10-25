import { eq, getTableName, sql } from "drizzle-orm";
import * as z from "zod";
import { DbConnection, DbTransaction } from "./types";
import { withTimelineWriteLock } from "./history";
import { scopedRestoreStatementSql } from "./historyTriggers";
import { schema } from "@/global/database/db";
import {
    type WorkspaceSettings,
    workspaceSettingsSchema,
} from "@/settings/workspaceSettings";
import { Constants } from "@/global/Constants";

export type DatabaseWorkspaceSettings =
    typeof schema.workspace_settings.$inferSelect;

/**
 * Defines the editable fields of the workspace settings record.
 */
export interface ModifiedWorkspaceSettingsArgs {
    json_data?: string;
}

/**
 * Gets the workspace settings record from the database.
 * Since there's only ever one workspace settings record, this returns the single record or undefined.
 */
export async function getWorkspaceSettings({
    db,
}: {
    db: DbConnection;
}): Promise<DatabaseWorkspaceSettings | undefined> {
    // Initialize the workspace settings record if it doesn't exist
    await initializeWorkspaceSettings({ db });

    return await db.query.workspace_settings.findFirst();
}

/**
 * Updates the workspace settings record in the database.
 * Since there's only ever one workspace settings record, this updates the record with id = 1.
 * Note: This does NOT use history tracking (no undo/redo).
 */
export async function updateWorkspaceSettings({
    db,
    args,
}: {
    db: DbConnection;
    args: ModifiedWorkspaceSettingsArgs;
}): Promise<DatabaseWorkspaceSettings> {
    // Under the history lock: a settings write is its own transaction, and one started while an
    // edit's transaction is open (saving a new page length as pages are added, say) would fail
    return withTimelineWriteLock(async () => {
        // Initialize the workspace settings record if it doesn't exist
        await initializeWorkspaceSettings({ db });

        return await db.transaction(async (tx: DbTransaction) => {
            await tx
                .update(schema.workspace_settings)
                .set({
                    ...args,
                    updated_at: new Date().toISOString(),
                })
                .where(eq(schema.workspace_settings.id, 1));

            const updatedSettings =
                await tx.query.workspace_settings.findFirst();
            if (!updatedSettings) {
                throw new Error(
                    "Workspace settings record not found after update",
                );
            }
            return updatedSettings;
        });
    });
}

/**
 * Initializes the workspace settings record if it doesn't exist.
 * This should be called during database setup/migration.
 */
export async function initializeWorkspaceSettings({
    db,
}: {
    db: DbConnection;
}): Promise<DatabaseWorkspaceSettings> {
    // Check if workspace settings record already exists
    const existingSettings = await db
        .select()
        .from(schema.workspace_settings)
        .get();
    if (existingSettings) {
        return existingSettings;
    }

    // Create the workspace settings record with default values
    const defaultSettings = workspaceSettingsSchema.parse({});
    const [newSettings] = await db
        .insert(schema.workspace_settings)
        .values({
            id: 1,
            json_data: JSON.stringify(defaultSettings),
        })
        .returning();

    return newSettings;
}

/**
 * Gets the workspace settings as parsed JSON data.
 */
export async function getWorkspaceSettingsJSON({
    db,
}: {
    db: DbConnection;
}): Promise<string> {
    const settings = await getWorkspaceSettings({ db });
    if (!settings) {
        throw new Error("Workspace settings not found");
    }
    return settings.json_data;
}

/**
 * Gets the workspace settings as parsed object.
 */
export async function getWorkspaceSettingsParsed({
    db,
}: {
    db: DbConnection;
}): Promise<z.infer<typeof workspaceSettingsSchema>> {
    const jsonData = await getWorkspaceSettingsJSON({ db });
    return workspaceSettingsSchema.parse(JSON.parse(jsonData));
}

/**
 * Updates the workspace settings JSON data.
 */
export async function updateWorkspaceSettingsJSON({
    db,
    jsonData,
}: {
    db: DbConnection;
    jsonData: string;
}): Promise<string> {
    // Validate the JSON data before storing
    try {
        const parsed = JSON.parse(jsonData);
        workspaceSettingsSchema.parse(parsed);
    } catch (error) {
        throw new Error(`Invalid workspace settings JSON: ${error}`);
    }

    await updateWorkspaceSettings({
        db,
        args: { json_data: jsonData },
    });

    return jsonData;
}

/**
 * Updates the workspace settings with a parsed object.
 */
export async function updateWorkspaceSettingsParsed({
    db,
    settings,
}: {
    db: DbConnection;
    settings: z.infer<typeof workspaceSettingsSchema>;
}): Promise<z.infer<typeof workspaceSettingsSchema>> {
    // Validate the settings object
    const validatedSettings = workspaceSettingsSchema.parse(settings);

    await updateWorkspaceSettings({
        db,
        args: { json_data: JSON.stringify(validatedSettings) },
    });

    return validatedSettings;
}

/**
 * Logs, in the current undo group, the undo statement for writing `newJsonData` to the workspace
 * settings row, and clears the redo stack, as a history trigger would. `workspace_settings` has no
 * standing history triggers (`tablesWithScopedHistory`), so a write that should be undone with the
 * rest of its edit calls this before changing the row. Call it inside `transactionWithHistory`.
 *
 * The statement restores only the top-level settings `newJsonData` changes
 * (`scopedRestoreStatementSql`), so undo leaves alone settings changed since by writers without
 * history (the settings dialog, say).
 */
export async function recordWorkspaceSettingsUndoInTransaction(
    tx: DbTransaction,
    newJsonData: string,
): Promise<void> {
    const columns = (
        (await tx.all(
            sql`SELECT name FROM pragma_table_info('workspace_settings');`,
        )) as unknown[]
    ).map((c) =>
        Array.isArray(c) ? String(c[0]) : String((c as { name: string }).name),
    );
    const statement = scopedRestoreStatementSql(
        getTableName(schema.workspace_settings),
        columns,
        "workspace_settings.",
        "v.new_json",
    );
    await tx.run(
        sql`WITH v(new_json) AS (SELECT ${newJsonData})
            INSERT INTO ${sql.raw(Constants.UndoHistoryTableName)} ("sequence", "history_group", "sql")
            SELECT NULL, (SELECT cur_undo_group FROM ${sql.raw(Constants.HistoryStatsTableName)}),
                ${sql.raw(statement)}
            FROM v, workspace_settings;`,
    );
    await tx.run(sql.raw(`DELETE FROM ${Constants.RedoHistoryTableName};`));
    await tx.run(
        sql.raw(
            `UPDATE ${Constants.HistoryStatsTableName} SET "cur_redo_group" = 0;`,
        ),
    );
}

/**
 * Reads, changes and writes the workspace settings inside `tx`, recording the change in the
 * current undo group so it is undone with the rest of the edit. Creates the row with defaults
 * first if the file has none.
 *
 * @param update returns the new settings from the current ones
 * @returns the settings written
 */
export async function updateWorkspaceSettingsWithHistoryInTransaction({
    tx,
    update,
}: {
    tx: DbTransaction;
    update: (settings: WorkspaceSettings) => WorkspaceSettings;
}): Promise<WorkspaceSettings> {
    let row = await tx.select().from(schema.workspace_settings).get();
    if (!row) {
        [row] = await tx
            .insert(schema.workspace_settings)
            .values({
                id: 1,
                json_data: JSON.stringify(workspaceSettingsSchema.parse({})),
            })
            .returning();
    }
    const stored = JSON.parse(row.json_data) as Record<string, unknown>;
    const current = workspaceSettingsSchema.parse(stored);
    const next = workspaceSettingsSchema.parse(update(current));
    // Store only the settings that change, so the row (and its undo) keeps every other key as it
    // is, defaults not written out included
    const written = { ...stored };
    let changed = false;
    for (const key of new Set([
        ...Object.keys(current),
        ...Object.keys(next),
    ])) {
        const value = (next as Record<string, unknown>)[key];
        if (
            JSON.stringify((current as Record<string, unknown>)[key]) ===
            JSON.stringify(value)
        )
            continue;
        changed = true;
        if (value === undefined) delete written[key];
        else written[key] = value;
    }
    if (!changed) return next;
    const jsonData = JSON.stringify(written);
    await recordWorkspaceSettingsUndoInTransaction(tx, jsonData);
    await tx
        .update(schema.workspace_settings)
        .set({
            json_data: jsonData,
            updated_at: new Date().toISOString(),
        })
        .where(eq(schema.workspace_settings.id, 1));
    return next;
}
