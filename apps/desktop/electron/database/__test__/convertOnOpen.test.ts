// @vitest-environment node
/**
 * Convert on open (docs/timeline/phases/09-flip.md P9.3, ADR 0001 §6), on real
 * `.dots` files opened through the same steps as `setActiveDb` in
 * `electron/main/index.ts`. Runs in the node environment, as the main process
 * does, so a converter dependency that needs `window` fails here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    closePersistentConnection,
    connect,
    setDbPath,
} from "../database.services";
import { getOrm } from "../db";
import { DrizzleMigrationService } from "../services/DrizzleMigrationService";
import { applyFileVersionDecision, readUserVersion } from "../fileVersion";
import { BACKUP_NAME_SUFFIX } from "../backup";
import {
    CONVERT_ON_OPEN_ENV,
    findLatestBackup,
    isConvertOnOpenEnabled,
    runConvertOnOpen,
    type ConvertOnOpenHooks,
    type ConvertOnOpenOutcome,
    type ConvertOnOpenUi,
} from "../convertOnOpen";

const migrationsFolder = path.resolve(__dirname, "../migrations");
const showSql = fs.readFileSync(
    path.resolve(
        __dirname,
        "../../../src/test/mock-data/marchers-and-pages.sql",
    ),
    "utf-8",
);
const GATE_ON = { [CONVERT_ON_OPEN_ENV]: "1" };

const sha256 = (filePath: string) =>
    createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

/** Runs `fn` on a fresh connection to `filePath`. */
function withDb<T>(filePath: string, fn: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(filePath);
    try {
        return fn(db);
    } finally {
        db.close();
    }
}

const count = (db: DatabaseSync, table: string) =>
    Number(
        (
            db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
                n: number;
            }
        ).n,
    );

interface FileState {
    userVersion: number;
    timelines: number;
    transitions: number;
    assignments: number;
    timelineMode: unknown;
    historyUndo: number;
    historyRedo: number;
    changeLog: number;
    marcherPages: number;
}

function stateOf(filePath: string): FileState {
    return withDb(filePath, (db) => {
        const settings = db
            .prepare("SELECT json_data FROM workspace_settings")
            .get() as { json_data: string } | undefined;
        return {
            userVersion: readUserVersion(db),
            timelines: count(db, "timelines"),
            transitions: count(db, "timeline_transitions"),
            assignments: count(db, "timeline_assignments"),
            timelineMode: settings
                ? (JSON.parse(settings.json_data) as Record<string, unknown>)
                      .timelineMode
                : undefined,
            historyUndo: count(db, "history_undo"),
            historyRedo: count(db, "history_redo"),
            changeLog: count(db, "timeline_change_log"),
            marcherPages: count(db, "marcher_pages"),
        };
    });
}

/** A migrated show file at version 7 with 76 marchers on 6 pages, and some undo history. */
async function createPageShow(filePath: string) {
    const db = new DatabaseSync(filePath);
    try {
        applyFileVersionDecision(db, true);
        const orm = getOrm(db);
        await new DrizzleMigrationService(orm, db).applyPendingMigrations(
            migrationsFolder,
        );
        await DrizzleMigrationService.initializeDatabase(orm, db);
        db.exec(showSql);
        db.exec(
            "INSERT INTO history_undo (history_group, sql) VALUES (1, 'SELECT 1')",
        );
        db.exec(
            "INSERT INTO history_redo (history_group, sql) VALUES (1, 'SELECT 1')",
        );
    } finally {
        db.close();
    }
}

/** Records what the flow asked; answers the older-release warning with `choice`. */
function testUi(choice: "open" | "stop" = "stop") {
    const calls = { warned: [] as (string | undefined)[], prepared: 0 };
    const ui: ConvertOnOpenUi = {
        warnOlderRelease: async (backupPath) => {
            calls.warned.push(backupPath);
            return choice;
        },
        whilePreparing: async (work) => {
            calls.prepared++;
            return work();
        },
    };
    return { ui, calls };
}

/** The file's hash just before the convert-on-open step (opening itself writes to the file). */
let hashBeforeStep = "";

/**
 * The database steps of `setActiveDb`, including the convert-on-open step. Sets
 * `hashBeforeStep`, and runs `beforeStep` after migrations, right before the step.
 */
async function openLikeSetActiveDb(
    filePath: string,
    {
        env = GATE_ON,
        ui = testUi().ui,
        hooks,
        beforeStep,
    }: {
        env?: Record<string, string | undefined>;
        ui?: ConvertOnOpenUi;
        hooks?: ConvertOnOpenHooks;
        beforeStep?: () => void;
    } = {},
): Promise<ConvertOnOpenOutcome> {
    expect(setDbPath(filePath, false)).toBe(200);
    const db = connect();
    try {
        const orm = getOrm(db);
        const migrator = new DrizzleMigrationService(orm, db);
        applyFileVersionDecision(db, false);
        await migrator.applyPendingMigrations(migrationsFolder);
        hashBeforeStep = sha256(filePath);
        beforeStep?.();
        return await runConvertOnOpen(filePath, db, ui, { env, hooks });
    } finally {
        db.close();
    }
}

