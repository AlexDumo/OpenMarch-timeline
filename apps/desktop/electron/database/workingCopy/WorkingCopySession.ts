/* eslint-disable no-console */
/**
 * Editing a show through a private working copy (ADR 0018).
 *
 * The show the person picked (the "show file") is copied into a folder under the app's user
 * data. Every connection edits that working copy, in WAL mode with synchronous=NORMAL. Publishing
 * snapshots the working copy inside that folder, then puts the finished file beside the show and
 * renames it over the show, after checking that nothing else changed the show since OpenMarch
 * last loaded or published it.
 *
 * This module has no Electron imports; electron/main/workingCopyHost.ts wires it to the window,
 * dialogs and settings.
 */
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
    RenameRetriesExhaustedError,
    type RenameRetryOptions,
    publishFile,
    removeWithRetry,
    tempFilePattern,
} from "../atomicFile";
import {
    type FileIdentity,
    checkForConflict,
    sameStat,
    statIdentity,
} from "./fileIdentity";
import { type ExecFile, copyFileMetadata, isReadOnly } from "./fileMetadata";
import { SaveWorker } from "./saveWorker";

export const WORKING_FILE_NAME = "show.dots";
export const MANIFEST_FILE_NAME = "manifest.json";
/** The snapshot a publish builds before it goes beside the show. */
const SNAPSHOT_FILE_NAME = "publish.dots";

/** Stored beside each working copy so a crash can be recovered from. */
export type WorkingCopyManifest = {
    version: 1;
    id: string;
    /** The show file, as the person knows it. */
    showPath: string;
    /**
     * The show file as OpenMarch last loaded or published it. Null when there is nothing to
     * compare with, such as after Save As to a new file.
     */
    originalIdentity: FileIdentity | null;
    /** True from the first edit after a publish until the next publish succeeds. */
    unsaved: boolean;
    pid: number;
    appVersion: string;
    openedAt: string;
    lastEditAt: string | null;
    lastSavedAt: string | null;
};

export type WorkingCopyState =
    | "saved"
    | "unsaved"
    | "saving"
    | "conflict"
    | "deferred"
    | "readOnly"
    | "closed";

export type WorkingCopyStatus = {
    state: WorkingCopyState;
    showPath: string;
    lastSavedAt: string | null;
    /** Why the last publish didn't happen, for "conflict", "deferred" and "readOnly". */
    message?: string;
    /** The error code of a deferred publish (EBUSY, ENOSPC…), when there was one. */
    errorCode?: string;
    conflict?: { reason: "modified" | "missing"; changed: string[] };
    /** When a deferred publish will be tried again (ms since the epoch). */
    retryAt?: number;
    /** The sync app whose folder holds the show ("OneDrive"…), added by the app. */
    syncService?: string | null;
};

/** How the person resolves a show that changed on disk. */
export type WorkingCopyConflictChoice = "keepMine" | "keepTheirs" | "saveCopy";

/** A crashed session's unpublished changes, as the app lists them. */
export type RecoverableShow = {
    id: string;
    showPath: string;
    showExists: boolean;
    lastEditAt: string | null;
};

/** What one publish did, for logs and telemetry. No paths or names. */
export type PublishMetrics = {
    reason: string;
    durationMs: number;
    bytes: number;
    renameAttempts: number;
    /** Whether the show had to be read and hashed (its stat had changed). */
    hashedShow: boolean;
    /** Failed publishes in a row before this one. */
    deferralsBefore: number;
    vacuumMs: number;
};

export type SaveOutcome =
    | { ok: true; skipped?: boolean; metrics?: PublishMetrics }
    | {
          ok: false;
          state: "conflict" | "deferred" | "readOnly" | "closed";
          message: string;
      };

export type WorkingCopyOptions = {
    /** The folder that holds one sub-folder per working copy. */
    workingRoot: string;
    appVersion?: string;
    /** How long after the last edit to publish. */
    debounceMs?: number;
    /** The longest a pending publish waits while edits keep coming. */
    maxWaitMs?: number;
    /** Waits before retrying a publish that failed, in order; the last repeats. */
    retryDelaysMs?: number[];
    /** How often to look for commits no handler reported (another connection's). */
    pollMs?: number;
    platform?: NodeJS.Platform;
    onStatus?: (status: WorkingCopyStatus) => void;
    /** Called after each publish attempt that reached the disk, for telemetry. */
    onPublish?: (
        event:
            | { ok: true; metrics: PublishMetrics }
            | { ok: false; state: string; errorCode?: string; reason: string },
    ) => void;
    /** Overrides for the rename step, for tests. */
    renameOptions?: RenameRetryOptions;
    /** Runs the `xattr` tool, for tests. */
    exec?: ExecFile;
};

