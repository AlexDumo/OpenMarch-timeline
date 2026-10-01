/**
 * Backup of a `.dots` file before the timeline conversion (Phase 9, P9.2).
 *
 * `backupBeforeConversion` writes a consistent copy next to the original and
 * verifies it. P9.3's conversion calls it first and must not convert unless it
 * returns `{ ok: true }`. Nothing else calls it yet.
 *
 * The copy is made with `VACUUM INTO` from a read-only connection, so it is a
 * single consistent snapshot even while another connection has the file open or
 * is writing to it (a plain file copy could miss pages that are still in the
 * WAL or catch a write half-way). The original is never written to. The copy is
 * written under a temporary name and only given its final name once it passed
 * verification, so a half-written backup never has the real name.
 */
import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";
import { readUserVersion } from "./fileVersion";

/** Text in the backup's name, before the extension. */
export const BACKUP_NAME_SUFFIX = "before timeline conversion";

/** Why a backup failed. The UI can branch on this and show `message`. */
export type BackupErrorCode =
    /** The file to back up doesn't exist or isn't a file. */
    | "source-missing"
    /** The folder isn't writable (read-only folder, permissions). */
    | "directory-not-writable"
    /** No space left for the copy. */
    | "disk-full"
    /** The file couldn't be read as an SQLite database. */
    | "source-unreadable"
    /** The copy was written but doesn't match the original. */
    | "verification-failed"
    /** Anything else. */
    | "unknown";

export type BackupResult =
    | {
          ok: true;
          /** Absolute path of the backup. */
          backupPath: string;
          /** The original's `user_version`, which the backup has too. */
          userVersion: number;
      }
    | {
          ok: false;
          code: BackupErrorCode;
          /** English text safe to show to a person. The conversion must not proceed. */
          message: string;
      };

/**
 * The name for a backup of `filePath`: `<name> (before timeline conversion).dots`,
 * or `<name> (before timeline conversion 2).dots` (3, ...) when that exists.
 * Only checks which names are free; it does not create anything.
 */
export function nextBackupPath(
    filePath: string,
    exists: (p: string) => boolean = fs.existsSync,
): string {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    for (let n = 1; ; n++) {
        const label =
            n === 1 ? BACKUP_NAME_SUFFIX : `${BACKUP_NAME_SUFFIX} ${n}`;
        const candidate = path.join(dir, `${base} (${label})${ext}`);
        if (!exists(candidate)) return candidate;
    }
}

const fail = (code: BackupErrorCode, message: string): BackupResult => ({
    ok: false,
    code,
    message,
});

const errnoOf = (e: unknown): string | undefined =>
    (e as NodeJS.ErrnoException | undefined)?.code;

/** Maps a failure to a result. */
function classify(e: unknown, dir: string): BackupResult {
    const code = errnoOf(e);
    const text = e instanceof Error ? e.message : String(e);
    if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
        return fail(
            "directory-not-writable",
            `OpenMarch can't write a backup in "${dir}" (the folder is read-only or you don't have permission). Your file was not changed. Move it to a folder you can write to, then try again.`,
        );
    }
    if (code === "ENOSPC" || code === "EDQUOT" || /full|ENOSPC/i.test(text)) {
        return fail(
            "disk-full",
            `There isn't enough free disk space to back up your file in "${dir}". Your file was not changed. Free some space, then try again.`,
        );
    }
    // node:sqlite reports a failure to create the target with these codes.
    if (/readonly|unable to open|permission/i.test(text)) {
        return fail(
            "directory-not-writable",
            `OpenMarch can't write a backup in "${dir}". Your file was not changed. Move it to a folder you can write to, then try again.`,
        );
    }
    return fail(
        "unknown",
        `The backup could not be made: ${text}. Your file was not changed.`,
    );
}

/** Tables and views as (type, name, sql), sorted, for comparing two files. */
function schemaOf(db: DatabaseSync): string {
    return JSON.stringify(
        db
            .prepare(
                "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
            )
            .all(),
    );
}

