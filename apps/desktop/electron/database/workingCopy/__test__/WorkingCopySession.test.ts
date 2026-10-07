import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
    MANIFEST_FILE_NAME,
    WORKING_FILE_NAME,
    type WorkingCopyManifest,
    type WorkingCopyOptions,
    type WorkingCopyStatus,
    WorkingCopySession,
    discardWorkingCopy,
    removeStaleTempFiles,
    scanWorkingCopies,
} from "../WorkingCopySession";
import { hashFileSync } from "../fileIdentity";

const errno = (code: string) =>
    Object.assign(new Error(`${code}: resource busy or locked`), { code });

/** Sidecar and temp files that must never sit beside a show between saves. */
function strayFilesBeside(showPath: string): string[] {
    const name = basename(showPath);
    return fs
        .readdirSync(dirname(showPath))
        .filter((file) => file !== name && file.startsWith(`.~${name}`))
        .concat(
            ["-wal", "-shm", "-journal"]
                .map((suffix) => name + suffix)
                .filter((file) => fs.existsSync(join(dirname(showPath), file))),
        );
}

function readValues(dbPath: string): string[] {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
        return (
            db.prepare("SELECT value FROM notes ORDER BY id").all() as {
                value: string;
            }[]
        ).map((row) => row.value);
    } finally {
        db.close();
    }
}

/** An edit the way the app makes one: a commit on another connection. */
function edit(session: WorkingCopySession, value: string) {
    const db = new DatabaseSync(session.workingPath);
    try {
        db.prepare("INSERT INTO notes (value) VALUES (?)").run(value);
    } finally {
        db.close();
    }
    session.noteActivity();
}

/** The rollback-journal header bytes: 1/1 means not WAL. */
function journalHeader(dbPath: string): [number, number] {
    const header = Buffer.alloc(20);
    const fd = fs.openSync(dbPath, "r");
    fs.readSync(fd, header, 0, 20, 0);
    fs.closeSync(fd);
    return [header[18], header[19]];
}

async function waitFor(
    predicate: () => boolean,
    timeoutMs = 5000,
): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs)
            throw new Error("Timed out waiting for the condition");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

