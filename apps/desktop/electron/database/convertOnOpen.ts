/**
 * Converts a page-era show to timelines when it is opened (ADR 0001 §6), once
 * the person has agreed to it. The app runs the backup, the migrations and the
 * conversion in a worker thread (`convertOnOpenWorker.ts`), so the main
 * process stays responsive; the check runs in the main process.
 * `electron/main/convertOnOpenFlow.ts` adds the dialogs around it.
 *
 * The check runs before migrations, on a file whose `user_version` the guard
 * in `fileVersion.ts` already accepted, and writes nothing:
 *
 * - Version 8: a timeline file. Nothing to do.
 * - Version 7 with the conversion marker (`timelineConvertedAt` in the
 *   workspace settings): converted, then reopened by a release without the
 *   version guard (it resets the version to 7). Converting again would drop
 *   the timeline edits, so the caller warns, and offers the backup when there
 *   is one.
 * - Version 7 otherwise: a page-era file (or one made with the retired
 *   timeline dev flag, which already has timeline rows). The renderer asks the
 *   person first. Only once they agree is it backed up with
 *   `backupBeforeConversion` (the untouched original, so older releases can
 *   open it), migrated up to the timeline-only migrations, and converted in ONE
 *   `BEGIN IMMEDIATE` transaction that rechecks the file, writes the marker,
 *   applies the timeline-only migrations (which drop the page-era tables) and
 *   sets `user_version = 8`. Any error rolls all of it back; the backup stays.
 */
import * as fs from "fs";
import * as path from "path";
import type { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import type { PageConversionReport } from "@/timeline/convert/planPageConversion";
import { convertPagesToTimelineInTransaction } from "@/timeline/convert/convertPagesInTransaction";
import {
    assertNoTimelineCommitViolationsInTransaction,
    drainTimelineChangeLogInTransaction,
} from "@/db-functions/timelineChanges";
import {
    createAllUndoTriggers,
    dropAllUndoTriggers,
} from "@/db-functions/historyTriggers";
import type { DbConnection, DbTransaction } from "@/db-functions/types";
import { getOrm, schema } from "./db";
import {
    applyTimelineMigrationsInTransaction,
    DrizzleMigrationService,
} from "./services/DrizzleMigrationService";
import {
    BACKUP_NAME_SUFFIX,
    backupBeforeConversion,
    nextBackupPath,
    type BackupResult,
} from "./backup";
import {
    PAGE_MODEL_USER_VERSION,
    readUserVersion,
    TIMELINE_MODEL_USER_VERSION,
} from "./fileVersion";
import {
    CONVERSION_STEPS,
    type ConversionStep,
    type ConvertProgress,
} from "./convertOnOpenProtocol";
import {
    countTimelineRows,
    hasConversionMarker,
    readWorkspaceSettingsJson,
    withConversionMarker,
} from "./convertOnOpenGate";

export { countTimelineRows };

export type ConvertOnOpenCheck =
    /** Nothing to do: a timeline file (version 8). */
    | { action: "none" }
    /**
     * A page-era file: ask the person, then back it up to `backupPath` (the
     * name it would get now) and convert it.
     */
    | { action: "convert"; backupPath: string }
    /**
     * Converted, then reopened by an older release: warn, and offer the
     * newest backup when there is one.
     */
    | { action: "warn-older-release"; backupPath: string | undefined };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The newest `<name>.pre-conversion[-n].dots` next to `filePath` (the
 * highest number), or undefined when there is none. Scans the folder, so a
 * deleted backup in the middle of the numbers doesn't hide later ones.
 */
export function findLatestBackup(filePath: string): string | undefined {
    const dir = path.dirname(path.resolve(filePath));
    const ext = path.extname(filePath);
    const numbered = new RegExp(
        `\\.${escapeRegExp(BACKUP_NAME_SUFFIX)}(?:-(\\d+))?${escapeRegExp(ext)}$`,
    );
    let entries: string[];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return undefined;
    }
    let latest: { n: number; file: string } | undefined;
    for (const entry of entries) {
        const match = numbered.exec(entry);
        if (!match) continue;
        const n = match[1] ? Number(match[1]) : 1;
        // Must be exactly the name the backup of this file gets for `n` (names are cut to fit).
        const expected = nextBackupPath(
            path.join(dir, path.basename(filePath)),
            () => false,
            n,
        );
        if (path.basename(expected) !== entry) continue;
        if (!latest || n > latest.n) latest = { n, file: expected };
    }
    return latest?.file;
}

/** True when the file open on `db` carries the conversion marker. */
export function hasConversionMarkerIn(db: DatabaseSync): boolean {
    return hasConversionMarker(readWorkspaceSettingsJson(db));
}

/**
 * Decides what convert on open does with the file open on `db`, before any
 * migration runs. Reads only.
 */
