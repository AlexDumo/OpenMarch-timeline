/**
 * Converts a page-era show to timelines the first time it is opened (Phase 9,
 * P9.3; ADR 0001 §6). Main process only. `electron/main/convertOnOpenFlow.ts`
 * adds the dialogs and the "preparing your file" window around it.
 *
 * Runs after migrations, on a file whose `user_version` the guard in
 * `fileVersion.ts` already accepted:
 *
 * - Version 8: a timeline file. Nothing to do.
 * - Version 7 with no timeline rows: a page-era file. Back it up with
 *   `backupBeforeConversion`; only when that succeeds, convert it in ONE
 *   transaction that also turns the workspace `timelineMode` flag on and sets
 *   `user_version = 8`. Any error rolls all of it back; the backup stays.
 * - Version 7 with timeline rows: a converted file that a release without the
 *   version guard reopened (it resets the version to 7), or a file made with
 *   the dev flag. Converting again would drop the timeline edits, so the caller
 *   warns and offers the backup instead.
 *
 * Until P9.4 removes the dev flag, this step only runs when the
 * `OPENMARCH_CONVERT_ON_OPEN` environment variable is `1` (or `true`). Off by
 * default, so the app behaves as before.
 */
import * as fs from "fs";
import type { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import type { PageConversionReport } from "@/timeline/convert/planPageConversion";
import { convertPagesToTimelineInTransaction } from "@/timeline/convert/writePageConversion";
import {
    assertNoTimelineCommitViolationsInTransaction,
    drainTimelineChangeLogInTransaction,
} from "@/db-functions/timelineChanges";
import {
    createAllUndoTriggers,
    dropAllUndoTriggers,
} from "@/db-functions/history";
import type { DbConnection, DbTransaction } from "@/db-functions/types";
import { getOrm, schema } from "./db";
import {
    backupBeforeConversion,
    nextBackupPath,
    type BackupResult,
} from "./backup";
import {
    PAGE_MODEL_USER_VERSION,
    readUserVersion,
    TIMELINE_MODEL_USER_VERSION,
} from "./fileVersion";

/** Environment variable that turns convert-on-open on until P9.4 removes the dev flag. */
export const CONVERT_ON_OPEN_ENV = "OPENMARCH_CONVERT_ON_OPEN";

/** True when convert-on-open is turned on. Off unless the variable is `1` or `true`. */
export function isConvertOnOpenEnabled(
    env: Record<string, string | undefined> = process.env,
): boolean {
    const value = env[CONVERT_ON_OPEN_ENV]?.trim().toLowerCase();
    return value === "1" || value === "true";
}

/**
 * Status `setActiveDb` returns when the open stopped and the person was
 * already told why in a main-process dialog (a failed backup or conversion, or
 * they chose not to open the file). Nothing is open. The main process doesn't
 * send it as a `load-file-response`, so the renderer shows no second dialog.
 */
export const OPEN_STOPPED_STATUS = 499;

export type ConvertOnOpenCheck =
    /** A timeline file (version 8), or a version this step doesn't handle. */
    | { action: "none"; userVersion: number }
    /** A page-era file: back it up and convert it. */
    | { action: "convert" }
    /**
     * Version 7 with timeline rows. Don't convert again; warn and offer the
     * newest backup next to the file, when there is one.
     */
    | { action: "warn-older-release"; backupPath: string | undefined };

/** Number of timelines plus timeline shapes (transitions live under timelines). */
export function countTimelineRows(db: DatabaseSync): number {
    const row = db
        .prepare(
            "SELECT (SELECT count(*) FROM timelines) + (SELECT count(*) FROM timeline_shapes) AS n",
        )
        .get() as { n: number };
    return Number(row.n);
}

/**
 * The newest `<name> (before timeline conversion[ n]).dots` next to
 * `filePath`, or undefined when there is none. Backups are numbered upward, so
 * the highest number that exists is the newest.
 */
export function findLatestBackup(filePath: string): string | undefined {
    let latest: string | undefined;
    // nextBackupPath with a predicate that is always false names backup `n` itself.
    for (let n = 1; n <= 1000; n++) {
        const candidate = nextBackupPath(filePath, () => false, n);
        if (!fs.existsSync(candidate)) break;
        latest = candidate;
    }
    return latest;
}

/** Decides what convert-on-open does with the (migrated) file open on `db`. Reads only. */
export function checkConvertOnOpen(
    db: DatabaseSync,
    filePath: string,
): ConvertOnOpenCheck {
    const userVersion = readUserVersion(db);
    if (userVersion !== PAGE_MODEL_USER_VERSION)
        return { action: "none", userVersion };
    if (countTimelineRows(db) > 0)
        return {
            action: "warn-older-release",
            backupPath: findLatestBackup(filePath),
        };
    return { action: "convert" };
}

/** Sets `timelineMode: true` in `workspace_settings`, keeping the other settings. */
export async function turnTimelineModeOnInTransaction(
    tx: DbTransaction,
): Promise<void> {
    const row = await tx
        .select({
            id: schema.workspace_settings.id,
            json: schema.workspace_settings.json_data,
        })
        .from(schema.workspace_settings)
        .get();
    let settings: Record<string, unknown> = {};
    try {
        const parsed: unknown = row ? JSON.parse(row.json) : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
            settings = parsed as Record<string, unknown>;
    } catch {
        settings = {};
    }
    const json_data = JSON.stringify({ ...settings, timelineMode: true });
    if (row)
        await tx.update(schema.workspace_settings).set({ json_data }).run();
    else
        await tx
            .insert(schema.workspace_settings)
            .values({ id: 1, json_data })
            .run();
}

/**
 * Empties the undo and redo stacks. Their entries edit the page-era tables,
 * which no longer drive motion after the conversion, so undoing one would
 * change the file behind the timeline's back.
 */
async function clearHistoryInTransaction(tx: DbTransaction): Promise<void> {
    await tx.delete(schema.history_undo).run();
    await tx.delete(schema.history_redo).run();
    await tx
        .update(schema.history_stats)
        .set({ cur_undo_group: 1, cur_redo_group: 1 })
        .run();
}

export type ConvertOnOpenResult =
    | {
          status: "converted";
          backupPath: string;
          /** Undefined when the show had no pages, so only the flag and version changed. */
          report: PageConversionReport | undefined;
      }
    /** The backup failed, so nothing was converted and the file is unchanged. */
    | {
          status: "backup-failed";
          backup: Extract<BackupResult, { ok: false }>;
      }
    /** The conversion failed and was rolled back. The backup is kept. */
    | { status: "conversion-failed"; backupPath: string; error: Error };

/** Test hooks. Production callers pass nothing. */
export interface ConvertOnOpenHooks {
    /** Replaces `backupBeforeConversion`. */
    backup?: (filePath: string) => BackupResult;
    /** Runs inside the transaction after every write, before the commit. Throw to test rollback. */
    beforeCommit?: () => void | Promise<void>;
}

/**
 * Backs up the file at `filePath`, then converts it in one transaction on
 * `db` (which must be open on that file, with migrations applied and no
 * transaction open). Call it only when `checkConvertOnOpen` returned
 * `convert`. Never throws for a failed backup or conversion; it returns them.
 *
 * Synchronous work dominates (the backup takes 1 to 2 s on a 50 MB file), so
 * the caller shows a blocking state first.
 */
export async function convertFileOnOpen(
    filePath: string,
    db: DatabaseSync,
    hooks: ConvertOnOpenHooks = {},
): Promise<ConvertOnOpenResult> {
    const backup = (hooks.backup ?? backupBeforeConversion)(filePath);
    if (!backup.ok) return { status: "backup-failed", backup };

    const orm = getOrm(db) as unknown as DbConnection;
    try {
        const report = await orm.transaction(async (tx) => {
            // The conversion is not an undoable edit (see clearHistoryInTransaction).
            await dropAllUndoTriggers(tx as never);
            const pages = await tx
                .select({ n: sql<number>`count(*)` })
                .from(schema.pages)
                .get();
            const converted =
                (pages?.n ?? 0) > 0
                    ? await convertPagesToTimelineInTransaction(tx)
                    : undefined;
            await turnTimelineModeOnInTransaction(tx);
            await hooks.beforeCommit?.();
            // The spec §6 commit check, as the write wrapper runs it; then drop the change-log
            // rows the conversion wrote, since the renderer cold-builds its store on open.
            await assertNoTimelineCommitViolationsInTransaction(tx);
            await drainTimelineChangeLogInTransaction(tx);
            await clearHistoryInTransaction(tx);
            await createAllUndoTriggers(tx as never);
            // Part of the same transaction: a rollback leaves the file at 7.
            await tx.run(
                sql.raw(`PRAGMA user_version = ${TIMELINE_MODEL_USER_VERSION}`),
            );
            return converted?.report;
        });
        return { status: "converted", backupPath: backup.backupPath, report };
    } catch (error) {
        return {
            status: "conversion-failed",
            backupPath: backup.backupPath,
            error: error instanceof Error ? error : new Error(String(error)),
        };
    }
}

/** What the open flow asks the person, or shows them, during convert-on-open. */
export interface ConvertOnOpenUi {
    /**
     * The file is at 7 but has timeline rows. Resolve `open` to open it as it
     * is (no conversion, nothing written), or `stop` to open nothing.
     */
    warnOlderRelease: (
        backupPath: string | undefined,
    ) => Promise<"open" | "stop">;
    /** Runs the backup and conversion while a blocking "preparing your file" state shows. */
    whilePreparing: <T>(work: () => Promise<T>) => Promise<T>;
}

export type ConvertOnOpenOutcome =
    /** The gate is off. Nothing was read or written. */
    | { kind: "disabled" }
    /** Nothing to convert (a timeline file). */
    | { kind: "none" }
    | {
          kind: "older-release";
          backupPath: string | undefined;
          choice: "open" | "stop";
      }
    | ({ kind: "conversion" } & ConvertOnOpenResult);

/**
 * The convert-on-open step of opening a file: checks the gate and the file,
 * asks or converts, and reports what happened. `setActiveDb` calls it after
 * migrations; the caller turns the outcome into dialogs and a status code.
 */
export async function runConvertOnOpen(
    filePath: string,
    db: DatabaseSync,
    ui: ConvertOnOpenUi,
    {
        env = process.env,
        hooks,
    }: {
        env?: Record<string, string | undefined>;
        hooks?: ConvertOnOpenHooks;
    } = {},
): Promise<ConvertOnOpenOutcome> {
    if (!isConvertOnOpenEnabled(env)) return { kind: "disabled" };
    const check = checkConvertOnOpen(db, filePath);
    switch (check.action) {
        case "none":
            return { kind: "none" };
        case "warn-older-release":
            return {
                kind: "older-release",
                backupPath: check.backupPath,
                choice: await ui.warnOlderRelease(check.backupPath),
            };
        case "convert": {
            const result = await ui.whilePreparing(() =>
                convertFileOnOpen(filePath, db, hooks),
            );
            return { kind: "conversion", ...result };
        }
    }
}