export type RecoverableWorkingCopy = {
    id: string;
    directory: string;
    workingPath: string;
    manifest: WorkingCopyManifest;
};

/**
 * The publish timing (ADR 0018): about 15 s after the last edit, so a burst of edits becomes
 * one upload for a sync app, and at most 30 s while edits keep coming. A blocked publish is
 * tried again after a few seconds, backing off to every 30 s.
 */
export const DEFAULT_TIMING = {
    debounceMs: 15_000,
    maxWaitMs: 30_000,
    retryDelaysMs: [2_000, 4_000, 8_000, 15_000, 30_000],
    pollMs: 2_000,
} as const;

/** Bounds the working copy's WAL: checkpoint every 1000 pages, trim it back to 32 MB. */
const WAL_PRAGMAS = [
    "PRAGMA journal_mode = WAL",
    "PRAGMA synchronous = NORMAL",
    "PRAGMA wal_autocheckpoint = 1000",
    `PRAGMA journal_size_limit = ${32 * 1024 * 1024}`,
];

class ChangedDuringPublishError extends Error {
    constructor(name: string) {
        super(`${name} changed on disk while OpenMarch was saving it`);
    }
}

function getSqlite(): typeof import("node:sqlite") {
    const sqlite = process.getBuiltinModule?.("node:sqlite") as
        | typeof import("node:sqlite")
        | undefined;
    if (!sqlite?.DatabaseSync) throw new Error("node:sqlite is unavailable");
    return sqlite;
}

function writeManifest(directory: string, manifest: WorkingCopyManifest) {
    const target = join(directory, MANIFEST_FILE_NAME);
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(manifest, null, 2));
    fs.renameSync(temp, target);
}

function readManifest(directory: string): WorkingCopyManifest | null {
    try {
        const manifest = JSON.parse(
            fs.readFileSync(join(directory, MANIFEST_FILE_NAME), "utf8"),
        ) as WorkingCopyManifest;
        return manifest?.version === 1 && typeof manifest.showPath === "string"
            ? manifest
            : null;
    } catch {
        return null;
    }
}

/** The file a publish replaces: the show file with symbolic links resolved. */
export function resolveSaveTarget(showPath: string): string {
    try {
        return fs.realpathSync(showPath);
    } catch {
        try {
            return join(fs.realpathSync(dirname(showPath)), basename(showPath));
        } catch {
            return showPath;
        }
    }
}

/**
 * Deletes `.~<name>.<hex>.tmp` files beside the show, whatever their age: only OpenMarch makes
 * them, and a publish removes its own unless something stopped it (a crash, or a sync app
 * holding the file). Deletes are retried briefly; one still held is left for next time.
 */
export async function removeStaleTempFiles(
    showFile: string,
): Promise<{ found: number; removed: number }> {
    const directory = dirname(showFile);
    const pattern = tempFilePattern(basename(showFile));
    let names: string[];
    try {
        names = await fs.promises.readdir(directory);
    } catch {
        return { found: 0, removed: 0 };
    }
    let found = 0;
    let removed = 0;
    for (const name of names) {
        if (!pattern.test(name)) continue;
        found++;
        if (await removeWithRetry(join(directory, name), { budgetMs: 1000 }))
            removed++;
    }
    return { found, removed };
}

/**
 * Lists working copies left by a previous run. Call it at startup, before any working copy is
 * open: the single-instance lock means every folder found then belongs to a process that has
 * exited.
 *
 * Folders whose show was published are deleted. Folders with unpublished changes are returned so
 * the person can recover or discard them.
 */