export function checkConvertOnOpen(
    db: DatabaseSync,
    filePath: string,
): ConvertOnOpenCheck {
    if (readUserVersion(db) !== PAGE_MODEL_USER_VERSION)
        return { action: "none" };
    if (hasConversionMarkerIn(db))
        return {
            action: "warn-older-release",
            backupPath: findLatestBackup(filePath),
        };
    return { action: "convert", backupPath: nextBackupPath(filePath) };
}

/** Sets the conversion marker in `workspace_settings`, keeping the other settings. */
export async function writeConversionMarkerInTransaction(
    tx: DbTransaction,
    convertedAt: string,
): Promise<void> {
    const row = await tx
        .select({
            id: schema.workspace_settings.id,
            json: schema.workspace_settings.json_data,
        })
        .from(schema.workspace_settings)
        .get();
    const json_data = withConversionMarker(row?.json, convertedAt);
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
 * which the conversion drops.
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
          /**
           * Undefined when nothing was converted: the show had no pages, or it
           * already had timeline rows (made with the retired dev flag).
           */
          report: PageConversionReport | undefined;
      }
    /**
     * Inside the transaction the file was already converted (another app
     * instance got there first). Nothing was written, and the backup this open
     * made was deleted, since it may hold converted content under a "before
     * conversion" name. The file opens as it is.
     */
    | { status: "already-converted" }
    /** The backup failed, so nothing was converted and the file is unchanged. */
    | {
          status: "backup-failed";
          backup: Extract<BackupResult, { ok: false }>;
      }
    /**
     * The conversion failed and was rolled back. The backup is kept. The
     * migrations before the timeline-only ones may have been applied; the file
     * is still a page-era file, and is converted on its next open.
     */
    | { status: "conversion-failed"; backupPath: string; error: Error };

export { CONVERSION_STEPS, type ConversionStep, type ConvertProgress };

/** Hooks: `onProgress` for the renderer's progress; the others are for tests. */
export interface ConvertOnOpenHooks {
    /** Called before the backup, and after each converted page. */
    onProgress?: (progress: ConvertProgress) => void;
    /** Replaces `backupBeforeConversion`. */
    backup?: (filePath: string) => BackupResult;
    /** Runs inside the transaction after each step. Throw to test the rollback. */
    afterStep?: (step: ConversionStep) => void | Promise<void>;
    /** The time written into the conversion marker. */
    now?: () => Date;
}

class AlreadyConverted extends Error {}

/**
 * Backs up the file at `filePath`, applies its pending page-era migrations,
 * then converts it in one transaction on `db` (which must be open on that
 * file, with no transaction open). Never throws for a failed backup or
 * conversion; it returns them.
 *
 * The transaction is `BEGIN IMMEDIATE` and rechecks the version and the
 * marker first, so a file another instance converted since the check is never
 * converted twice. A show whose only page is page 0, or one that already has
 * timeline rows (made with the retired dev flag), gets the marker, the
 * timeline-only migrations and the version, with no conversion.
 */
export async function convertFileOnOpen(
    filePath: string,
    db: DatabaseSync,
    migrationsFolder: string,
    hooks: ConvertOnOpenHooks = {},
): Promise<ConvertOnOpenResult> {
    hooks.onProgress?.({ phase: "backup" });
    const backup = (hooks.backup ?? backupBeforeConversion)(filePath);
    if (!backup.ok) return { status: "backup-failed", backup };

    const orm = getOrm(db) as unknown as DbConnection;
    const step = async (name: ConversionStep) => hooks.afterStep?.(name);
    const convertedAt = (hooks.now ?? (() => new Date()))().toISOString();
    try {
        // The file's own migrations, up to the ones that drop the page-era tables. They commit
        // on their own; a later failure leaves an unconverted, migrated page-era file.
        await new DrizzleMigrationService(
            getOrm(db),
            db,
        ).applyPendingMigrations(migrationsFolder);
        await step("migrate");
        const report = await orm.transaction(
            async (tx) => {
                // `db` is the transaction's connection, so these see the locked file.
                if (
                    readUserVersion(db) !== PAGE_MODEL_USER_VERSION ||
                    hasConversionMarkerIn(db)
                )
                    throw new AlreadyConverted();
                // The conversion is not an undoable edit (see clearHistoryInTransaction).
                await dropAllUndoTriggers(tx as never);
                await step("drop-undo-triggers");
                const pages = await tx
                    .select({ n: sql<number>`count(*)` })
                    .from(schema.pages)
                    .get();
                const converted =
                    (pages?.n ?? 0) > 0 && countTimelineRows(db) === 0
                        ? await convertPagesToTimelineInTransaction(tx, {
                              onProgress: (pagesDone, pagesTotal) =>
                                  hooks.onProgress?.({
                                      phase: "convert",
                                      pagesDone,
                                      pagesTotal,
                                  }),
                          })
                        : undefined;
                await step("convert");
                await writeConversionMarkerInTransaction(tx, convertedAt);
                await step("marker");
                // The spec §6 commit check, as the write wrapper runs it; then drop the change-log
                // rows the conversion wrote, since the renderer cold-builds its store on open.
                await assertNoTimelineCommitViolationsInTransaction(tx);
                await step("commit-check");
                await drainTimelineChangeLogInTransaction(tx);
                await step("drain-change-log");
                await clearHistoryInTransaction(tx);
                await step("clear-history");
                // Drops the page-era tables the converter just read.
                applyTimelineMigrationsInTransaction(db, migrationsFolder);
                await step("timeline-migrations");
                await createAllUndoTriggers(tx as never);
                await step("create-undo-triggers");
                // Part of the same transaction: a rollback leaves the file at 7.
                await tx.run(
                    sql.raw(
                        `PRAGMA user_version = ${TIMELINE_MODEL_USER_VERSION}`,
                    ),
                );
                await step("user-version");
                return converted?.report;
            },
            { behavior: "immediate" },
        );
        return { status: "converted", backupPath: backup.backupPath, report };
    } catch (error) {
        if (error instanceof AlreadyConverted) {
            fs.rmSync(backup.backupPath, { force: true });
            return { status: "already-converted" };
        }
        return {
            status: "conversion-failed",
            backupPath: backup.backupPath,
            error: error instanceof Error ? error : new Error(String(error)),
        };
    }
}

