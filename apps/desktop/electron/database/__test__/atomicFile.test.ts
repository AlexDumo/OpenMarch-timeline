import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import {
    RenameRetriesExhaustedError,
    fsyncDirectory,
    renameWithRetry,
    publishFile,
    removeWithRetry,
    tempFilePattern,
} from "../atomicFile";

const errno = (code: string) =>
    Object.assign(new Error(`${code}: operation failed`), { code });

/** A clock and sleep that advance together, so retries take no real time. */
function fakeClock() {
    let time = 0;
    const sleeps: number[] = [];
    return {
        now: () => time,
        sleep: async (ms: number) => {
            sleeps.push(ms);
            time += ms;
        },
        sleeps,
    };
}

describe("renameWithRetry", () => {
    it("retries Windows sharing errors and then succeeds", async () => {
        const clock = fakeClock();
        const failures = ["EBUSY", "EPERM", "EACCES"];
        const calls: string[] = [];
        const result = await renameWithRetry("a.tmp", "show.dots", {
            platform: "win32",
            now: clock.now,
            sleep: clock.sleep,
            rename: async (from, to) => {
                calls.push(`${from}->${to}`);
                const code = failures.shift();
                if (code) throw errno(code);
            },
        });

        expect(result.attempts).toBe(4);
        expect(calls).toHaveLength(4);
        expect(clock.sleeps).toEqual([10, 20, 30]);
    });

    it("gives up after the budget and reports the last error", async () => {
        const clock = fakeClock();
        let attempts = 0;
        const promise = renameWithRetry("a.tmp", "show.dots", {
            platform: "win32",
            budgetMs: 5000,
            now: clock.now,
            sleep: clock.sleep,
            rename: async () => {
                attempts++;
                throw errno("EBUSY");
            },
        });

        await expect(promise).rejects.toBeInstanceOf(
            RenameRetriesExhaustedError,
        );
        const total = clock.sleeps.reduce((a, b) => a + b, 0);
        expect(total).toBeLessThanOrEqual(5000);
        expect(total).toBeGreaterThan(4800);
        expect(Math.max(...clock.sleeps)).toBe(100);
        expect(attempts).toBe(clock.sleeps.length + 1);
    });

    it("doesn't retry other errors", async () => {
        const clock = fakeClock();
        await expect(
            renameWithRetry("a.tmp", "show.dots", {
                platform: "win32",
                now: clock.now,
                sleep: clock.sleep,
                rename: async () => {
                    throw errno("ENOSPC");
                },
            }),
        ).rejects.toMatchObject({ code: "ENOSPC" });
        expect(clock.sleeps).toEqual([]);
    });

    it("doesn't retry on macOS or Linux, where these errors are permanent", async () => {
        for (const platform of ["darwin", "linux"] as const) {
            const clock = fakeClock();
            await expect(
                renameWithRetry("a.tmp", "show.dots", {
                    platform,
                    now: clock.now,
                    sleep: clock.sleep,
                    rename: async () => {
                        throw errno("EACCES");
                    },
                }),
            ).rejects.toMatchObject({ code: "EACCES" });
            expect(clock.sleeps).toEqual([]);
        }
    });

    it("stops early when the caller says to", async () => {
        const clock = fakeClock();
        let checks = 0;
        await expect(
            renameWithRetry("a.tmp", "show.dots", {
                platform: "win32",
                now: clock.now,
                sleep: clock.sleep,
                rename: async () => {
                    throw errno("EPERM");
                },
                shouldRetry: async () => ++checks < 2,
            }),
        ).rejects.toBeInstanceOf(RenameRetriesExhaustedError);
        expect(checks).toBe(2);
    });
});

describe("publishFile", () => {
    let dir: string;
    let scratch: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "openmarch-atomic-file-"));
        scratch = mkdtempSync(join(tmpdir(), "openmarch-atomic-scratch-"));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
        rmSync(scratch, { recursive: true, force: true });
    });

    it("replaces the target with a copy of the source and leaves nothing else beside it", async () => {
        const target = join(dir, "show.dots");
        const source = join(scratch, "snapshot.dots");
        writeFileSync(target, "old");
        writeFileSync(source, "new");

        const { tempPath } = await publishFile(source, target);

        expect(readFileSync(target, "utf8")).toBe("new");
        expect(tempFilePattern("show.dots").test(basename(tempPath))).toBe(
            true,
        );
        expect(readdirSync(dir)).toEqual(["show.dots"]);
        // The private snapshot stays where it was.
        expect(readFileSync(source, "utf8")).toBe("new");
    });

    it("creates the target when there is none", async () => {
        const target = join(dir, "new.dots");
        const source = join(scratch, "snapshot.dots");
        writeFileSync(source, "new");

        await publishFile(source, target);

        expect(readdirSync(dir)).toEqual(["new.dots"]);
    });

    it("leaves the target alone and removes its temp file when the rename keeps failing", async () => {
        const target = join(dir, "show.dots");
        const source = join(scratch, "snapshot.dots");
        writeFileSync(target, "old");
        writeFileSync(source, "new");
        const clock = fakeClock();

        await expect(
            publishFile(source, target, {
                platform: "win32",
                now: clock.now,
                sleep: clock.sleep,
                rename: async () => {
                    throw errno("EBUSY");
                },
            }),
        ).rejects.toBeInstanceOf(RenameRetriesExhaustedError);

        expect(readFileSync(target, "utf8")).toBe("old");
        expect(readdirSync(dir)).toEqual(["show.dots"]);
    });

    it("stops before the rename when the last check fails", async () => {
        const target = join(dir, "show.dots");
        const source = join(scratch, "snapshot.dots");
        writeFileSync(target, "old");
        writeFileSync(source, "new");

        await expect(
            publishFile(source, target, {
                beforeRename: async () => {
                    throw new Error("changed on disk");
                },
            }),
        ).rejects.toThrow("changed on disk");

        expect(readFileSync(target, "utf8")).toBe("old");
        expect(readdirSync(dir)).toEqual(["show.dots"]);
    });
});

describe("removeWithRetry", () => {
    it("is true for a missing file", async () => {
        expect(await removeWithRetry(join(tmpdir(), "openmarch-none"))).toBe(
            true,
        );
    });
});

describe("tempFilePattern", () => {
    it("matches only this show's temp files", () => {
        const pattern = tempFilePattern("My Show (1).dots");
        expect(pattern.test(".~My Show (1).dots.0a1b2c3d.tmp")).toBe(true);
        expect(pattern.test(".~My Show (1).dots.0a1b2c3d.tmp-journal")).toBe(
            true,
        );
        expect(pattern.test(".~Other.dots.0a1b2c3d.tmp")).toBe(false);
        expect(pattern.test("My Show (1).dots")).toBe(false);
    });
});

describe("fsyncDirectory", () => {
    it("flushes a folder on POSIX and skips Windows", async () => {
        const dir = mkdtempSync(join(tmpdir(), "openmarch-fsync-dir-"));
        try {
            await expect(fsyncDirectory(dir)).resolves.toBeUndefined();
            // On Windows this must not even try to open the folder.
            await expect(
                fsyncDirectory(join(dir, "missing"), "win32"),
            ).resolves.toBeUndefined();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
