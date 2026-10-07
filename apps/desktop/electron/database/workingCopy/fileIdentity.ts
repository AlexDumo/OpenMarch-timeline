import { createHash } from "node:crypto";
import * as fs from "node:fs";

/**
 * What OpenMarch last saw of a show file: when it opened the show or last
 * saved it. Compared before each save to notice that something else changed
 * the file.
 */
export type FileIdentity = {
    size: number;
    mtimeMs: number;
    ino: number;
    dev: number;
    sha256: string;
};

export type FileStatIdentity = Omit<FileIdentity, "sha256">;

export function statIdentity(stat: fs.Stats): FileStatIdentity {
    return {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ino: stat.ino,
        dev: stat.dev,
    };
}

/** SHA-256 of a file's bytes, as hex. Reads the file synchronously. */
export function hashFileSync(filePath: string): string {
    const hash = createHash("sha256");
    const fd = fs.openSync(filePath, "r");
    try {
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let bytesRead: number;
        while (
            (bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0
        )
            hash.update(buffer.subarray(0, bytesRead));
    } finally {
        fs.closeSync(fd);
    }
    return hash.digest("hex");
}

/**
 * Reads a file's identity. The file is checked before and after hashing, and
 * hashed again if it changed meanwhile, so the hash belongs to the stat.
 */
export function readFileIdentitySync(filePath: string): FileIdentity {
    for (let attempt = 0; ; attempt++) {
        const before = statIdentity(fs.statSync(filePath));
        const sha256 = hashFileSync(filePath);
        const after = statIdentity(fs.statSync(filePath));
        if (sameStat(before, after) || attempt >= 2)
            return { ...after, sha256 };
    }
}

export function sameStat(a: FileStatIdentity, b: FileStatIdentity): boolean {
    return (
        a.size === b.size &&
        a.mtimeMs === b.mtimeMs &&
        a.ino === b.ino &&
        a.dev === b.dev
    );
}

/** The identity fields that differ between what was expected and what is on disk. */
export function changedFields(
    expected: FileIdentity,
    actual: FileIdentity,
): (keyof FileIdentity)[] {
    return (["size", "mtimeMs", "ino", "dev", "sha256"] as const).filter(
        (key) => expected[key] !== actual[key],
    );
}

export type ConflictCheck =
    | { conflict: false; metadataOnly: boolean }
    | {
          conflict: true;
          reason: "modified" | "missing";
          changed: (keyof FileIdentity)[];
      };

/**
 * Decides whether saving over the show would lose someone else's changes.
 *
 * Size, modification time, inode and device are compared with what OpenMarch
 * last loaded or saved. When they all match, the hashes must match too. When
 * any differ, the content hash decides: a file that was only touched, or
 * replaced by a sync client with identical bytes, isn't a conflict.
 */
export function checkForConflict(
    expected: FileIdentity,
    actual: FileIdentity | null,
): ConflictCheck {
    if (!actual)
        return { conflict: true, reason: "missing", changed: ["size"] };
    const changed = changedFields(expected, actual);
    if (changed.length === 0) return { conflict: false, metadataOnly: false };
    if (!changed.includes("sha256"))
        return { conflict: false, metadataOnly: true };
    return { conflict: true, reason: "modified", changed };
}