/**
 * Opens a converted file that an older release reset to version 7 "as it is":
 * applies its pending migrations, then sets it back to version 8 in one
 * transaction with the timeline-only migrations. Nothing is converted.
 */
export async function reopenConvertedFile(
    db: DatabaseSync,
    migrationsFolder: string,
): Promise<void> {
    await new DrizzleMigrationService(getOrm(db), db).applyPendingMigrations(
        migrationsFolder,
    );
    db.exec("BEGIN IMMEDIATE");
    try {
        applyTimelineMigrationsInTransaction(db, migrationsFolder);
        db.exec(`PRAGMA user_version = ${TIMELINE_MODEL_USER_VERSION}`);
        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

/** What the open flow asks the person, or shows them, during convert on open. */
export interface ConvertOnOpenUi {
    /**
     * The file was converted, then saved by an older release. Resolve `open` to
     * open it as it is (no conversion), or `stop` to open nothing.
     */
    warnOlderRelease: (
        backupPath: string | undefined,
    ) => Promise<"open" | "stop">;
    /**
     * Runs the backup and conversion while the renderer shows its progress.
     * `work` reports its progress through the function it is given.
     */
    whilePreparing: <T>(
        work: (onProgress?: (progress: ConvertProgress) => void) => Promise<T>,
    ) => Promise<T>;
}

export type ConvertOnOpenOutcome =
    /** Nothing to convert: a timeline file. Nothing was written. */
    | { kind: "none" }
    /**
     * A page-era file the person hasn't agreed to convert yet. Nothing was
     * written; `backupPath` is where the backup would go.
     */
    | { kind: "needs-confirmation"; backupPath: string }
    | {
          kind: "older-release";
          backupPath: string | undefined;
          choice: "open" | "stop";
      }
    | ({ kind: "conversion" } & ConvertOnOpenResult);

/**
 * The convert-on-open step of opening a file, before its migrations: checks
 * the file, then asks, converts (only when `confirmed`), or reports that the
 * person must be asked first.
 */
export async function runConvertOnOpen(
    filePath: string,
    db: DatabaseSync,
    ui: ConvertOnOpenUi,
    {
        confirmed,
        migrationsFolder,
        hooks,
        convert,
    }: {
        /** The person agreed to convert this file. */
        confirmed: boolean;
        migrationsFolder: string;
        hooks?: ConvertOnOpenHooks;
        /**
         * Backs up and converts the file instead of `convertFileOnOpen` on
         * `db`: the app runs them in a worker. It must not use `db`.
         */
        convert?: (
            onProgress: (progress: ConvertProgress) => void,
        ) => Promise<ConvertOnOpenResult>;
    },
): Promise<ConvertOnOpenOutcome> {
    const check = checkConvertOnOpen(db, filePath);
    switch (check.action) {
        case "none":
            return { kind: "none" };
        case "warn-older-release": {
            const choice = await ui.warnOlderRelease(check.backupPath);
            if (choice === "open")
                await reopenConvertedFile(db, migrationsFolder);
            return {
                kind: "older-release",
                backupPath: check.backupPath,
                choice,
            };
        }
        case "convert": {
            if (!confirmed)
                return {
                    kind: "needs-confirmation",
                    backupPath: check.backupPath,
                };
            const result = await ui.whilePreparing((onProgress) => {
                const report = (progress: ConvertProgress) => {
                    hooks?.onProgress?.(progress);
                    onProgress?.(progress);
                };
                return convert
                    ? convert(report)
                    : convertFileOnOpen(filePath, db, migrationsFolder, {
                          ...hooks,
                          onProgress: report,
                      });
            });
            return { kind: "conversion", ...result };
        }
    }
}
