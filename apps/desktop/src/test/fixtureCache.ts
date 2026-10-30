import fs from "fs";
import path from "path";
import { inject } from "vitest";

/**
 * Test databases built once per run and copied for each test.
 *
 * Building one (sql.js, the undo triggers, a data fixture's SQL and the convert to timelines)
 * cost every DB test tens of milliseconds; the result only depends on `key`, so the first
 * worker to need it builds it and the rest copy the file. Two workers can build the same key
 * at once: each writes its own file and renames it into place, and the copies are the same.
 */
const builtInThisProcess = new Map<string, string>();

export async function copyCachedDatabase(
    key: string,
    destination: string,
    build: (file: string) => Promise<void>,
): Promise<void> {
    const cached = await cachedDatabasePath(key, build);
    await fs.promises.copyFile(cached, destination);
}

async function cachedDatabasePath(
    key: string,
    build: (file: string) => Promise<void>,
): Promise<string> {
    const known = builtInThisProcess.get(key);
    if (known) return known;
    const file = path.join(
        inject("fixtureCacheDir"),
        `${key.replace(/[^a-z0-9-]+/gi, "_")}.dots`,
    );
    if (!fs.existsSync(file)) {
        const partial = `${file}.${process.pid}.partial`;
        await build(partial);
        fs.renameSync(partial, file);
    }
    builtInThisProcess.set(key, file);
    return file;
}