export function scanWorkingCopies(
    workingRoot: string,
    exclude: ReadonlySet<string> = new Set(),
): RecoverableWorkingCopy[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(workingRoot, { withFileTypes: true });
    } catch {
        return [];
    }
    const recoverable: RecoverableWorkingCopy[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || exclude.has(entry.name)) continue;
        const directory = join(workingRoot, entry.name);
        const manifest = readManifest(directory);
        const workingPath = join(directory, WORKING_FILE_NAME);
        if (!manifest || !manifest.unsaved || !fs.existsSync(workingPath)) {
            // Nothing to recover: a clean close, a crash before the first edit, or an open that
            // never finished.
            fs.rmSync(directory, { recursive: true, force: true });
            continue;
        }
        recoverable.push({ id: entry.name, directory, workingPath, manifest });
    }
    return recoverable.sort((a, b) =>
        (b.manifest.lastEditAt ?? "").localeCompare(
            a.manifest.lastEditAt ?? "",
        ),
    );
}

/** The recoverable working copy for `showPath`, if any: the most recently edited one. */
export function findRecoverableFor(
    entries: readonly RecoverableWorkingCopy[],
    showPath: string,
): RecoverableWorkingCopy | undefined {
    const wanted = resolveSaveTarget(resolve(showPath));
    return entries.find(
        (entry) =>
            resolveSaveTarget(resolve(entry.manifest.showPath)) === wanted,
    );
}

export function discardWorkingCopy(entry: { directory: string }) {
    fs.rmSync(entry.directory, { recursive: true, force: true });
}

function openWorkingConnection(workingPath: string): DatabaseSync {
    const db = new (getSqlite().DatabaseSync)(workingPath);
    for (const pragma of WAL_PRAGMAS) db.exec(pragma);
    return db;
}

export class WorkingCopySession {
    readonly id: string;
    readonly directory: string;
    readonly workingPath: string;

    private manifest: WorkingCopyManifest;
    private targetPath: string;
    private expected: FileIdentity | null;
    private readonly options: Required<
        Pick<
            WorkingCopyOptions,
            "debounceMs" | "maxWaitMs" | "retryDelaysMs" | "pollMs" | "platform"
        >
    > &
        WorkingCopyOptions;

    private watcher: DatabaseSync | null = null;
    private dataVersionStatement: StatementSync | null = null;
    private lastDataVersion = 0;
    private worker: SaveWorker | null = null;
    /** The open-time hash of the show, read on the worker. */
    private expectedHash: Promise<void> = Promise.resolve();

    /** Bumped on every detected commit; a publish covers the generation it started at. */
    private editGeneration = 0;
    private savedGeneration = 0;
    private state: WorkingCopyState = "saved";
    private message: string | undefined;
    private errorCode: string | undefined;
    private conflict: WorkingCopyStatus["conflict"];
    private retryAt: number | undefined;
    private retryIndex = 0;
    private overwriteOnce = false;
    private started = false;
    private closed = false;

    private debounceTimer: NodeJS.Timeout | null = null;
    private maxWaitTimer: NodeJS.Timeout | null = null;
    private retryTimer: NodeJS.Timeout | null = null;
    private pollTimer: NodeJS.Timeout | null = null;
    private queue: Promise<unknown> = Promise.resolve();

    private constructor(
        directory: string,
        manifest: WorkingCopyManifest,
        options: WorkingCopyOptions,
    ) {
        this.id = manifest.id;
        this.directory = directory;
        this.workingPath = join(directory, WORKING_FILE_NAME);
        this.manifest = manifest;
        this.targetPath = resolveSaveTarget(manifest.showPath);
        this.expected = manifest.originalIdentity;
        this.options = {
            ...DEFAULT_TIMING,
            retryDelaysMs: [...DEFAULT_TIMING.retryDelaysMs],
            platform: process.platform,
            ...options,
        };
    }