function tableNames(db: DatabaseSync): string[] {
    return (
        db
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .all() as { name: string }[]
    ).map((r) => r.name);
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Throws when `copyPath` isn't a faithful copy of `sourcePath`: it must pass
 * `integrity_check` and have the same `user_version`, schema and row count for
 * every table. Both files are opened read-only.
 */
function verifyCopy(sourcePath: string, copyPath: string): void {
    const source = new DatabaseSync(sourcePath, { readOnly: true });
    const copy = new DatabaseSync(copyPath, { readOnly: true });
    try {
        const integrity = copy.prepare("PRAGMA integrity_check").all() as {
            integrity_check: string;
        }[];
        if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
            throw new Error("the copy failed SQLite's integrity check");
        }
        if (readUserVersion(copy) !== readUserVersion(source)) {
            throw new Error("the copy has a different file version");
        }
        if (schemaOf(copy) !== schemaOf(source)) {
            throw new Error("the copy has a different schema");
        }
        for (const table of tableNames(source)) {
            const count = (db: DatabaseSync) =>
                (
                    db
                        .prepare(
                            `SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`,
                        )
                        .get() as { n: number }
                ).n;
            if (count(copy) !== count(source)) {
                throw new Error(
                    `the copy has a different row count in ${table}`,
                );
            }
        }
    } finally {
        copy.close();
        source.close();
    }
}

/** Gives `tempPath` the final name `target` without ever replacing a file. */
function publishWithoutOverwrite(tempPath: string, target: string): void {
    try {
        // A hard link fails with EEXIST if `target` appeared in the meantime.
        fs.linkSync(tempPath, target);
        fs.unlinkSync(tempPath);
    } catch (e) {
        if (errnoOf(e) === "EEXIST") throw e;
        // Some file systems have no hard links; copy with an exclusive create.
        try {
            fs.copyFileSync(tempPath, target, fs.constants.COPYFILE_EXCL);
        } catch (copyError) {
            // Never leave a partial file under the real name.
            if (errnoOf(copyError) !== "EEXIST") {
                fs.rmSync(target, { force: true });
            }
            throw copyError;
        }
        fs.unlinkSync(tempPath);
    }
}

/**
 * Backs up the show file at `filePath` next to it, before it is converted.
 *
 * - Never writes to `filePath`.
 * - Never overwrites an existing file: a taken name gets a number.
 * - Verifies the copy before returning success, and removes it (and any
 *   temporary file) when anything fails.
 * - Never throws for an expected failure; it returns `{ ok: false, ... }`.
 *
 * Callers must not convert the file unless `ok` is true.
 */
export function backupBeforeConversion(filePath: string): BackupResult {
    const dir = path.dirname(path.resolve(filePath));
    const absolute = path.join(dir, path.basename(filePath));

    let stat: fs.Stats | undefined;
    try {
        stat = fs.statSync(absolute);
    } catch {
        stat = undefined;
    }
    if (!stat?.isFile()) {
        return fail(
            "source-missing",
            `The file "${absolute}" doesn't exist, so it can't be backed up.`,
        );
    }

    // Probe for write access first so a read-only folder fails clearly and early.
    const tempPath = path.join(
        dir,
        `.${path.basename(absolute)}.${randomBytes(6).toString("hex")}.backup-tmp`,
    );
    let published: string | undefined;
    try {
        fs.writeFileSync(tempPath, "", { flag: "wx" });
        fs.unlinkSync(tempPath);
    } catch (e) {
        return classify(e, dir);
    }

    try {
        let source: DatabaseSync;
        try {
            source = new DatabaseSync(absolute, { readOnly: true });
        } catch (e) {
            return fail(
                "source-unreadable",
                `"${absolute}" couldn't be opened to back it up: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
        let userVersion: number;
        try {
            // Also fails here if the file isn't a database.
            userVersion = readUserVersion(source);
            source.exec(`VACUUM INTO '${tempPath.replace(/'/g, "''")}'`);
        } catch (e) {
            const text = e instanceof Error ? e.message : String(e);
            if (/not a database|malformed|encrypted/i.test(text)) {
                return fail(
                    "source-unreadable",
                    `"${absolute}" isn't a readable OpenMarch file: ${text}`,
                );
            }
            return classify(e, dir);
        } finally {
            source.close();
        }

        try {
            verifyCopy(absolute, tempPath);
        } catch (e) {
            return fail(
                "verification-failed",
                `The backup was made but didn't match your file (${e instanceof Error ? e.message : String(e)}), so it was deleted. Your file was not changed.`,
            );
        }

        for (;;) {
            const target = nextBackupPath(absolute);
            try {
                publishWithoutOverwrite(tempPath, target);
                published = target;
                break;
            } catch (e) {
                if (errnoOf(e) === "EEXIST") continue; // lost a race; take the next number
                return classify(e, dir);
            }
        }
        return { ok: true, backupPath: published, userVersion };
    } catch (e) {
        return classify(e, dir);
    } finally {
        fs.rmSync(tempPath, { force: true });
    }
}