const backupsIn = (dir: string) =>
    fs.readdirSync(dir).filter((f) => f.includes(BACKUP_NAME_SUFFIX));

describe("convert on open", () => {
    let tempDir: string;
    let showPath: string;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmarch-convert-"));
        showPath = path.join(tempDir, "show.dots");
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
        await createPageShow(showPath);
    });

    afterEach(() => {
        closePersistentConnection();
        setDbPath("", false);
        try {
            fs.chmodSync(tempDir, 0o755);
        } catch {
            // already gone
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    describe("the gate", () => {
        it("is off unless the variable is 1 or true", () => {
            expect(isConvertOnOpenEnabled({})).toBe(false);
            expect(isConvertOnOpenEnabled({ [CONVERT_ON_OPEN_ENV]: "" })).toBe(
                false,
            );
            expect(isConvertOnOpenEnabled({ [CONVERT_ON_OPEN_ENV]: "0" })).toBe(
                false,
            );
            expect(isConvertOnOpenEnabled({ [CONVERT_ON_OPEN_ENV]: "1" })).toBe(
                true,
            );
            expect(
                isConvertOnOpenEnabled({ [CONVERT_ON_OPEN_ENV]: " TRUE " }),
            ).toBe(true);
        });

        it("leaves a page-era file as it is when off", async () => {
            const before = stateOf(showPath);
            const { ui, calls } = testUi();

            const outcome = await openLikeSetActiveDb(showPath, {
                env: {},
                ui,
            });

            expect(outcome).toEqual({ kind: "disabled" });
            expect(sha256(showPath)).toBe(hashBeforeStep);
            expect(stateOf(showPath)).toEqual(before);
            expect(before.userVersion).toBe(7);
            expect(before.timelines).toBe(0);
            expect(before.timelineMode).toBeUndefined();
            expect(backupsIn(tempDir)).toEqual([]);
            expect(calls).toEqual({ warned: [], prepared: 0 });
        });
    });

    it("backs up, then converts in one go: version 8, flag on, timeline rows", async () => {
        const before = stateOf(showPath);
        const { ui, calls } = testUi();

        const outcome = await openLikeSetActiveDb(showPath, { ui });

        expect(outcome.kind).toBe("conversion");
        if (outcome.kind !== "conversion" || outcome.status !== "converted")
            throw new Error(`not converted: ${JSON.stringify(outcome)}`);
        expect(calls.prepared).toBe(1);
        expect(calls.warned).toEqual([]);

        // The backup: next to the file, the pre-conversion bytes' content, still a page file.
        const expectedBackup = path.join(
            tempDir,
            `show (${BACKUP_NAME_SUFFIX}).dots`,
        );
        expect(outcome.backupPath).toBe(expectedBackup);
        expect(backupsIn(tempDir)).toEqual([path.basename(expectedBackup)]);
        expect(stateOf(expectedBackup)).toEqual(before);
        expect(sha256(showPath)).not.toBe(hashBeforeStep);

        // The file: version 8, flag on, one timeline with a transition per page 1 to 6.
        const after = stateOf(showPath);
        expect(after.userVersion).toBe(8);
        expect(after.timelineMode).toBe(true);
        expect(after.timelines).toBe(1);
        expect(after.transitions).toBe(6);
        expect(after.assignments).toBe(76 * 6);
        expect(after.marcherPages).toBe(before.marcherPages);
        // Not an undoable edit; no stale history or change-log rows.
        expect(after.historyUndo).toBe(0);
        expect(after.historyRedo).toBe(0);
        expect(after.changeLog).toBe(0);
        expect(outcome.report?.pages.length).toBeGreaterThan(0);

        // Other workspace settings are kept.
        const settings = withDb(
            showPath,
            (db) =>
                JSON.parse(
                    (
                        db
                            .prepare("SELECT json_data FROM workspace_settings")
                            .get() as { json_data: string }
                    ).json_data,
                ) as Record<string, unknown>,
        );
        expect(settings.defaultTempo).toBe(120);
    });

    it("doesn't convert again when a converted file is reopened", async () => {
        await openLikeSetActiveDb(showPath);
        const converted = stateOf(showPath);
        const { ui, calls } = testUi();

        const outcome = await openLikeSetActiveDb(showPath, { ui });

        expect(outcome).toEqual({ kind: "none" });
        expect(stateOf(showPath)).toEqual(converted);
        expect(sha256(showPath)).toBe(hashBeforeStep);
        expect(backupsIn(tempDir)).toHaveLength(1);
        expect(calls).toEqual({ warned: [], prepared: 0 });
    });

    describe("a failed backup", () => {
        it("converts nothing and leaves the file untouched", async () => {
            const before = stateOf(showPath);

            const outcome = await openLikeSetActiveDb(showPath, {
                hooks: {
                    backup: () => ({
                        ok: false,
                        code: "disk-full",
                        message: "There isn't enough space.",
                    }),
                },
            });

            expect(outcome).toMatchObject({
                kind: "conversion",
                status: "backup-failed",
                backup: { code: "disk-full" },
            });
            expect(sha256(showPath)).toBe(hashBeforeStep);
            expect(stateOf(showPath)).toEqual(before);
        });

        it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
            "in a folder that became read-only, converts nothing",
            async () => {
                const before = stateOf(showPath);

                const outcome = await openLikeSetActiveDb(showPath, {
                    beforeStep: () => fs.chmodSync(tempDir, 0o555),
                });

                expect(outcome).toMatchObject({
                    kind: "conversion",
                    status: "backup-failed",
                    backup: { code: "directory-not-writable" },
                });
                fs.chmodSync(tempDir, 0o755);
                expect(sha256(showPath)).toBe(hashBeforeStep);
                expect(stateOf(showPath)).toEqual(before);
                expect(backupsIn(tempDir)).toEqual([]);
            },
        );
    });

    it("rolls a failed conversion back completely and keeps the backup", async () => {
        const before = stateOf(showPath);
        const undoTriggersBefore = withDb(showPath, (db) =>
            db
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
                )
                .all(),
        );

        const outcome = await openLikeSetActiveDb(showPath, {
            hooks: {
                beforeCommit: () => {
                    throw new Error("disk vanished");
                },
            },
        });

        expect(outcome).toMatchObject({
            kind: "conversion",
            status: "conversion-failed",
        });
        if (
            outcome.kind !== "conversion" ||
            outcome.status !== "conversion-failed"
        )
            throw new Error("expected a failed conversion");
        expect(outcome.error.message).toContain("disk vanished");
        expect(fs.existsSync(outcome.backupPath)).toBe(true);
        expect(stateOf(outcome.backupPath)).toEqual(before);

        // Nothing partial: no timeline rows, still 7, flag off, history and triggers as before.
        expect(stateOf(showPath)).toEqual(before);
        expect(
            withDb(showPath, (db) =>
                db
                    .prepare(
                        "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
                    )
                    .all(),
            ),
        ).toEqual(undoTriggersBefore);

        // The next open converts it (and backs it up again under the next name).
        const retry = await openLikeSetActiveDb(showPath);
        expect(retry).toMatchObject({
            kind: "conversion",
            status: "converted",
        });
        expect(stateOf(showPath).userVersion).toBe(8);
        expect(backupsIn(tempDir)).toHaveLength(2);
    });

    describe("a converted file an older release reopened at 7", () => {
        /** What a release without the version guard does: reset to 7 and edit the page rows. */
        function reopenInOlderRelease() {
            withDb(showPath, (db) => {
                db.exec("PRAGMA user_version = 7");
                db.exec("UPDATE marcher_pages SET x = x + 10 WHERE id = 1");
            });
        }

        it.each(["stop", "open"] as const)(
            "warns, offers the backup and never converts again (%s)",
            async (choice) => {
                const first = await openLikeSetActiveDb(showPath);
                if (first.kind !== "conversion" || first.status !== "converted")
                    throw new Error("expected a conversion");
                reopenInOlderRelease();
                const before = stateOf(showPath);
                const { ui, calls } = testUi(choice);

                const outcome = await openLikeSetActiveDb(showPath, { ui });

                expect(outcome).toEqual({
                    kind: "older-release",
                    backupPath: first.backupPath,
                    choice,
                });
                expect(calls).toEqual({
                    warned: [first.backupPath],
                    prepared: 0,
                });
                expect(stateOf(showPath)).toEqual(before);
                expect(before.userVersion).toBe(7);
                expect(sha256(showPath)).toBe(hashBeforeStep);
                expect(backupsIn(tempDir)).toHaveLength(1);
            },
        );

        it("warns without a backup to offer when none is next to the file", async () => {
            await openLikeSetActiveDb(showPath);
            reopenInOlderRelease();
            for (const f of backupsIn(tempDir))
                fs.rmSync(path.join(tempDir, f));
            const { ui, calls } = testUi("stop");

            const outcome = await openLikeSetActiveDb(showPath, { ui });

            expect(outcome).toEqual({
                kind: "older-release",
                backupPath: undefined,
                choice: "stop",
            });
            expect(calls.warned).toEqual([undefined]);
        });
    });

    it("finds the newest numbered backup", () => {
        expect(findLatestBackup(showPath)).toBeUndefined();
        const one = path.join(tempDir, `show (${BACKUP_NAME_SUFFIX}).dots`);
        const two = path.join(tempDir, `show (${BACKUP_NAME_SUFFIX} 2).dots`);
        fs.writeFileSync(one, "");
        expect(findLatestBackup(showPath)).toBe(one);
        fs.writeFileSync(two, "");
        expect(findLatestBackup(showPath)).toBe(two);
    });
});
