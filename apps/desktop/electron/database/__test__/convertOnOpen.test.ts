// @vitest-environment node
/**
 * Convert on open (docs/timeline/phases/09-flip.md P9.3, ADR 0001 §6), on real
 * `.dots` files opened through the same steps as `setActiveDb`. Runs in the
 * node environment, as the main process does, so a converter dependency that
 * needs `window` (or `import.meta.env`) fails here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { applyFileVersionDecision } from "../fileVersion";
import { BACKUP_NAME_SUFFIX } from "../backup";
import {
    CONVERT_ON_OPEN_ENV,
    isConvertOnOpenEnabled,
    withTimelineModeOn,
} from "../convertOnOpenGate";
import {
    CONVERSION_STEPS,
    findLatestBackup,
    runConvertOnOpen,
    type ConvertOnOpenHooks,
    type ConvertOnOpenOutcome,
    type ConvertOnOpenUi,
} from "../convertOnOpen";
import {
    backupsIn,
    createBlankShow,
    createPageShow,
    GATE_ON,
    migrationsFolder,
    sha256,
    stateOf,
    withDb,
} from "./convertOnOpenFixtures";

/** Records what the flow asked; answers the older-release warning with `choice`. */
function testUi(choice: "open" | "stop" = "stop") {
    const calls = { warned: [] as string[], prepared: 0 };
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
        it.each([
            [undefined, false],
            ["", false],
            ["0", false],
            ["yes", false],
            ["on", false],
            ["false", false],
            ["1", true],
            ["true", true],
            [" TRUE ", true],
        ])("%j turns it on: %s", (value, on) => {
            expect(
                isConvertOnOpenEnabled(
                    value === undefined ? {} : { [CONVERT_ON_OPEN_ENV]: value },
                ),
            ).toBe(on);
        });

        it.each([{}, { [CONVERT_ON_OPEN_ENV]: "yes" }])(
            "leaves a page-era file as it is when off (%j)",
            async (env) => {
                const before = stateOf(showPath);
                const { ui, calls } = testUi();

                const outcome = await openLikeSetActiveDb(showPath, {
                    env,
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
            },
        );
    });

    it("backs up, then converts in one go: version 8, flag on, timeline rows", async () => {
        const before = stateOf(showPath);
        const { ui, calls } = testUi();

        const outcome = await openLikeSetActiveDb(showPath, { ui });

        if (outcome.kind !== "conversion" || outcome.status !== "converted")
            throw new Error(`not converted: ${JSON.stringify(outcome)}`);
        expect(calls.prepared).toBe(1);
        expect(calls.warned).toEqual([]);

        // The backup: next to the file, the pre-conversion content, still a page file.
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
        // Not an undoable edit; no stale history or change-log rows; undo triggers kept.
        expect(after.history).toEqual([]);
        expect(after.historyStats).toMatchObject({
            cur_undo_group: 1,
            cur_redo_group: 1,
        });
        expect(after.changeLog).toBe(0);
        expect(after.triggers).toEqual(before.triggers);
        expect(outcome.report?.pages.length).toBeGreaterThan(0);

        // Other workspace settings are kept.
        expect(JSON.parse(after.settingsJson!)).toMatchObject({
            defaultTempo: 120,
            timelineMode: true,
        });
    });

    it("converts a show with only page 0: the flag and the version, homes from page 0", async () => {
        const blank = path.join(tempDir, "blank.dots");
        await createBlankShow(blank);
        withDb(blank, (db) => {
            db.exec(
                "INSERT INTO marchers (id, section, drill_prefix, drill_order) VALUES (1, 'Trumpet', 'T', 1)",
            );
            db.exec(
                "UPDATE marcher_pages SET x = 12.5, y = 40 WHERE marcher_id = 1 AND page_id = 0",
            );
        });
        const hasRow = withDb(
            blank,
            (db) =>
                db
                    .prepare(
                        "SELECT count(*) AS n FROM marcher_pages WHERE marcher_id = 1 AND page_id = 0",
                    )
                    .get() as { n: number },
        ).n;
        if (hasRow === 0)
            withDb(blank, (db) =>
                db.exec(
                    "INSERT INTO marcher_pages (marcher_id, page_id, x, y) VALUES (1, 0, 12.5, 40)",
                ),
            );

        const outcome = await openLikeSetActiveDb(blank);

        expect(outcome).toMatchObject({
            kind: "conversion",
            status: "converted",
        });
        const after = stateOf(blank);
        expect(after.userVersion).toBe(8);
        expect(after.timelineMode).toBe(true);
        expect(after.timelines).toBe(1);
        expect(after.transitions).toBe(0);
        expect(after.homes).toEqual([{ id: 1, home_x: 12.5, home_y: 40 }]);
    });

    it.each([
        ["missing", null],
        ["corrupt", "{not json"],
        ["an array", "[1, 2]"],
    ])(
        "turns the flag on when the workspace settings are %s",
        async (_label, json) => {
            withDb(showPath, (db) => {
                if (json === null) db.exec("DELETE FROM workspace_settings");
                else
                    db.prepare(
                        "UPDATE workspace_settings SET json_data = ?",
                    ).run(json);
            });

            const outcome = await openLikeSetActiveDb(showPath);

            expect(outcome).toMatchObject({ status: "converted" });
            expect(JSON.parse(stateOf(showPath).settingsJson!)).toEqual({
                timelineMode: true,
            });
        },
    );

    it("withTimelineModeOn keeps the other settings and replaces bad JSON", () => {
        expect(
            JSON.parse(withTimelineModeOn('{"a":1,"timelineMode":false}')),
        ).toEqual({
            a: 1,
            timelineMode: true,
        });
        expect(JSON.parse(withTimelineModeOn(undefined))).toEqual({
            timelineMode: true,
        });
        expect(JSON.parse(withTimelineModeOn("null"))).toEqual({
            timelineMode: true,
        });
        expect(JSON.parse(withTimelineModeOn("{"))).toEqual({
            timelineMode: true,
        });
    });

    it("doesn't convert again when a converted file is reopened", async () => {
        await openLikeSetActiveDb(showPath);
        const converted = stateOf(showPath);
        const { ui, calls } = testUi();

        const outcome = await openLikeSetActiveDb(showPath, { ui });

        expect(outcome).toEqual({ kind: "none", reason: "timeline-file" });
        expect(stateOf(showPath)).toEqual(converted);
        expect(sha256(showPath)).toBe(hashBeforeStep);
        expect(backupsIn(tempDir)).toHaveLength(1);
        expect(calls).toEqual({ warned: [], prepared: 0 });
    });

    it("rechecks inside the transaction: a file converted meanwhile isn't converted twice", async () => {
        // Another app instance converts the file between the check and the transaction.
        const other = path.join(tempDir, "other.dots");
        fs.copyFileSync(showPath, other);
        await openLikeSetActiveDb(other);
        const convertedElsewhere = fs.readFileSync(other);

        const outcome = await openLikeSetActiveDb(showPath, {
            hooks: {
                backup: (filePath) => {
                    fs.writeFileSync(filePath, convertedElsewhere);
                    return {
                        ok: true,
                        backupPath: path.join(tempDir, "fake-backup.dots"),
                        userVersion: 7,
                    };
                },
            },
        });

        expect(outcome).toMatchObject({
            kind: "conversion",
            status: "already-converted",
        });
        expect(sha256(showPath)).toBe(sha256(other));
        expect(stateOf(showPath).timelines).toBe(1);
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

    it.each(CONVERSION_STEPS)(
        "rolls back completely when the transaction fails after %s, and keeps the backup",
        async (failAfter) => {
            const before = stateOf(showPath);
            expect(before.triggers.length).toBeGreaterThan(0);
            expect(before.history).toHaveLength(2);

            const outcome = await openLikeSetActiveDb(showPath, {
                hooks: {
                    afterStep: (step) => {
                        if (step === failAfter)
                            throw new Error(`disk vanished after ${step}`);
                    },
                },
            });

            if (
                outcome.kind !== "conversion" ||
                outcome.status !== "conversion-failed"
            )
                throw new Error(
                    `expected a failed conversion: ${outcome.kind}`,
                );
            expect(outcome.error.message).toContain(`after ${failAfter}`);
            expect(fs.existsSync(outcome.backupPath)).toBe(true);
            expect(stateOf(outcome.backupPath)).toEqual(before);

            // Nothing partial: version 7, no timeline rows, flag off, and the same history,
            // history stats, change log and triggers as before.
            expect(stateOf(showPath)).toEqual(before);

            // The next open converts it (and backs it up again under the next name).
            const retry = await openLikeSetActiveDb(showPath);
            expect(retry).toMatchObject({
                kind: "conversion",
                status: "converted",
            });
            expect(stateOf(showPath).userVersion).toBe(8);
            expect(backupsIn(tempDir)).toHaveLength(2);
        },
    );

    describe("a version-7 file with timeline rows", () => {
        /** What a release without the version guard does: reset to 7 and edit the page rows. */
        function reopenInOlderRelease() {
            withDb(showPath, (db) => {
                db.exec("PRAGMA user_version = 7");
                db.exec("UPDATE marcher_pages SET x = x + 10 WHERE id = 1");
            });
        }

        it.each(["stop", "open"] as const)(
            "converted, then saved by an older release: warns, offers the backup, never converts again (%s)",
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

        it("without a conversion backup next to it (made with the dev flag): opens as it is, no warning", async () => {
            await openLikeSetActiveDb(showPath);
            reopenInOlderRelease();
            for (const f of backupsIn(tempDir))
                fs.rmSync(path.join(tempDir, f));
            const before = stateOf(showPath);
            const { ui, calls } = testUi("stop");

            const outcome = await openLikeSetActiveDb(showPath, { ui });

            expect(outcome).toEqual({
                kind: "none",
                reason: "dev-timeline-file",
            });
            expect(calls).toEqual({ warned: [], prepared: 0 });
            expect(stateOf(showPath)).toEqual(before);
            expect(sha256(showPath)).toBe(hashBeforeStep);
        });
    });

    describe("findLatestBackup", () => {
        const name = (n: number) =>
            n === 1
                ? `show (${BACKUP_NAME_SUFFIX}).dots`
                : `show (${BACKUP_NAME_SUFFIX} ${n}).dots`;

        it("finds the highest number, across gaps", () => {
            expect(findLatestBackup(showPath)).toBeUndefined();
            fs.writeFileSync(path.join(tempDir, name(1)), "");
            expect(findLatestBackup(showPath)).toBe(
                path.join(tempDir, name(1)),
            );
            fs.writeFileSync(path.join(tempDir, name(3)), "");
            expect(findLatestBackup(showPath)).toBe(
                path.join(tempDir, name(3)),
            );
            fs.rmSync(path.join(tempDir, name(1)));
            fs.writeFileSync(path.join(tempDir, name(12)), "");
            expect(findLatestBackup(showPath)).toBe(
                path.join(tempDir, name(12)),
            );
        });

        it("ignores other shows' backups and similar names", () => {
            fs.writeFileSync(
                path.join(tempDir, `other (${BACKUP_NAME_SUFFIX} 9).dots`),
                "",
            );
            fs.writeFileSync(
                path.join(tempDir, `show (${BACKUP_NAME_SUFFIX} x).dots`),
                "",
            );
            fs.writeFileSync(
                path.join(tempDir, `show (${BACKUP_NAME_SUFFIX} 4).txt`),
                "",
            );
            expect(findLatestBackup(showPath)).toBeUndefined();
        });
    });
});