    /**
     * Copies `showPath` into a new working copy, in WAL mode, and returns its session, not yet
     * started: the caller runs migrations on {@link workingPath}, then calls {@link start}.
     *
     * The copy uses SQLite's backup API on a connection to the show, so a hot journal is played
     * back first (back the show and its journal up before calling this) and the copy is
     * consistent. That connection is closed before this returns. Nothing else is written to the
     * show. Temp files a crashed publish left beside it are deleted.
     */
    static async open(
        showPath: string,
        options: WorkingCopyOptions,
    ): Promise<{
        session: WorkingCopySession;
        staleTempFiles: number;
    }> {
        const sqlite = getSqlite();
        const absoluteShowPath = resolve(showPath);
        const target = resolveSaveTarget(absoluteShowPath);
        const id = randomUUID();
        const directory = join(options.workingRoot, id);
        const workingPath = join(directory, WORKING_FILE_NAME);
        fs.mkdirSync(directory, { recursive: true });

        try {
            const { found } = await removeStaleTempFiles(target);
            let identity: FileIdentity | null = null;
            for (let attempt = 0; attempt < 3 && !identity; attempt++) {
                for (const suffix of ["", "-wal", "-shm", "-journal"])
                    fs.rmSync(workingPath + suffix, { force: true });
                const before = statIdentity(fs.statSync(target));
                const source = new sqlite.DatabaseSync(target);
                try {
                    source.exec("PRAGMA busy_timeout = 5000");
                    await sqlite.backup(source, workingPath);
                } finally {
                    source.close();
                }
                const after = statIdentity(fs.statSync(target));
                // Opening the show can roll back a hot journal, and another program could write
                // meanwhile: copy again until it holds still. The hash comes later, off this
                // thread (start()).
                if (sameStat(before, after))
                    identity = { ...after, sha256: null };
            }
            if (!identity)
                throw new Error(
                    `The show kept changing while OpenMarch copied it: ${absoluteShowPath}`,
                );

            openWorkingConnection(workingPath).close();

            const manifest: WorkingCopyManifest = {
                version: 1,
                id,
                showPath: absoluteShowPath,
                originalIdentity: identity,
                unsaved: false,
                pid: process.pid,
                appVersion: options.appVersion ?? "",
                openedAt: new Date().toISOString(),
                lastEditAt: null,
                lastSavedAt: null,
            };
            writeManifest(directory, manifest);
            return {
                session: new WorkingCopySession(directory, manifest, options),
                staleTempFiles: found,
            };
        } catch (error) {
            fs.rmSync(directory, { recursive: true, force: true });
            throw error;
        }
    }

    /**
     * Reopens a working copy left by a crash (replaying its WAL) and checks it. Like
     * {@link open}, the caller migrates it and calls {@link start}; the recovered changes are
     * then published after the usual check that the show hasn't changed since it was last
     * loaded or published.
     */
    static resume(
        entry: RecoverableWorkingCopy,
        options: WorkingCopyOptions,
    ): WorkingCopySession {
        const db = openWorkingConnection(entry.workingPath);
        try {
            const check = db.prepare("PRAGMA quick_check").get() as {
                quick_check: string;
            };
            if (check.quick_check !== "ok")
                throw new Error(
                    `The recovered working copy is damaged: ${check.quick_check}`,
                );
        } finally {
            db.close();
        }
        const manifest: WorkingCopyManifest = {
            ...entry.manifest,
            pid: process.pid,
            appVersion: options.appVersion ?? entry.manifest.appVersion,
            unsaved: true,
        };
        writeManifest(entry.directory, manifest);
        const session = new WorkingCopySession(
            entry.directory,
            manifest,
            options,
        );
        session.editGeneration = 1;
        session.state = "unsaved";
        return session;
    }

    /** The person's show file. Use this for titles, recent files and exports. */
    get showPath(): string {
        return this.manifest.showPath;
    }

    get hasUnsavedChanges(): boolean {
        return this.editGeneration !== this.savedGeneration;
    }

    status(): WorkingCopyStatus {
        return {
            state: this.state,
            showPath: this.manifest.showPath,
            lastSavedAt: this.manifest.lastSavedAt,
            ...(this.message ? { message: this.message } : {}),
            ...(this.errorCode ? { errorCode: this.errorCode } : {}),
            ...(this.conflict ? { conflict: this.conflict } : {}),
            ...(this.retryAt ? { retryAt: this.retryAt } : {}),
        };
    }

    /**
     * Starts noticing edits and publishing. Call once the working copy is migrated: changes made
     * before this (migrations) are published with the first edit, not on their own.
     */
    async start(): Promise<void> {
        if (this.started) return;
        this.started = true;
        this.watcher = new (getSqlite().DatabaseSync)(this.workingPath);
        this.dataVersionStatement = this.watcher.prepare("PRAGMA data_version");
        this.lastDataVersion = (
            this.dataVersionStatement.get() as { data_version: number }
        ).data_version;
        this.worker = await SaveWorker.start(this.workingPath);
        this.hashShowInBackground();
        this.pollTimer = setInterval(
            () => this.noteActivity(),
            this.options.pollMs,
        );
        this.pollTimer.unref?.();
        if (this.hasUnsavedChanges) this.scheduleSave();
        this.options.onStatus?.(this.status());
    }