describe("WorkingCopySession", () => {
    let root: string;
    let showDir: string;
    let showPath: string;
    let workingRoot: string;
    let statuses: WorkingCopyStatus[];
    const sessions: WorkingCopySession[] = [];

    const options = (
        overrides: Partial<WorkingCopyOptions> = {},
    ): WorkingCopyOptions => ({
        workingRoot,
        appVersion: "test",
        debounceMs: 30,
        maxWaitMs: 1000,
        onStatus: (status) => statuses.push(status),
        ...overrides,
    });

    const open = async (overrides: Partial<WorkingCopyOptions> = {}) => {
        const session = await WorkingCopySession.open(
            showPath,
            options(overrides),
        );
        sessions.push(session);
        return session;
    };

    beforeEach(() => {
        root = fs.mkdtempSync(join(tmpdir(), "openmarch-working-copy-"));
        showDir = join(root, "My Shows");
        workingRoot = join(root, "userData", "working-copies");
        fs.mkdirSync(showDir, { recursive: true });
        showPath = join(showDir, "Halftime.dots");
        const db = new DatabaseSync(showPath);
        db.exec(
            "CREATE TABLE notes (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
        );
        db.prepare("INSERT INTO notes (value) VALUES (?)").run("original");
        db.close();
        statuses = [];
    });

    afterEach(async () => {
        for (const session of sessions.splice(0))
            await session.close({ discard: true });
        fs.chmodSync(showDir, 0o755);
        if (fs.existsSync(showPath)) fs.chmodSync(showPath, 0o644);
        fs.rmSync(root, { recursive: true, force: true });
    });

    describe("open", () => {
        it("copies the show into a WAL working copy and leaves the show untouched", async () => {
            const before = hashFileSync(showPath);
            const session = await open();

            expect(session.workingPath).toBe(
                join(workingRoot, session.id, WORKING_FILE_NAME),
            );
            expect(readValues(session.workingPath)).toEqual(["original"]);
            const db = new DatabaseSync(session.workingPath);
            expect(
                (db.prepare("PRAGMA journal_mode").get() as any).journal_mode,
            ).toBe("wal");
            db.close();

            expect(hashFileSync(showPath)).toBe(before);
            expect(strayFilesBeside(showPath)).toEqual([]);
            expect(session.status().state).toBe("saved");
        });

        it("runs open-time work on the working copy only", async () => {
            const before = hashFileSync(showPath);
            const session = await WorkingCopySession.open(
                showPath,
                options(),
                (db) => db.exec("CREATE TABLE migrated (id INTEGER)"),
            );
            sessions.push(session);

            expect(hashFileSync(showPath)).toBe(before);
            const db = new DatabaseSync(session.workingPath);
            expect(
                db
                    .prepare(
                        "SELECT name FROM sqlite_master WHERE name = 'migrated'",
                    )
                    .get(),
            ).toBeTruthy();
            db.close();
            // Opening alone isn't an edit.
            expect((await session.flush()).ok).toBe(true);
            expect(hashFileSync(showPath)).toBe(before);
        });

        it("removes the working folder when open-time work fails", async () => {
            await expect(
                WorkingCopySession.open(showPath, options(), () => {
                    throw new Error("migration failed");
                }),
            ).rejects.toThrow("migration failed");
            expect(fs.readdirSync(workingRoot)).toEqual([]);
        });

        it("writes a manifest naming the show file", async () => {
            const session = await open();
            const manifest = JSON.parse(
                fs.readFileSync(
                    join(session.directory, MANIFEST_FILE_NAME),
                    "utf8",
                ),
            ) as WorkingCopyManifest;
            expect(manifest.showPath).toBe(showPath);
            expect(manifest.unsaved).toBe(false);
            expect(manifest.originalIdentity?.sha256).toBe(
                hashFileSync(showPath),
            );
        });
    });

    describe("autosave", () => {
        it("saves an edit to the show after the debounce", async () => {
            const session = await open();
            edit(session, "first edit");
            expect(session.status().state).toBe("unsaved");

            await waitFor(() => session.status().state === "saved");

            expect(readValues(showPath)).toEqual(["original", "first edit"]);
            expect(journalHeader(showPath)).toEqual([1, 1]);
            expect(strayFilesBeside(showPath)).toEqual([]);
            expect(session.status().showPath).toBe(showPath);
        });

        it("doesn't touch the show when nothing changed", async () => {
            const session = await open();
            const { mtimeMs } = fs.statSync(showPath);
            const outcome = await session.flush();
            expect(outcome).toEqual({ ok: true, skipped: true });
            expect(fs.statSync(showPath).mtimeMs).toBe(mtimeMs);
        });

        it("ignores reads", async () => {
            const session = await open();
            const db = new DatabaseSync(session.workingPath);
            db.prepare("SELECT * FROM notes").all();
            db.close();
            session.noteActivity();
            expect(session.status().state).toBe("saved");
        });

        it("saves edits made during a save in the next one", async () => {
            const session = await open({ debounceMs: 10_000 });
            edit(session, "a");
            const saving = session.flush();
            edit(session, "b");
            const first = await saving;
            expect(first.ok).toBe(true);
            await session.flush();
            expect(readValues(showPath)).toEqual(["original", "a", "b"]);
            expect(session.hasUnsavedChanges).toBe(false);
        });

        it("keeps the show's permissions", async () => {
            fs.chmodSync(showPath, 0o640);
            const session = await open();
            edit(session, "x");
            await session.flush();
            expect(fs.statSync(showPath).mode & 0o777).toBe(0o640);
        });

        it("replaces the file a symbolic link points to, not the link", async () => {
            const linkPath = join(root, "link.dots");
            fs.symlinkSync(showPath, linkPath);
            const session = await WorkingCopySession.open(linkPath, options());
            sessions.push(session);
            edit(session, "through the link");
            await session.flush();

            expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
            expect(readValues(showPath)).toContain("through the link");
            expect(session.showPath).toBe(linkPath);
        });

        it("deletes stale temp files beside the show on open", async () => {
            const stale = join(showDir, ".~Halftime.dots.deadbeef.tmp");
            const fresh = join(showDir, ".~Halftime.dots.cafebabe.tmp");
            const unrelated = join(showDir, ".~Other.dots.deadbeef.tmp");
            for (const file of [stale, fresh, unrelated])
                fs.writeFileSync(file, "x");
            const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
            fs.utimesSync(stale, old, old);
            fs.utimesSync(unrelated, old, old);

            removeStaleTempFiles(showPath);

            expect(fs.existsSync(stale)).toBe(false);
            expect(fs.existsSync(fresh)).toBe(true);
            expect(fs.existsSync(unrelated)).toBe(true);
        });
    });

    describe("conflict check", () => {
        it("never overwrites a show another program changed", async () => {
            const session = await open({ debounceMs: 10_000 });
            const other = new DatabaseSync(showPath);
            other.prepare("INSERT INTO notes (value) VALUES (?)").run("theirs");
            other.close();

            edit(session, "mine");
            const outcome = await session.flush();

            expect(outcome).toMatchObject({ ok: false, state: "conflict" });
            expect(session.status().conflict?.reason).toBe("modified");
            expect(session.status().conflict?.changed).toContain("sha256");
            expect(readValues(showPath)).toEqual(["original", "theirs"]);
            expect(strayFilesBeside(showPath)).toEqual([]);

            // Autosave stays paused until the user decides.
            edit(session, "mine again");
            expect((await session.flush()).ok).toBe(false);
            expect(readValues(showPath)).toEqual(["original", "theirs"]);
        });

        it("overwrites when the user keeps their version", async () => {
            const session = await open({ debounceMs: 10_000 });
            const other = new DatabaseSync(showPath);
            other.prepare("INSERT INTO notes (value) VALUES (?)").run("theirs");
            other.close();
            edit(session, "mine");
            await session.flush();

            const outcome = await session.overwriteShow();

            expect(outcome.ok).toBe(true);
            expect(readValues(showPath)).toEqual(["original", "mine"]);
            expect(session.status().state).toBe("saved");
            // Later saves compare against what was just written.
            edit(session, "more");
            expect((await session.flush()).ok).toBe(true);
        });

        it("saves to a new file when the user saves their version as a copy", async () => {
            const session = await open({ debounceMs: 10_000 });
            const other = new DatabaseSync(showPath);
            other.prepare("INSERT INTO notes (value) VALUES (?)").run("theirs");
            other.close();
            edit(session, "mine");
            await session.flush();

            const copyPath = join(showDir, "Halftime (mine).dots");
            const outcome = await session.retarget(copyPath);

            expect(outcome.ok).toBe(true);
            expect(session.showPath).toBe(copyPath);
            expect(readValues(copyPath)).toEqual(["original", "mine"]);
            expect(readValues(showPath)).toEqual(["original", "theirs"]);
        });

        it("reports a show that was moved or deleted", async () => {
            const session = await open({ debounceMs: 10_000 });
            fs.renameSync(showPath, join(showDir, "Renamed.dots"));
            edit(session, "mine");

            const outcome = await session.flush();

            expect(outcome).toMatchObject({ ok: false, state: "conflict" });
            expect(session.status().conflict?.reason).toBe("missing");
            expect(fs.existsSync(showPath)).toBe(false);

            expect((await session.overwriteShow()).ok).toBe(true);
            expect(readValues(showPath)).toEqual(["original", "mine"]);
        });

        it("isn't fooled by a change to the timestamp alone", async () => {
            const session = await open({ debounceMs: 10_000 });
            const later = new Date(Date.now() + 60_000);
            fs.utimesSync(showPath, later, later);
            edit(session, "mine");

            expect((await session.flush()).ok).toBe(true);
            expect(readValues(showPath)).toEqual(["original", "mine"]);
        });

        it("isn't fooled by a sync client re-downloading the same bytes", async () => {
            const session = await open({ debounceMs: 10_000 });
            const copy = join(root, "download.tmp");
            fs.copyFileSync(showPath, copy);
            fs.renameSync(copy, showPath); // new inode, same content
            edit(session, "mine");

            expect((await session.flush()).ok).toBe(true);
        });
    });

    describe("read-only shows", () => {
        it.skipIf(process.getuid?.() === 0)(
            "refuses to save over a read-only show",
            async () => {
                const session = await open({ debounceMs: 10_000 });
                fs.chmodSync(showPath, 0o444);
                edit(session, "mine");

                const outcome = await session.flush();

                expect(outcome).toMatchObject({ ok: false, state: "readOnly" });
                expect(readValues(showPath)).toEqual(["original"]);
                expect(strayFilesBeside(showPath)).toEqual([]);
            },
        );

        it("treats the Windows read-only attribute as read-only", async () => {
            const session = await open({
                debounceMs: 10_000,
                platform: "win32",
            });
            fs.chmodSync(showPath, 0o444);
            edit(session, "mine");

            expect(await session.flush()).toMatchObject({
                ok: false,
                state: "readOnly",
            });
        });
    });

    describe("Windows rename failures", () => {
        it("retries a locked show and then saves", async () => {
            let failures = 3;
            const session = await open({
                debounceMs: 10_000,
                platform: "win32",
                renameOptions: {
                    sleep: async () => {},
                    rename: async (from, to) => {
                        if (failures-- > 0) throw errno("EBUSY");
                        await fs.promises.rename(from, to);
                    },
                },
            });
            edit(session, "mine");

            const outcome = await session.flush();

            expect(outcome).toMatchObject({ ok: true, renameAttempts: 4 });
            expect(readValues(showPath)).toEqual(["original", "mine"]);
        });

        it("defers the save after the retry budget and never writes in place", async () => {
            let time = 0;
            let attempts = 0;
            const session = await open({
                debounceMs: 10_000,
                platform: "win32",
                retryDelaysMs: [60_000],
                renameOptions: {
                    now: () => time,
                    sleep: async (ms) => {
                        time += ms;
                    },
                    rename: async () => {
                        attempts++;
                        throw errno("EPERM");
                    },
                },
            });
            const before = hashFileSync(showPath);
            edit(session, "mine");

            const outcome = await session.flush();

            expect(outcome).toMatchObject({ ok: false, state: "deferred" });
            expect(attempts).toBeGreaterThan(40);
            expect(time).toBeLessThanOrEqual(5000);
            expect(hashFileSync(showPath)).toBe(before);
            expect(strayFilesBeside(showPath)).toEqual([]);
            const status = session.status();
            expect(status.state).toBe("deferred");
            expect(status.retryAt).toBeGreaterThan(Date.now() + 50_000);
            // The working copy keeps the edit.
            expect(readValues(session.workingPath)).toContain("mine");
            expect(session.hasUnsavedChanges).toBe(true);
        });

        it("tries a deferred save again when asked", async () => {
            let locked = true;
            const session = await open({
                debounceMs: 10_000,
                platform: "win32",
                renameOptions: {
                    budgetMs: 0,
                    rename: async (from, to) => {
                        if (locked) throw errno("EBUSY");
                        await fs.promises.rename(from, to);
                    },
                },
            });
            edit(session, "mine");
            expect((await session.flush()).ok).toBe(false);

            locked = false;
            expect((await session.flush("blur")).ok).toBe(true);
            expect(readValues(showPath)).toEqual(["original", "mine"]);
            expect(session.status().state).toBe("saved");
        });
    });

    describe("close", () => {
        it("deletes the working folder after a clean save", async () => {
            const session = await open();
            edit(session, "mine");
            await session.flush();
            const { directory } = session;

            expect(await session.close()).toEqual({ keptForRecovery: false });
            expect(fs.existsSync(directory)).toBe(false);
            expect(readValues(showPath)).toEqual(["original", "mine"]);
        });

        it("keeps unsaved changes for recovery", async () => {
            const session = await open({ debounceMs: 10_000 });
            fs.chmodSync(showPath, 0o444);
            edit(session, "mine");
            await session.flush();

            expect(await session.close()).toEqual({ keptForRecovery: true });
            const manifest = JSON.parse(
                fs.readFileSync(
                    join(session.directory, MANIFEST_FILE_NAME),
                    "utf8",
                ),
            ) as WorkingCopyManifest;
            expect(manifest.unsaved).toBe(true);
            expect(manifest.showPath).toBe(showPath);
        });
    });

    describe("recovery", () => {
        /** Leaves a working copy the way a crash would: open, with unsaved edits. */
        async function crashWithEdit(value: string) {
            const session = await open({ debounceMs: 60_000 });
            edit(session, value);
            // Snapshot the folder as the process would leave it on a kill,
            // including the WAL, then let the live session go.
            const crashedRoot = join(root, "crashed");
            fs.cpSync(session.directory, join(crashedRoot, session.id), {
                recursive: true,
            });
            await session.close({ discard: true });
            sessions.splice(sessions.indexOf(session), 1);
            fs.rmSync(workingRoot, { recursive: true, force: true });
            fs.renameSync(crashedRoot, workingRoot);
        }

        it("offers unsaved working copies left by a crash", async () => {
            await crashWithEdit("unsaved edit");

            const recoverable = scanWorkingCopies(workingRoot);

            expect(recoverable).toHaveLength(1);
            expect(recoverable[0].manifest.showPath).toBe(showPath);
            expect(recoverable[0].manifest.unsaved).toBe(true);
            expect(readValues(showPath)).toEqual(["original"]);
        });

        it("saves the recovered changes to the show", async () => {
            await crashWithEdit("unsaved edit");
            const [entry] = scanWorkingCopies(workingRoot);

            const session = await WorkingCopySession.resume(
                entry,
                options({ debounceMs: 10 }),
            );
            sessions.push(session);
            expect(session.showPath).toBe(showPath);

            await waitFor(() => session.status().state === "saved");
            expect(readValues(showPath)).toEqual(["original", "unsaved edit"]);
            await session.close();
            expect(scanWorkingCopies(workingRoot)).toEqual([]);
        });

        it("asks before recovering over a show that changed meanwhile", async () => {
            await crashWithEdit("unsaved edit");
            const other = new DatabaseSync(showPath);
            other.prepare("INSERT INTO notes (value) VALUES (?)").run("theirs");
            other.close();
            const [entry] = scanWorkingCopies(workingRoot);

            const session = await WorkingCopySession.resume(
                entry,
                options({ debounceMs: 10_000 }),
            );
            sessions.push(session);

            expect(await session.flush()).toMatchObject({
                ok: false,
                state: "conflict",
            });
            expect(readValues(showPath)).toEqual(["original", "theirs"]);
        });

        it("cleans up working copies that were saved", async () => {
            const session = await open();
            const leftover = join(workingRoot, "leftover");
            fs.cpSync(session.directory, leftover, { recursive: true });

            expect(
                scanWorkingCopies(workingRoot, new Set([session.id])),
            ).toEqual([]);
            expect(fs.existsSync(leftover)).toBe(false);
            expect(fs.existsSync(session.directory)).toBe(true);
        });

        it("discards a recoverable copy on request", async () => {
            await crashWithEdit("unsaved edit");
            const [entry] = scanWorkingCopies(workingRoot);
            discardWorkingCopy(entry);
            expect(scanWorkingCopies(workingRoot)).toEqual([]);
            expect(readValues(showPath)).toEqual(["original"]);
        });
    });

    it("reports status changes as edits are saved", async () => {
        const session = await open();
        edit(session, "mine");
        await waitFor(() => session.status().state === "saved");
        expect(statuses.map((status) => status.state)).toEqual([
            "unsaved",
            "saving",
            "saved",
        ]);
        expect(statuses.every((status) => status.showPath === showPath)).toBe(
            true,
        );
    });
});
