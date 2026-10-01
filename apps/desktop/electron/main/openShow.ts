/**
 * The database part of opening a show file, shared by `setActiveDb` and the
 * new-show draft (`electron/main/index.ts`): set the path, check the version,
 * migrate, then either initialize a new file or run convert on open (P9.3).
 * It has no Electron dependency, so tests drive it directly.
 *
 * With the convert-on-open gate off (the default), this does what
 * `setActiveDb` always did, and loads nothing from the renderer: the converter
 * and its dialogs flow are loaded with a dynamic `import()` only once the gate
 * is on.
 */
import type { DatabaseSync } from "node:sqlite";
import * as DatabaseServices from "../database/database.services";
import { getOrm } from "../database/db";
import { DrizzleMigrationService } from "../database/services/DrizzleMigrationService";
import { applyFileVersionDecision } from "../database/fileVersion";
import {
    initializeNewFileAsTimeline,
    isConvertOnOpenEnabled,
    OPEN_STOPPED_STATUS,
} from "../database/convertOnOpenGate";
import type { ConvertOnOpenHooks } from "../database/convertOnOpen";
import type { ConvertOnOpenDialogs } from "./convertOnOpenFlow";

let openTail: Promise<unknown> = Promise.resolve();

/**
 * Runs `open` after every open queued before it has finished, so two opens
 * (for example a double click, or a second file while the first converts)
 * never interleave. Never call it from inside another queued open.
 */
export function withOpenLock<T>(open: () => Promise<T>): Promise<T> {
    const run = openTail.then(open, open);
    openTail = run.catch(() => undefined);
    return run;
}

export interface OpenShowDeps {
    migrationsFolder: string;
    env?: Record<string, string | undefined>;
    /** Runs before pending migrations are applied to an existing file (the app backs it up). */
    beforeMigrations?: (filePath: string) => void;
    /** The convert-on-open dialogs. Only called when the gate is on and an existing file opens. */
    dialogs: () => ConvertOnOpenDialogs;
    /** Test hooks for the conversion. */
    hooks?: ConvertOnOpenHooks;
}

export interface OpenShowResult {
    /** 200, an HTTP-style refusal from `setDbPath`, 500, or `OPEN_STOPPED_STATUS`. */
    status: number;
    /** The open connection, on success. The caller owns it. */
    db?: DatabaseSync;
    /**
     * True when the renderer's SQL was suspended for a conversion. The caller
     * resumes it once the window has reloaded (or right away when nothing opens).
     */
    sqlSuspended: boolean;
}

/** Opens `filePath` as the active database. Not serialized; use `openShowFile` or `withOpenLock`. */
export async function openShowDatabase(
    filePath: string,
    isNewFile: boolean,
    deps: OpenShowDeps,
): Promise<OpenShowResult> {
    const resCode = DatabaseServices.setDbPath(filePath, isNewFile);
    if (resCode !== 200) return { status: resCode, sqlSuspended: false };

    const db = DatabaseServices.connect();
    if (!db) return { status: 500, sqlSuspended: false };

    const orm = getOrm(db);
    const migrator = new DrizzleMigrationService(orm, db);
    if (!isNewFile && migrator.hasPendingMigrations(deps.migrationsFolder))
        deps.beforeMigrations?.(filePath);
    // Sets the version only on a new, empty file; an existing file keeps its
    // version (ADR 0001 §6). setDbPath already refused newer files.
    applyFileVersionDecision(db, isNewFile);
    await migrator.applyPendingMigrations(deps.migrationsFolder);

    const gateOn = isConvertOnOpenEnabled(deps.env);
    if (isNewFile) {
        await DrizzleMigrationService.initializeDatabase(orm, db);
        // With the gate on, a new file starts as a timeline file (no backup, no conversion).
        if (gateOn) initializeNewFileAsTimeline(db);
        return { status: 200, db, sqlSuspended: false };
    }
    if (!gateOn) return { status: 200, db, sqlSuspended: false };

    let sqlSuspended = false;
    const { convertOnOpenInMain } = await import("./convertOnOpenFlow");
    const next = await convertOnOpenInMain(filePath, db, deps.dialogs(), {
        env: deps.env,
        hooks: deps.hooks,
        beforeConvert: () => {
            DatabaseServices.suspendSqlProxy("the file is being converted");
            sqlSuspended = true;
        },
    });
    if (next === "stop") {
        db.close();
        DatabaseServices.setDbPath("", false);
        return { status: OPEN_STOPPED_STATUS, sqlSuspended };
    }
    return { status: 200, db, sqlSuspended };
}

/** `openShowDatabase`, serialized with every other open. */
export function openShowFile(
    filePath: string,
    isNewFile: boolean,
    deps: OpenShowDeps,
): Promise<OpenShowResult> {
    return withOpenLock(() => openShowDatabase(filePath, isNewFile, deps));
}