    /**
     * Call after anything may have written to the working copy. Notices commits from any
     * connection through `PRAGMA data_version`, which changes when another connection commits.
     */
    noteActivity(): void {
        if (this.closed || !this.dataVersionStatement) return;
        let version: number;
        try {
            version = (
                this.dataVersionStatement.get() as { data_version: number }
            ).data_version;
        } catch (error) {
            console.error("Couldn't read the working copy's version:", error);
            return;
        }
        if (version === this.lastDataVersion) return;
        this.lastDataVersion = version;
        this.markDirty();
    }

    /** Records an edit and schedules a publish. */
    markDirty(): void {
        if (this.closed) return;
        this.editGeneration++;
        this.manifest.lastEditAt = new Date().toISOString();
        if (!this.manifest.unsaved) {
            this.manifest.unsaved = true;
            this.persistManifest();
        }
        // A conflict or a read-only show waits for the person; a deferred publish waits for its
        // retry (or the next blur, close or Ctrl/Cmd+S).
        if (
            this.state === "conflict" ||
            this.state === "readOnly" ||
            this.state === "deferred"
        )
            return;
        if (this.state !== "saving") this.setState("unsaved");
        this.scheduleSave();
    }

    /**
     * Publishes now if there are unpublished changes. Publishes run one at a time; a call made
     * during a publish waits for it and then publishes again if needed.
     */
    flush(reason = "flush", force = false): Promise<SaveOutcome> {
        // A commit no handler reported yet (the poll runs every few seconds) still counts.
        this.noteActivity();
        this.clearSaveTimers();
        const run = this.queue.then(() => this.saveIfNeeded(reason, force));
        this.queue = run.catch(() => undefined);
        return run;
    }

    /** Publishes over the show even though it changed on disk ("Keep my version"). */
    overwriteShow(): Promise<SaveOutcome> {
        this.overwriteOnce = true;
        if (this.state === "conflict" || this.state === "readOnly")
            this.setState("unsaved");
        return this.flush("overwrite", true);
    }

    /**
     * Makes `newShowPath` the show and publishes to it ("Save mine as a copy", or Save As). The
     * save dialog already confirmed replacing a file there.
     */
    retarget(newShowPath: string): Promise<SaveOutcome> {
        this.manifest.showPath = resolve(newShowPath);
        this.manifest.originalIdentity = null;
        this.targetPath = resolveSaveTarget(this.manifest.showPath);
        this.expected = null;
        this.conflict = undefined;
        this.message = undefined;
        this.retryIndex = 0;
        this.editGeneration++;
        this.manifest.unsaved = true;
        this.persistManifest();
        this.setState("unsaved");
        return this.flush("retarget", true);
    }

    /**
     * Stops publishing and releases the working copy. Close every other connection to it first.
     * Without unpublished changes (or with `discard`) the working folder is deleted; otherwise
     * it's kept for recovery.
     */
    async close({ discard = false } = {}): Promise<{
        keptForRecovery: boolean;
    }> {
        if (this.closed) return { keptForRecovery: false };
        this.clearSaveTimers();
        this.clearRetryTimer();
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = null;
        await this.queue;
        this.closed = true;
        this.dataVersionStatement = null;
        this.watcher?.close();
        this.watcher = null;
        await this.worker?.close();
        this.worker = null;
        const keep = !discard && this.hasUnsavedChanges;
        if (keep) this.persistManifest();
        else fs.rmSync(this.directory, { recursive: true, force: true });
        this.setState("closed");
        return { keptForRecovery: keep };
    }

    /** Hashes the show on the worker, so later publishes can tell a touch from a change. */
    private hashShowInBackground() {
        const expected = this.expected;
        if (!expected || expected.sha256 !== null || !this.worker) return;
        this.expectedHash = this.worker
            .identity(this.targetPath)
            .then((identity) => {
                // The hash belongs to the file as loaded only if the file is still the same.
                if (
                    identity?.sha256 &&
                    this.expected === expected &&
                    sameStat(identity, expected)
                ) {
                    expected.sha256 = identity.sha256;
                    this.persistManifest();
                }
            })
            .catch((error) =>
                console.warn(
                    "Couldn't hash the show in the background:",
                    error,
                ),
            );
    }

