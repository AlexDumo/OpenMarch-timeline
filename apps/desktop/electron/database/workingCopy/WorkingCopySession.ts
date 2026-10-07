/* eslint-disable no-console */
/**
 * Editing a show through a private working copy (docs/adr/0001).
 *
 * The show the user picked (the "show file") is copied into a folder under the
 * app's user data. Every connection edits that working copy, in WAL mode with
 * synchronous=NORMAL. Autosave writes a complete snapshot beside the show file
 * and renames it over the show, after checking that nothing else changed the
 * show since OpenMarch last loaded or saved it.
 *
 * This module has no Electron imports; electron/main/index.ts wires it to the
 * window, dialogs and settings.
 */
import * as fs from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
    RenameRetriesExhaustedError,
    type RenameRetryOptions,
    fsyncDirectory,
    removeIfPresent,
    renameWithRetry,
} from "../atomicFile";
import {
    type FileIdentity,
    checkForConflict,
    readFileIdentitySync,
    sameStat,
    statIdentity,
} from "./fileIdentity";
import { type ExecFile, copyFileMetadata, isReadOnly } from "./fileMetadata";
import { SaveWorker, type SnapshotResult } from "./saveWorker";

export const WORKING_FILE_NAME = "show.dots";
export const MANIFEST_FILE_NAME = "manifest.json";

/** Stored beside each working copy so a crash can be recovered from. */
export type WorkingCopyManifest = {
    version: 1;
    id: string;
    /** The show file, as the user knows it. */
    showPath: string;
    /**
     * The show file as OpenMarch last loaded or saved it. Null when there is
     * nothing to compare with, such as after Save As to a new file.
     */
    originalIdentity: FileIdentity | null;
    /** True from the first edit after a save until the next save succeeds. */
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
    /** Why the last save didn't happen, for "conflict", "deferred" and "readOnly". */
    message?: string;
    conflict?: { reason: "modified" | "missing"; changed: string[] };
    /** When a deferred save will be tried again (ms since the epoch). */
    retryAt?: number;
};

/** How the user resolves a show that changed on disk. */
export type WorkingCopyConflictChoice = "keepMine" | "keepTheirs" | "saveCopy";

/** A crashed session's unsaved changes, as the launch page lists them. */
export type RecoverableShow = {
    id: string;
    showPath: string;
    showExists: boolean;
    lastEditAt: string | null;
};

export type SaveOutcome =
    | {
          ok: true;
          skipped?: boolean;
          bytes?: number;
          timings?: SnapshotResult["timings"] & {
              renameMs: number;
              totalMs: number;
          };
          renameAttempts?: number;
      }
    | {
          ok: false;
          state: "conflict" | "deferred" | "readOnly" | "closed";
          message: string;
      };

export type WorkingCopyOptions = {
    /** The folder that holds one sub-folder per working copy. */
    workingRoot: string;
    appVersion?: string;
    /** How long after the last edit to save. */
    debounceMs?: number;
    /** The longest a pending save waits while edits keep coming. */
    maxWaitMs?: number;
    /** Waits before retrying a save that failed, in order; the last repeats. */
    retryDelaysMs?: number[];
    platform?: NodeJS.Platform;
    onStatus?: (status: WorkingCopyStatus) => void;
    /** Overrides for the rename step, for tests. */
    renameOptions?: RenameRetryOptions;
    /** Runs the `xattr` tool, for tests. */
    exec?: ExecFile;
};

/** Runs on the working copy before editing starts, e.g. migrations. */
export type PrepareWorkingCopy = (db: DatabaseSync) => Promise<void> | void;

export type RecoverableWorkingCopy = {
    id: string;
    directory: string;
    workingPath: string;
    manifest: WorkingCopyManifest;
};

const STALE_TEMP_FILE_AGE_MS = 60 * 60 * 1000;

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

