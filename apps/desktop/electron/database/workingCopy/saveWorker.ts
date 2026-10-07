import { Worker } from "node:worker_threads";
import type { FileIdentity } from "./fileIdentity";

/**
 * The autosave worker's code. It runs as an eval'd CommonJS worker so it
 * works the same in the bundled main process, in Vitest and in plain Node,
 * without a separate build entry.
 *
 * The worker holds its own connection to the working copy. For each save it:
 * 1. reads the show's identity (stat and SHA-256) for the conflict check;
 * 2. writes a consistent snapshot of the working copy with `VACUUM INTO`. A
 *    WAL reader doesn't block the editing connection, so edits continue;
 * 3. flushes the snapshot to disk and hashes it.
 * The main process then decides whether to rename it over the show.
 */
const WORKER_SOURCE = String.raw`
const { parentPort } = require("node:worker_threads");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { DatabaseSync } = require("node:sqlite");

let db = null;

function hashFile(filePath) {
    const hash = crypto.createHash("sha256");
    const fd = fs.openSync(filePath, "r");
    try {
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let bytesRead;
        while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0)
            hash.update(buffer.subarray(0, bytesRead));
    } finally {
        fs.closeSync(fd);
    }
    return hash.digest("hex");
}

function statOf(filePath) {
    const s = fs.statSync(filePath);
    return { size: s.size, mtimeMs: s.mtimeMs, ino: s.ino, dev: s.dev };
}

function sameStat(a, b) {
    return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino && a.dev === b.dev;
}

function identityOf(filePath) {
    for (let attempt = 0; ; attempt++) {
        let before;
        try {
            before = statOf(filePath);
        } catch (error) {
            if (error.code === "ENOENT") return null;
            throw error;
        }
        const sha256 = hashFile(filePath);
        const after = statOf(filePath);
        if (sameStat(before, after) || attempt >= 2) return { ...after, sha256 };
    }
}

function snapshot(msg) {
    const t0 = performance.now();
    const original = msg.originalPath ? identityOf(msg.originalPath) : null;
    const t1 = performance.now();
    try {
        db.prepare("VACUUM INTO ?").run(msg.tempPath);
        const t2 = performance.now();
        const fd = fs.openSync(msg.tempPath, "r+");
        try {
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        const t3 = performance.now();
        const temp = { size: fs.statSync(msg.tempPath).size, sha256: hashFile(msg.tempPath) };
        const t4 = performance.now();
        return {
            original,
            temp,
            timings: { identityMs: t1 - t0, vacuumMs: t2 - t1, fsyncMs: t3 - t2, hashMs: t4 - t3 },
        };
    } catch (error) {
        try {
            fs.unlinkSync(msg.tempPath);
        } catch {}
        throw error;
    }
}

parentPort.on("message", (msg) => {
    try {
        let result;
        if (msg.type === "open") {
            db = new DatabaseSync(msg.workingPath);
            db.exec("PRAGMA busy_timeout = 5000");
            result = true;
        } else if (msg.type === "snapshot") {
            result = snapshot(msg);
        } else if (msg.type === "identity") {
            result = identityOf(msg.filePath);
        } else if (msg.type === "close") {
            if (db) db.close();
            db = null;
            result = true;
        } else {
            throw new Error("Unknown save worker message: " + msg.type);
        }
        parentPort.postMessage({ id: msg.id, ok: true, result });
    } catch (error) {
        parentPort.postMessage({
            id: msg.id,
            ok: false,
            error: { message: String(error && error.message), code: error && error.code },
        });
    }
});
`;

export type SnapshotResult = {
    /** The show file's identity before the snapshot, or null if it's missing. */
    original: FileIdentity | null;
    temp: { size: number; sha256: string };
    timings: {
        identityMs: number;
        vacuumMs: number;
        fsyncMs: number;
        hashMs: number;
    };
};

type Pending = {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
};

/** A worker thread with its own connection to the working copy. */
export class SaveWorker {
    private readonly worker: Worker;
    private readonly pending = new Map<number, Pending>();
    private nextId = 1;
    private failure: Error | null = null;

    private constructor() {
        this.worker = new Worker(WORKER_SOURCE, { eval: true });
        this.worker.on("message", (message) => {
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            if (message.ok) pending.resolve(message.result);
            else
                pending.reject(
                    Object.assign(new Error(message.error.message), {
                        code: message.error.code,
                    }),
                );
        });
        const fail = (error: Error) => {
            this.failure = error;
            for (const pending of this.pending.values()) pending.reject(error);
            this.pending.clear();
        };
        this.worker.on("error", fail);
        this.worker.on("exit", (code) =>
            fail(new Error(`The save worker stopped (exit code ${code})`)),
        );
    }

    static async start(workingPath: string): Promise<SaveWorker> {
        const worker = new SaveWorker();
        try {
            await worker.request({ type: "open", workingPath });
        } catch (error) {
            await worker.worker.terminate();
            throw error;
        }
        return worker;
    }

    /** False once the worker has crashed or been closed. */
    get alive(): boolean {
        return this.failure === null;
    }

    snapshot(args: {
        tempPath: string;
        originalPath: string | null;
    }): Promise<SnapshotResult> {
        return this.request({ type: "snapshot", ...args });
    }

    identity(filePath: string): Promise<FileIdentity | null> {
        return this.request({ type: "identity", filePath });
    }

    async close(): Promise<void> {
        if (this.alive) {
            try {
                await this.request({ type: "close" });
            } catch {
                // The worker is going away either way.
            }
        }
        this.failure ??= new Error("The save worker was closed");
        await this.worker.terminate();
    }

    private request<T>(message: Record<string, unknown>): Promise<T> {
        if (this.failure) return Promise.reject(this.failure);
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.worker.postMessage({ ...message, id });
        });
    }
}
