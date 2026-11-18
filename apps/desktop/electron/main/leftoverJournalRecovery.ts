/**
 * Recovers a show whose leftover journal SQLite can't use where it is
 * (`LEFTOVER_JOURNAL_STATUS`, `electron/database/leftoverJournal.ts`).
 *
 * The journal holds the old contents of the pages an unfinished save was changing. If that save
 * had already written some of them into the show, the journal is the only way to undo it, so
 * simply ignoring the journal can leave a damaged show. Instead this does what SQLite would have
 * done, on copies it can write:
 *
 * 1. Copy the show and its journal to a temporary folder and open the copy, so SQLite plays the
 *    journal back. If the result passes `PRAGMA quick_check`, that's the recovered show.
 * 2. Otherwise (the journal is unreadable, or wasn't this show's and broke it), check a copy of
 *    the show alone. If it passes, the show is fine as it is.
 * 3. If neither passes, change nothing.
 *
 * On success the journal is moved into the backups folder (never deleted) and, when the journal
 * was played back, the recovered copy replaces the show. Main process only.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DatabaseSync } from "node:sqlite";
import {
    backupNameFor,
    hasLeftoverJournal,
    journalPathFor,
} from "../database/leftoverJournal";

export type JournalRecovery =
    /** The journal is gone by now: open the show as usual. */
    | { outcome: "no-journal" }
    /**
     * Recovered: `journal` when the journal was played back into the show, `show-alone` when
     * the show was fine without it. `journalKeptAt` is where the journal went in the backups.
     */
    | {
          outcome: "recovered";
          from: "journal" | "show-alone";
          journalKeptAt: string;
      }
    /** Neither the played-back copy nor the show alone passes the check. Nothing changed. */
    | { outcome: "damaged" };

/** Suffix of a journal set aside in the backups. Backup pruning keeps these. */
export const SET_ASIDE_JOURNAL_SUFFIX = "-set-aside-journal";

/** True when `file` opens and `PRAGMA quick_check` says "ok". Opening plays a journal back. */
function passesQuickCheck(file: string): boolean {
    let db: DatabaseSync | undefined;
    try {
        db = new DatabaseSync(file);
        const rows = db.prepare("PRAGMA quick_check").all();
        return rows.length === 1 && Object.values(rows[0] ?? {})[0] === "ok";
    } catch {
        return false;
    } finally {
        db?.close();
    }
}

/** Copies `from` to `to` and makes the copy writable: copying keeps a read-only mode. */
function copyWritable(from: string, to: string) {
    fs.copyFileSync(from, to);
    fs.chmodSync(to, 0o600);
}

/** Moves `from` to `to`, copying when they're on different drives. */
function moveFile(from: string, to: string) {
    try {
        fs.renameSync(from, to);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
        fs.copyFileSync(from, to);
        fs.unlinkSync(from);
    }
}

/** Which copy of the show is sound, checked in a scratch folder under `workDir`. */
function findSoundCopy(
    dbPath: string,
    workDir: string,
): { file: string; from: "journal" | "show-alone" } | null {
    const name = path.basename(dbPath);

    // What SQLite would have done: play the journal back.
    const playedBack = path.join(workDir, "with-journal", name);
    fs.mkdirSync(path.dirname(playedBack));
    copyWritable(dbPath, playedBack);
    let journalCopied = true;
    try {
        copyWritable(journalPathFor(dbPath), journalPathFor(playedBack));
    } catch {
        journalCopied = false;
    }
    if (
        journalCopied &&
        passesQuickCheck(playedBack) &&
        // SQLite deletes a journal once it has played it back.
        !fs.existsSync(journalPathFor(playedBack))
    ) {
        return { file: playedBack, from: "journal" };
    }

    const alone = path.join(workDir, "show-alone", name);
    fs.mkdirSync(path.dirname(alone));
    copyWritable(dbPath, alone);
    if (passesQuickCheck(alone)) return { file: alone, from: "show-alone" };
    return null;
}

/**
 * Recovers `dbPath` from its leftover journal (see the module comment). Call it with no
 * connection open on `dbPath`. Throws when the journal can't be moved out of the show's
 * folder or the recovered copy can't be written; the show and journal are unchanged then,
 * except that a failed final rename leaves the journal in the backups.
 */
export function recoverFromLeftoverJournal(
    dbPath: string,
    backupDir: string,
    { now = new Date(), tempDir = os.tmpdir() } = {},
): JournalRecovery {
    if (!hasLeftoverJournal(dbPath)) return { outcome: "no-journal" };

    const workDir = fs.mkdtempSync(path.join(tempDir, "openmarch-recover-"));
    try {
        const sound = findSoundCopy(dbPath, workDir);
        if (!sound) return { outcome: "damaged" };

        // Stage the recovered show next to the original first, so a full disk or a folder we
        // can't write fails before anything changes.
        const staged = `${dbPath}.recovering`;
        if (sound.from === "journal") {
            fs.copyFileSync(sound.file, staged);
            // Keep the show's own permissions, not the scratch copy's.
            fs.chmodSync(staged, fs.statSync(dbPath).mode & 0o777);
        }

        // The journal must be gone before the show changes, or SQLite would play it back
        // again over the recovered show.
        fs.mkdirSync(backupDir, { recursive: true });
        const journalKeptAt = path.join(
            backupDir,
            `${backupNameFor(dbPath, now)}${SET_ASIDE_JOURNAL_SUFFIX}`,
        );
        try {
            moveFile(journalPathFor(dbPath), journalKeptAt);
        } catch (error) {
            fs.rmSync(staged, { force: true });
            throw error;
        }
        if (sound.from === "journal") fs.renameSync(staged, dbPath);

        return { outcome: "recovered", from: sound.from, journalKeptAt };
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}
