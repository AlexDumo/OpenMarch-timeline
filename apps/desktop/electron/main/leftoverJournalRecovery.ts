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
 * When the journal was played back, a copy of the show as it was goes into the backups and the
 * recovered copy replaces the show. Then the journal moves into the backups (never deleted).
 *
 * The order is what keeps a crash safe. The show is replaced while its journal is still next to
 * it: playing the journal back over the recovered show writes the pages it already has, so a
 * crash before the journal moves only means the next open recovers again, to the same result.
 * Moving the journal first would leave a torn show with nothing to undo it. Main process only.
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

/**
 * Marks the files recovery keeps in the backups: the show as it was (`…-set-aside`) and its
 * journal (`…-set-aside-journal`). Backup pruning keeps these: a moved journal keeps its old
 * creation date, and the dialog promised it isn't deleted.
 */
export const SET_ASIDE_MARK = "-set-aside";

/** The step of a recovery that failed, for the message the person sees. */
export type RecoveryStep =
    /** Writing the recovered show into the show's folder. Nothing changed. */
    | "stage"
    /** Replacing the show with the recovered copy. Nothing changed. */
    | "replace"
    /** Moving the journal out of the show's folder. The show itself is recovered. */
    | "move-journal";

export class JournalRecoveryError extends Error {
    constructor(
        readonly step: RecoveryStep,
        cause: unknown,
    ) {
        super(
            `Leftover journal recovery failed at "${step}": ${String(cause)}`,
            {
                cause,
            },
        );
    }
}

/** Runs `fn`, turning any error into a `JournalRecoveryError` for `step`. */
function atStep<T>(step: RecoveryStep, fn: () => T): T {
    try {
        return fn();
    } catch (error) {
        throw new JournalRecoveryError(step, error);
    }
}

/** Copies `from` to `to` and flushes the copy to disk before anyone renames it into place. */
function copyDurably(from: string, to: string, mode: number) {
    fs.copyFileSync(from, to);
    fs.chmodSync(to, mode);
    const fd = fs.openSync(to, "r+");
    try {
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}

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
 * connection open on `dbPath`. Throws a `JournalRecoveryError` naming the step that failed.
 */
export function recoverFromLeftoverJournal(
    dbPath: string,
    backupDir: string,
    { now = new Date(), tempDir = os.tmpdir() } = {},
): JournalRecovery {
    if (!hasLeftoverJournal(dbPath)) return { outcome: "no-journal" };

    const workDir = fs.mkdtempSync(path.join(tempDir, "openmarch-recover-"));
    const staged = `${dbPath}.recovering`;
    try {
        const sound = findSoundCopy(dbPath, workDir);
        if (!sound) return { outcome: "damaged" };

        const keptName = `${backupNameFor(dbPath, now)}${SET_ASIDE_MARK}`;
        fs.mkdirSync(backupDir, { recursive: true });

        if (sound.from === "journal") {
            // Stage next to the show first, so a full disk or a folder we can't write fails
            // before anything changes. Keep the show's own permissions.
            const mode = fs.statSync(dbPath).mode & 0o777;
            atStep("stage", () => {
                copyDurably(sound.file, staged, mode);
                fs.copyFileSync(dbPath, path.join(backupDir, keptName));
            });
            // The journal stays next to the show until this is done (see the module comment).
            atStep("replace", () => fs.renameSync(staged, dbPath));
        }

        const journalKeptAt = path.join(backupDir, `${keptName}-journal`);
        atStep("move-journal", () =>
            moveFile(journalPathFor(dbPath), journalKeptAt),
        );
        return { outcome: "recovered", from: sound.from, journalKeptAt };
    } finally {
        fs.rmSync(staged, { force: true });
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}
