import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    backupBeforeConversion,
    BACKUP_NAME_SUFFIX,
    nextBackupPath,
} from "../backup";
import { getOrm } from "../db";
import { DrizzleMigrationService } from "../services/DrizzleMigrationService";
import { applyFileVersionDecision, readUserVersion } from "../fileVersion";

const migrationsFolder = path.resolve(__dirname, "../migrations");

const sha256 = (p: string) =>
    createHash("sha256").update(fs.readFileSync(p)).digest("hex");

/** A real migrated, initialized show file with a few rows in it. */
async function createShowFile(filePath: string) {
    const db = new DatabaseSync(filePath);
    try {
        applyFileVersionDecision(db, true);
        const orm = getOrm(db);
        await new DrizzleMigrationService(orm, db).applyPendingMigrations(
            migrationsFolder,
        );
        await DrizzleMigrationService.initializeDatabase(orm, db);
        db.prepare(
            "INSERT INTO marchers (name, section, drill_prefix, drill_order) VALUES ('Ada', 'Brass', 'B', 1), ('Bo', 'Brass', 'B', 2)",
        ).run();
    } finally {
        db.close();
    }
}

const tableCounts = (filePath: string) => {
    const db = new DatabaseSync(filePath, { readOnly: true });
    try {
        const names = (
            db
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
                )
                .all() as { name: string }[]
        ).map((r) => r.name);
        return Object.fromEntries(
            names.map((n) => [
                n,
                (
                    db.prepare(`SELECT COUNT(*) AS c FROM "${n}"`).get() as {
                        c: number;
                    }
                ).c,
            ]),
        );
    } finally {
        db.close();
    }
};

describe("backupBeforeConversion", () => {
    let dir: string;
    let showPath: string;

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "openmarch-backup-"));
        showPath = path.join(dir, "My Show.dots");
        await createShowFile(showPath);
    });

    afterEach(() => {
        fs.chmodSync(dir, 0o755);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("writes a copy next to the original that opens and matches its tables", () => {
        const result = backupBeforeConversion(showPath);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.backupPath).toBe(
            path.join(dir, `My Show (${BACKUP_NAME_SUFFIX}).dots`),
        );
        expect(result.userVersion).toBe(7);

        const backup = new DatabaseSync(result.backupPath, { readOnly: true });
        try {
            expect(readUserVersion(backup)).toBe(7);
            expect(
                backup.prepare("SELECT name FROM marchers ORDER BY name").all(),
            ).toEqual([{ name: "Ada" }, { name: "Bo" }]);
        } finally {
            backup.close();
        }
        expect(tableCounts(result.backupPath)).toEqual(tableCounts(showPath));
    });

    it("leaves the original untouched and creates no stray files", () => {
        const hash = sha256(showPath);
        const mtime = fs.statSync(showPath).mtimeMs;

        const result = backupBeforeConversion(showPath);

        expect(result.ok).toBe(true);
        expect(sha256(showPath)).toBe(hash);
        expect(fs.statSync(showPath).mtimeMs).toBe(mtime);
        expect(fs.readdirSync(dir).sort()).toEqual([
            `My Show (${BACKUP_NAME_SUFFIX}).dots`,
            "My Show.dots",
        ]);
    });

    it("numbers the name when a backup already exists and never overwrites", () => {
        const first = backupBeforeConversion(showPath);
        const firstHash = first.ok ? sha256(first.backupPath) : "";
        const second = backupBeforeConversion(showPath);
        const third = backupBeforeConversion(showPath);

        expect(second.ok && path.basename(second.backupPath)).toBe(
            `My Show (${BACKUP_NAME_SUFFIX} 2).dots`,
        );
        expect(third.ok && path.basename(third.backupPath)).toBe(
            `My Show (${BACKUP_NAME_SUFFIX} 3).dots`,
        );
        expect(first.ok && sha256(first.backupPath)).toBe(firstHash);
    });

    it("skips a name taken by an unrelated file without touching it", () => {
        const taken = path.join(dir, `My Show (${BACKUP_NAME_SUFFIX}).dots`);
        fs.writeFileSync(taken, "not a database");

        const result = backupBeforeConversion(showPath);

        expect(result.ok && path.basename(result.backupPath)).toBe(
            `My Show (${BACKUP_NAME_SUFFIX} 2).dots`,
        );
        expect(fs.readFileSync(taken, "utf8")).toBe("not a database");
    });

    it("nextBackupPath keeps the extension and picks the first free name", () => {
        const names = new Set([
            "/x/a (before timeline conversion).dots",
            "/x/a (before timeline conversion 2).dots",
        ]);
        expect(nextBackupPath("/x/a.dots", (p) => names.has(p))).toBe(
            "/x/a (before timeline conversion 3).dots",
        );
    });

    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
        "fails clearly in a read-only folder and writes nothing",
        () => {
            const hash = sha256(showPath);
            fs.chmodSync(dir, 0o555);

            const result = backupBeforeConversion(showPath);

            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.code).toBe("directory-not-writable");
            expect(result.message).toContain("Your file was not changed");
            expect(fs.readdirSync(dir)).toEqual(["My Show.dots"]);
            expect(sha256(showPath)).toBe(hash);
        },
    );

    it("fails when the file doesn't exist", () => {
        const result = backupBeforeConversion(path.join(dir, "nope.dots"));
        expect(result).toMatchObject({ ok: false, code: "source-missing" });
    });

    it("fails when the file isn't a database, leaving nothing behind", () => {
        const junk = path.join(dir, "junk.dots");
        fs.writeFileSync(junk, "this is not sqlite ".repeat(100));

        const result = backupBeforeConversion(junk);

        expect(result).toMatchObject({ ok: false, code: "source-unreadable" });
        expect(fs.readdirSync(dir).sort()).toEqual([
            "My Show.dots",
            "junk.dots",
        ]);
    });

    it("copies a consistent snapshot while a writer holds the file open (WAL)", () => {
        const writer = new DatabaseSync(showPath);
        try {
            writer.exec("PRAGMA journal_mode = WAL");
            writer.exec("BEGIN");
            writer
                .prepare(
                    "INSERT INTO marchers (name, section, drill_prefix, drill_order) VALUES ('Cy', 'Brass', 'B', 3)",
                )
                .run();
            // Uncommitted: must not appear in the backup.
            const result = backupBeforeConversion(showPath);
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(tableCounts(result.backupPath).marchers).toBe(2);
            writer.exec("COMMIT");
        } finally {
            writer.close();
        }
    });
});