/** The file a save replaces: the show file with symbolic links resolved. */
function resolveSaveTarget(showPath: string): string {
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

export function tempFilePattern(showFileName: string): RegExp {
    const escaped = showFileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A crash during VACUUM INTO can also leave the temp file's journal.
    return new RegExp(`^\\.~${escaped}\\.[0-9a-f]+\\.tmp(-journal)?$`);
}

/** Deletes `.~<name>.<random>.tmp` files beside the show left by a crashed save. */
export function removeStaleTempFiles(showFile: string, now = Date.now()) {
    const directory = dirname(showFile);
    const pattern = tempFilePattern(basename(showFile));
    let names: string[];
    try {
        names = fs.readdirSync(directory);
    } catch {
        return;
    }
    for (const name of names) {
        if (!pattern.test(name)) continue;
        const filePath = join(directory, name);
        try {
            if (now - fs.statSync(filePath).mtimeMs > STALE_TEMP_FILE_AGE_MS)
                fs.unlinkSync(filePath);
        } catch {
            // Another save may own it, or it's already gone.
        }
    }
}

/**
 * Lists working copies left by a previous run. Call it at startup, before
 * any working copy is open: the single-instance lock means every folder
 * found then belongs to a process that has exited.
 *
 * Folders whose show was saved are deleted. Folders with unsaved changes
 * are returned so the user can recover or discard them.
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
        if (!manifest) {
            console.warn(
                `Ignoring working copy without a manifest: ${directory}`,
            );
            continue;
        }
        if (!manifest.unsaved || !fs.existsSync(workingPath)) {
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

export function discardWorkingCopy(entry: { directory: string }) {
    fs.rmSync(entry.directory, { recursive: true, force: true });
}

function openWorkingConnection(workingPath: string): DatabaseSync {
    const db = new (getSqlite().DatabaseSync)(workingPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
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
            "debounceMs" | "maxWaitMs" | "retryDelaysMs" | "platform"
        >
    > &
        WorkingCopyOptions;

    private watcher: DatabaseSync | null = null;
    private dataVersionStatement: StatementSync | null = null;
    private lastDataVersion = 0;
    private worker: SaveWorker | null = null;

    /** Bumped on every detected commit; a save covers the generation it started at. */
    private editGeneration = 0;
    private savedGeneration = 0;
    private state: WorkingCopyState = "saved";
    private message: string | undefined;
    private conflict: WorkingCopyStatus["conflict"];
    private retryAt: number | undefined;
    private retryIndex = 0;
    private overwriteOnce = false;
    private closed = false;

    private debounceTimer: NodeJS.Timeout | null = null;
    private maxWaitTimer: NodeJS.Timeout | null = null;
    private retryTimer: NodeJS.Timeout | null = null;
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
            debounceMs: 1500,
            maxWaitMs: 30_000,
            retryDelaysMs: [30_000, 60_000, 120_000, 300_000],
            platform: process.platform,
            ...options,
        };
    }

    /**
     * Copies `showPath` into a new working copy and opens it.
     *
     * The copy uses SQLite's backup API on a connection to the show, so a hot
     * journal or leftover WAL is applied first and the copy is consistent.
     * That connection is closed before this returns; `prepare` (migrations)
     * runs on the working copy, so a failed migration never touches the show.
     */
    static async open(
        showPath: string,
        options: WorkingCopyOptions,
        prepare?: PrepareWorkingCopy,
    ): Promise<WorkingCopySession> {
        const sqlite = getSqlite();
        const absoluteShowPath = resolve(showPath);
        const target = resolveSaveTarget(absoluteShowPath);
        const id = randomUUID();
        const directory = join(options.workingRoot, id);
        const workingPath = join(directory, WORKING_FILE_NAME);
        fs.mkdirSync(directory, { recursive: true });

        try {
            removeStaleTempFiles(target);
            let identity: FileIdentity | null = null;
            for (let attempt = 0; attempt < 3 && !identity; attempt++) {
                for (const suffix of ["", "-wal", "-shm"])
                    fs.rmSync(workingPath + suffix, { force: true });
                const before = statIdentity(fs.statSync(target));
                const source = new sqlite.DatabaseSync(target);
                try {
                    source.exec("PRAGMA busy_timeout = 5000");
                    await sqlite.backup(source, workingPath);
                } finally {
                    source.close();
                }
                const after = readFileIdentitySync(target);
                // Opening the show can roll back a hot journal, and another
                // program could write meanwhile: copy again until it holds still.
                if (sameStat(before, after)) identity = after;
            }
            if (!identity)
                throw new Error(
                    `The show kept changing while OpenMarch copied it: ${absoluteShowPath}`,
                );

            const db = openWorkingConnection(workingPath);
            try {
                await prepare?.(db);
            } finally {
                db.close();
            }

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

            const session = new WorkingCopySession(
                directory,
                manifest,
                options,
            );
            await session.start();
            return session;
        } catch (error) {
            fs.rmSync(directory, { recursive: true, force: true });
            throw error;
        }
    }

    /**
     * Reopens a working copy left by a crash. It starts out unsaved, so the
     * recovered changes are saved to the show file after the usual check that
     * the show hasn't changed since it was last loaded or saved.
     */
    static async resume(
        entry: RecoverableWorkingCopy,
        options: WorkingCopyOptions,
        prepare?: PrepareWorkingCopy,
    ): Promise<WorkingCopySession> {
        // Opening the working copy replays its WAL.
        const db = openWorkingConnection(entry.workingPath);
        try {
            const check = db.prepare("PRAGMA quick_check").get() as {
                quick_check: string;
            };
            if (check.quick_check !== "ok")
                throw new Error(
                    `The recovered working copy is damaged: ${check.quick_check}`,
                );
            await prepare?.(db);
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
        await session.start();
        session.markDirty();
        return session;
    }

    /** The user's show file. Use this for titles, recent files and exports. */
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
            ...(this.conflict ? { conflict: this.conflict } : {}),
            ...(this.retryAt ? { retryAt: this.retryAt } : {}),
        };
    }

    /**
     * Call after anything may have written to the working copy. Notices
     * commits from any connection through `PRAGMA data_version`, which
     * changes when another connection commits.
     */
    noteActivity(): void {
        if (this.closed || !this.dataVersionStatement) return;
        const { data_version } = this.dataVersionStatement.get() as {
            data_version: number;
        };
        if (data_version === this.lastDataVersion) return;
        this.lastDataVersion = data_version;
        this.markDirty();
    }

    /** Records an edit and schedules a save. */
    markDirty(): void {
        if (this.closed) return;
        this.editGeneration++;
        this.manifest.lastEditAt = new Date().toISOString();
        if (!this.manifest.unsaved) {
            this.manifest.unsaved = true;
            this.persistManifest();
        }
        // A conflict or a read-only show waits for the user; a deferred save
        // waits for its retry.
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
     * Saves now if there are unsaved changes. Saves run one at a time; a
     * call made during a save waits for it and then saves again if needed.
     */
    flush(reason = "flush", force = false): Promise<SaveOutcome> {
        this.clearSaveTimers();
        const run = this.queue.then(() => this.saveIfNeeded(reason, force));
        this.queue = run.catch(() => undefined);
        return run;
    }

    /** Saves over the show even though it changed on disk ("Keep mine"). */
    overwriteShow(): Promise<SaveOutcome> {
        this.overwriteOnce = true;
        if (this.state === "conflict") this.setState("unsaved");
        return this.flush("overwrite", true);
    }

    /**
     * Makes `newShowPath` the show and saves to it ("Save mine as a copy",
     * or Save As). The save dialog already confirmed replacing a file there.
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
     * Stops autosave and releases the working copy. Close every other
     * connection to it first. Without unsaved changes (or with `discard`) the
     * working folder is deleted; otherwise it's kept for recovery.
     */
    async close({ discard = false } = {}): Promise<{
        keptForRecovery: boolean;
    }> {
        if (this.closed) return { keptForRecovery: false };
        this.clearSaveTimers();
        this.clearRetryTimer();
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

    private async start() {
        this.watcher = new (getSqlite().DatabaseSync)(this.workingPath);
        this.dataVersionStatement = this.watcher.prepare("PRAGMA data_version");
        this.lastDataVersion = (
            this.dataVersionStatement.get() as { data_version: number }
        ).data_version;
        this.worker = await SaveWorker.start(this.workingPath);
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
            "message" | "conflict" | "retryAt"
        > = {},
    ) {
        this.state = state;
        this.message = details.message;
        this.conflict = details.conflict;
        this.retryAt = details.retryAt;
        this.options.onStatus?.(this.status());
    }

    private scheduleSave() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(
            () => void this.flush("autosave"),
            this.options.debounceMs,
        );
        if (!this.maxWaitTimer)
            this.maxWaitTimer = setTimeout(
                () => void this.flush("autosave"),
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
        const platform = this.options.platform;
        this.setState("saving");

        try {
            if (await isReadOnly(target, platform)) {
                const message = `${basename(target)} is read-only. Use Save As Copy to keep your changes.`;
                this.setState("readOnly", { message });
                return { ok: false, state: "readOnly", message };
            }

            const worker = await this.ensureWorker();
            for (let attempt = 0; ; attempt++) {
                const tempPath = join(
                    dirname(target),
                    `.~${basename(target)}.${randomBytes(4).toString("hex")}.tmp`,
                );
                const snapshot = await worker.snapshot({
                    tempPath,
                    originalPath: target,
                });
                let renameAttempts = 0;
                let renameMs = 0;
                try {
                    if (this.expected && !this.overwriteOnce) {
                        const check = checkForConflict(
                            this.expected,
                            snapshot.original,
                        );
                        if (check.conflict) {
                            await removeIfPresent(tempPath);
                            const message =
                                check.reason === "missing"
                                    ? `${basename(target)} was moved or deleted since OpenMarch opened it.`
                                    : `${basename(target)} was changed by another program or computer since OpenMarch last saved it.`;
                            this.setState("conflict", {
                                message,
                                conflict: {
                                    reason: check.reason,
                                    changed: check.changed,
                                },
                            });
                            return { ok: false, state: "conflict", message };
                        }
                    }

                    if (snapshot.original) {
                        try {
                            const { failedAttributes } = await copyFileMetadata(
                                target,
                                tempPath,
                                { platform, exec: this.options.exec },
                            );
                            if (failedAttributes.length)
                                console.warn(
                                    "Couldn't copy extended attributes:",
                                    failedAttributes,
                                );
                        } catch (error) {
                            console.warn("Couldn't copy file metadata:", error);
                        }
                    }

                    // The worker hashed the show a moment ago. If it changed
                    // since, check again rather than overwrite blind.
                    let current: ReturnType<typeof statIdentity> | null = null;
                    try {
                        current = statIdentity(fs.statSync(target));
                    } catch {
                        current = null;
                    }
                    const unchanged = snapshot.original
                        ? current !== null &&
                          sameStat(current, snapshot.original)
                        : current === null;
                    if (!unchanged && !this.overwriteOnce) {
                        await removeIfPresent(tempPath);
                        if (attempt < 2) continue;
                        throw new Error(
                            `${basename(target)} keeps changing on disk; saving later.`,
                        );
                    }

                    const renameStart = performance.now();
                    ({ attempts: renameAttempts } = await renameWithRetry(
                        tempPath,
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
                        },
                    ));
                    renameMs = performance.now() - renameStart;
                } catch (error) {
                    await removeIfPresent(tempPath);
                    throw error;
                }
                await fsyncDirectory(dirname(target), platform);

                this.expected = {
                    ...statIdentity(fs.statSync(target)),
                    sha256: snapshot.temp.sha256,
                };
                this.overwriteOnce = false;
                this.savedGeneration = generation;
                this.retryIndex = 0;
                this.manifest.originalIdentity = this.expected;
                this.manifest.lastSavedAt = new Date().toISOString();
                this.manifest.unsaved = this.hasUnsavedChanges;
                this.persistManifest();
                this.setState(this.hasUnsavedChanges ? "unsaved" : "saved");
                const totalMs = performance.now() - started;
                console.log(
                    `Saved ${target} (${reason}): ${(snapshot.temp.size / 1e6).toFixed(1)} MB in ${totalMs.toFixed(0)} ms`,
                );
                return {
                    ok: true,
                    bytes: snapshot.temp.size,
                    renameAttempts,
                    timings: { ...snapshot.timings, renameMs, totalMs },
                };
            }
        } catch (error) {
            return this.deferSave(error);
        }
    }

    /**
     * A save failed (the show is locked on Windows, the folder is gone, the
     * disk is full…). The working copy keeps the changes; try again later.
     */
    private deferSave(error: unknown): SaveOutcome {
        const delays = this.options.retryDelaysMs;
        const delay = delays[Math.min(this.retryIndex, delays.length - 1)];
        this.retryIndex++;
        const retryAt = Date.now() + delay;
        const reason =
            error instanceof RenameRetriesExhaustedError
                ? "another program is using the file"
                : ((error as Error)?.message ?? String(error));
        const message = `Couldn't save ${basename(this.targetPath)}: ${reason}. Your changes are kept and OpenMarch will try again.`;
        console.error("Save deferred:", error);
        this.clearRetryTimer();
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (this.state === "deferred") this.setState("unsaved");
            void this.flush("retry");
        }, delay);
        this.setState("deferred", { message, retryAt });
        return { ok: false, state: "deferred", message };
    }
}
