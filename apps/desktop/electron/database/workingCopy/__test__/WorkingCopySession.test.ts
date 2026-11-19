import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
    type PublishMetrics,
    type WorkingCopyOptions,
    type WorkingCopyStatus,
    WorkingCopySession,
    findRecoverableFor,
    removeStaleTempFiles,
    scanWorkingCopies,
} from "../WorkingCopySession";

const errno = (code: string) =>
    Object.assign(new Error(`${code}: resource busy or locked`), { code });

/** Anything beside a show other than the show: temp files and SQLite sidecars. */
function strayFilesBeside(showPath: string): string[] {
    const name = basename(showPath);
    return fs.readdirSync(dirname(showPath)).filter((file) => file !== name);
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
function edit(session: WorkingCopySession, value: string, notify = true) {
    const db = new DatabaseSync(session.workingPath);
    try {
        db.prepare("INSERT INTO notes (value) VALUES (?)").run(value);
    } finally {
        db.close();
    }
    if (notify) session.noteActivity();
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000) {
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
    let published: PublishMetrics[];
    let sessions: WorkingCopySession[];

    const options = (
        extra: Partial<WorkingCopyOptions> = {},
    ): WorkingCopyOptions => ({
        workingRoot,
        // Long timers: tests publish with flush() unless they test the timing.
        debounceMs: 60_000,
        maxWaitMs: 60_000,
        pollMs: 60_000,
        onStatus: (status) => statuses.push(status),
        onPublish: (event) => {
            if (event.ok) published.push(event.metrics);
        },
        ...extra,
    });

    async function openStarted(extra: Partial<WorkingCopyOptions> = {}) {
        const { session, staleTempFiles } = await WorkingCopySession.open(
            showPath,
            options(extra),
        );
        sessions.push(session);
        await session.start();
        return { session, staleTempFiles };
    }

    beforeEach(() => {
        root = fs.mkdtempSync(join(tmpdir(), "openmarch-wc-"));
        showDir = join(root, "OneDrive", "Band");
        fs.mkdirSync(showDir, { recursive: true });
        workingRoot = join(root, "userData", "working-copies");
        showPath = join(showDir, "Show.dots");
        const db = new DatabaseSync(showPath);
        db.exec(
            "CREATE TABLE notes (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
        );
        db.prepare("INSERT INTO notes (value) VALUES ('first')").run();
        db.close();
        statuses = [];
        published = [];
        sessions = [];
    });

    afterEach(async () => {
        for (const session of sessions) await session.close({ discard: true });
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("edits a WAL copy in user data and leaves the show untouched until it publishes", async () => {
        const before = fs.readFileSync(showPath);
        const { session } = await openStarted();

        expect(session.workingPath.startsWith(workingRoot)).toBe(true);
        edit(session, "second");

        expect(fs.readFileSync(showPath).equals(before)).toBe(true);
        expect(strayFilesBeside(showPath)).toEqual([]);
        expect(session.status().state).toBe("unsaved");

        const outcome = await session.flush("test");

        expect(outcome.ok).toBe(true);
        expect(readValues(showPath)).toEqual(["first", "second"]);
        // Only the finished file ever went beside the show, and it's gone now.
        expect(strayFilesBeside(showPath)).toEqual([]);
        expect(session.status().state).toBe("saved");
        // The published show is a plain rollback-journal file, not WAL.
        const header = fs.readFileSync(showPath).subarray(18, 20);
        expect([...header]).toEqual([1, 1]);
    });

    it("deletes temp files a crashed publish left beside the show, whatever their age", async () => {
        const fresh = join(showDir, ".~Show.dots.0a1b2c3d.tmp");
        const journal = join(showDir, ".~Show.dots.0a1b2c3d.tmp-journal");
        const other = join(showDir, ".~Other.dots.0a1b2c3d.tmp");
        for (const file of [fresh, journal, other]) fs.writeFileSync(file, "x");

        const { staleTempFiles } = await openStarted();

        expect(staleTempFiles).toBe(2);
        expect(fs.existsSync(fresh)).toBe(false);
        expect(fs.existsSync(journal)).toBe(false);
        expect(fs.existsSync(other)).toBe(true);
    });

    it("reads the show's bytes only when its stat changed", async () => {
        const { session } = await openStarted();
        edit(session, "a");
        await session.flush("test");
        edit(session, "b");
        await session.flush("test");
        expect(published.map((m) => m.hashedShow)).toEqual([false, false]);

        // Touched, same bytes: hashed, and not a conflict.
        const now = new Date(Date.now() + 5000);
        fs.utimesSync(showPath, now, now);
        edit(session, "c");
        const outcome = await session.flush("test");

        expect(outcome.ok).toBe(true);
        expect(published[2].hashedShow).toBe(true);
        expect(readValues(showPath)).toEqual(["first", "a", "b", "c"]);
    });

    it("tells a touch from a change using the hash taken in the background at open", async () => {
        const { session } = await openStarted();
        // Let the open-time hash finish.
        await session.flush("settle", true);
        const now = new Date(Date.now() + 5000);
        fs.utimesSync(showPath, now, now);
        edit(session, "mine");

        expect((await session.flush("test")).ok).toBe(true);
    });

    it("pauses instead of overwriting a show another program changed", async () => {
        const { session } = await openStarted();
        const other = new DatabaseSync(showPath);
        other.prepare("INSERT INTO notes (value) VALUES ('theirs')").run();
        other.close();
        edit(session, "mine");

        const outcome = await session.flush("test");

        expect(outcome).toMatchObject({ ok: false, state: "conflict" });
        expect(readValues(showPath)).toEqual(["first", "theirs"]);
        expect(strayFilesBeside(showPath)).toEqual([]);

        expect((await session.overwriteShow()).ok).toBe(true);
        expect(readValues(showPath)).toEqual(["first", "mine"]);
    });

    it("reports a missing show as a conflict", async () => {
        const { session } = await openStarted();
        fs.rmSync(showPath);
        edit(session, "mine");

        const outcome = await session.flush("test");

        expect(outcome).toMatchObject({ ok: false, state: "conflict" });
        expect(session.status().conflict?.reason).toBe("missing");
    });

    it("retries a blocked publish within seconds and cleans up its temp file", async () => {
        let blocked = true;
        const { session } = await openStarted({
            platform: "win32",
            renameOptions: {
                budgetMs: 0,
                rename: async (from, to) => {
                    if (blocked) throw errno("EBUSY");
                    await fs.promises.rename(from, to);
                },
            },
            retryDelaysMs: [50, 100],
        });
        edit(session, "mine");

        const started = Date.now();
        const outcome = await session.flush("test");

        expect(outcome).toMatchObject({ ok: false, state: "deferred" });
        const status = session.status();
        expect(status.errorCode).toBe("EBUSY");
        expect(status.retryAt! - started).toBeLessThan(1000);
        expect(strayFilesBeside(showPath)).toEqual([]);

        blocked = false;
        await waitFor(() => session.status().state === "saved");
        expect(readValues(showPath)).toEqual(["first", "mine"]);
        expect(published.at(-1)?.deferralsBefore).toBe(1);
    });

    it("uses the default retry delays of 2, 4, 8, 15 and 30 s", async () => {
        const { DEFAULT_TIMING } = await import("../WorkingCopySession");
        expect(DEFAULT_TIMING.retryDelaysMs).toEqual([
            2000, 4000, 8000, 15000, 30000,
        ]);
        expect(DEFAULT_TIMING.debounceMs).toBe(15_000);
        expect(DEFAULT_TIMING.maxWaitMs).toBe(30_000);
    });

    it("publishes once a burst of edits goes quiet, and notices commits nobody reported", async () => {
        const { session } = await openStarted({ debounceMs: 80, pollMs: 20 });
        for (const value of ["a", "b", "c"]) edit(session, value, false);

        await waitFor(() => published.length === 1);
        expect(published[0].reason).toBe("idle");
        expect(readValues(showPath)).toEqual(["first", "a", "b", "c"]);
    });

    it("publishes at the maximum wait while edits keep coming", async () => {
        const { session } = await openStarted({
            debounceMs: 200,
            maxWaitMs: 100,
        });
        edit(session, "a");
        await new Promise((resolve) => setTimeout(resolve, 60));
        edit(session, "b");

        await waitFor(() => published.length === 1);
        expect(published[0].reason).toBe("max-wait");
    });

    it("keeps a read-only show and offers nothing over it", async () => {
        const { session } = await openStarted();
        fs.chmodSync(showPath, 0o444);
        edit(session, "mine");

        const outcome = await session.flush("test");
        fs.chmodSync(showPath, 0o644);

        if (process.getuid?.() === 0) return; // root can write anyway
        expect(outcome).toMatchObject({ ok: false, state: "readOnly" });
        expect(readValues(showPath)).toEqual(["first"]);
    });

    it("publishes to a new path after Save As", async () => {
        const { session } = await openStarted();
        edit(session, "mine");
        const copy = join(showDir, "Copy.dots");

        expect((await session.retarget(copy)).ok).toBe(true);

        expect(readValues(copy)).toEqual(["first", "mine"]);
        expect(readValues(showPath)).toEqual(["first"]);
        expect(session.showPath).toBe(copy);
    });

    it("keeps unpublished changes for recovery and recovers them", async () => {
        const { session } = await openStarted();
        edit(session, "unsaved");
        const { keptForRecovery } = await session.close();
        expect(keptForRecovery).toBe(true);

        const entries = scanWorkingCopies(workingRoot);
        expect(entries).toHaveLength(1);
        const entry = findRecoverableFor(entries, showPath);
        expect(entry?.manifest.showPath).toBe(showPath);

        const resumed = WorkingCopySession.resume(entry!, options());
        sessions.push(resumed);
        await resumed.start();
        expect(resumed.hasUnsavedChanges).toBe(true);

        expect((await resumed.flush("recover")).ok).toBe(true);
        expect(readValues(showPath)).toEqual(["first", "unsaved"]);
        await resumed.close();
        expect(scanWorkingCopies(workingRoot)).toEqual([]);
    });

    it("recovers a working copy whose process died without closing it", async () => {
        const { session } = await openStarted();
        edit(session, "crash");
        // A crash: nothing closes the session. Copy its folder as the next launch finds it.
        const crashedRoot = join(root, "crashed");
        fs.cpSync(session.directory, join(crashedRoot, session.id), {
            recursive: true,
        });

        const [entry] = scanWorkingCopies(crashedRoot);
        const resumed = WorkingCopySession.resume(entry, {
            ...options(),
            workingRoot: crashedRoot,
        });
        sessions.push(resumed);
        await resumed.start();
        await resumed.flush("recover");

        expect(readValues(showPath)).toEqual(["first", "crash"]);
    });

    it("deletes the working folder on a clean close and leaves only the show", async () => {
        const { session } = await openStarted();
        edit(session, "mine");
        await session.flush("close");
        const { keptForRecovery } = await session.close();

        expect(keptForRecovery).toBe(false);
        expect(fs.existsSync(session.directory)).toBe(false);
        expect(fs.readdirSync(showDir)).toEqual(["Show.dots"]);
    });

    it("removeStaleTempFiles counts and deletes only this show's temp files", async () => {
        fs.writeFileSync(join(showDir, ".~Show.dots.ff.tmp"), "x");
        expect(await removeStaleTempFiles(showPath)).toEqual({
            found: 1,
            removed: 1,
        });
    });
});