    private persistManifest() {
        try {
            writeManifest(this.directory, this.manifest);
        } catch (error) {
            console.error("Couldn't write the working copy manifest:", error);
        }
    }

    private setState(
        state: WorkingCopyState,
        details: Pick<
            WorkingCopyStatus,
            "message" | "conflict" | "retryAt" | "errorCode"
        > = {},
    ) {
        this.state = state;
        this.message = details.message;
        this.errorCode = details.errorCode;
        this.conflict = details.conflict;
        this.retryAt = details.retryAt;
        this.options.onStatus?.(this.status());
    }

    private scheduleSave() {
        if (!this.started) return;
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(
            () => void this.flush("idle"),
            this.options.debounceMs,
        );
        if (!this.maxWaitTimer)
            this.maxWaitTimer = setTimeout(
                () => void this.flush("max-wait"),
                this.options.maxWaitMs,
            );
    }

    private clearSaveTimers() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        if (this.maxWaitTimer) clearTimeout(this.maxWaitTimer);
        this.debounceTimer = null;
        this.maxWaitTimer = null;
    }

    private clearRetryTimer() {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
    }

    private async ensureWorker(): Promise<SaveWorker> {
        if (this.worker?.alive) return this.worker;
        await this.worker?.close();
        this.worker = await SaveWorker.start(this.workingPath);
        return this.worker;
    }

    private async saveIfNeeded(
        reason: string,
        force: boolean,
    ): Promise<SaveOutcome> {
        if (this.closed)
            return { ok: false, state: "closed", message: "Closed" };
        if (!this.started) {
            // Not migrated yet: nothing to publish.
            return { ok: true, skipped: true };
        }
        if (!force && !this.hasUnsavedChanges)
            return { ok: true, skipped: true };
        if (this.state === "conflict" && !this.overwriteOnce)
            return {
                ok: false,
                state: "conflict",
                message: this.message ?? "The show changed on disk",
            };
        this.clearRetryTimer();
        const outcome = await this.save(reason);
        if (outcome.ok && this.hasUnsavedChanges && !this.closed)
            this.scheduleSave();
        return outcome;
    }

    // eslint-disable-next-line max-lines-per-function
    private async save(reason: string): Promise<SaveOutcome> {
        const started = performance.now();
        const generation = this.editGeneration;
        const target = this.targetPath;
        const name = basename(target);
        const platform = this.options.platform;
        this.setState("saving");
        const snapshotPath = join(this.directory, SNAPSHOT_FILE_NAME);

        try {
            if (await isReadOnly(target, platform)) {
                const message = `${name} is read-only. Use Save As to keep your changes.`;
                this.setState("readOnly", { message });
                this.options.onPublish?.({
                    ok: false,
                    state: "readOnly",
                    reason,
                });
                return { ok: false, state: "readOnly", message };
            }
            await this.expectedHash;

            const worker = await this.ensureWorker();
            for (let attempt = 0; ; attempt++) {
                const expected = this.overwriteOnce ? null : this.expected;
                const snapshot = await worker.snapshot({
                    snapshotPath,
                    originalPath: target,
                    expectedStat: expected,
                });
                let renameAttempts = 0;
                try {
                    if (expected) {
                        const check = checkForConflict(
                            expected,
                            snapshot.original,
                        );
                        if (check.conflict) {
                            const message =
                                check.reason === "missing"
                                    ? `${name} was moved or deleted since OpenMarch opened it.`
                                    : `${name} was changed by another program or computer since OpenMarch last saved it.`;
                            this.setState("conflict", {
                                message,
                                conflict: {
                                    reason: check.reason,
                                    changed: check.changed,
                                },
                            });
                            this.options.onPublish?.({
                                ok: false,
                                state: "conflict",
                                reason,
                            });
                            return { ok: false, state: "conflict", message };
                        }
                    }

                    const original = snapshot.original;
                    ({ attempts: renameAttempts } = await publishFile(
                        snapshotPath,
                        target,
                        {
                            platform,
                            budgetMs: 5000,
                            shouldRetry: async () => {
                                try {
                                    return (
                                        await fs.promises.stat(target)
                                    ).isFile();
                                } catch {
                                    return true;
                                }
                            },
                            ...this.options.renameOptions,
                            beforeRename: async (tempPath) => {
                                if (original)
                                    await this.copyMetadata(target, tempPath);
                                // The worker read the show a moment ago. If it changed since,
                                // check again rather than overwrite blind.
                                let current: ReturnType<
                                    typeof statIdentity
                                > | null = null;
                                try {
                                    current = statIdentity(
                                        await fs.promises.stat(target),
                                    );
                                } catch {
                                    current = null;
                                }
                                const unchanged = original
                                    ? current !== null &&
                                      sameStat(current, original)
                                    : current === null;
                                if (!unchanged && !this.overwriteOnce)
                                    throw new ChangedDuringPublishError(name);
                            },
                        },
                    ));
                } catch (error) {
                    if (
                        error instanceof ChangedDuringPublishError &&
                        attempt < 2
                    )
                        continue;
                    throw error;
                } finally {
                    await removeWithRetry(snapshotPath);
                }

                this.expected = {
                    ...statIdentity(await fs.promises.stat(target)),
                    sha256: snapshot.snapshot.sha256,
                };
                const deferralsBefore = this.retryIndex;
                this.overwriteOnce = false;
                this.savedGeneration = generation;
                this.retryIndex = 0;
                this.manifest.originalIdentity = this.expected;
                this.manifest.lastSavedAt = new Date().toISOString();
                this.manifest.unsaved = this.hasUnsavedChanges;
                this.persistManifest();
                this.setState(this.hasUnsavedChanges ? "unsaved" : "saved");
                // Temp files an earlier, blocked publish couldn't delete.
                void removeStaleTempFiles(target);
                const metrics: PublishMetrics = {
                    reason,
                    durationMs: performance.now() - started,
                    bytes: snapshot.snapshot.size,
                    renameAttempts,
                    hashedShow: snapshot.original?.hashed ?? false,
                    deferralsBefore,
                    vacuumMs: snapshot.timings.vacuumMs,
                };
                console.log(
                    `Saved ${target} (${reason}): ${(metrics.bytes / 1e6).toFixed(1)} MB in ${metrics.durationMs.toFixed(0)} ms`,
                );
                this.options.onPublish?.({ ok: true, metrics });
                return { ok: true, metrics };
            }
        } catch (error) {
            return this.deferSave(error, reason);
        }
    }

    private async copyMetadata(from: string, to: string) {
        try {
            const { failedAttributes } = await copyFileMetadata(from, to, {
                platform: this.options.platform,
                exec: this.options.exec,
            });
            if (failedAttributes.length)
                console.warn(
                    "Couldn't copy extended attributes:",
                    failedAttributes,
                );
        } catch (error) {
            console.warn("Couldn't copy file metadata:", error);
        }
    }

    /**
     * A publish failed (the show is held on Windows, the folder is gone, the disk is full…). The
     * working copy keeps the changes; try again soon.
     */
    private deferSave(error: unknown, reason: string): SaveOutcome {
        const delays = this.options.retryDelaysMs;
        const delay = delays[Math.min(this.retryIndex, delays.length - 1)];
        this.retryIndex++;
        const retryAt = Date.now() + delay;
        const errorCode =
            error instanceof RenameRetriesExhaustedError
                ? (((error.cause as NodeJS.ErrnoException)?.code ??
                      "EBUSY") as string)
                : ((error as NodeJS.ErrnoException)?.code ?? undefined);
        const why =
            error instanceof RenameRetriesExhaustedError
                ? "another program is using the file"
                : ((error as Error)?.message ?? String(error));
        const message = `Couldn't save ${basename(this.targetPath)}: ${why}. Your changes are kept and OpenMarch will try again.`;
        console.error("Publish deferred:", error);
        this.clearRetryTimer();
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            void this.flush("retry");
        }, delay);
        this.retryTimer.unref?.();
        this.setState("deferred", { message, retryAt, errorCode });
        this.options.onPublish?.({
            ok: false,
            state: "deferred",
            errorCode,
            reason,
        });
        return { ok: false, state: "deferred", message };
    }
}
