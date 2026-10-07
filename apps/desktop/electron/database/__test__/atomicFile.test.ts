import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
    RenameRetriesExhaustedError,
    fsyncDirectory,
    renameWithRetry,
    replaceFileDurably,
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

describe("replaceFileDurably", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "openmarch-atomic-file-"));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("moves the temp file over the target", async () => {
        const target = join(dir, "show.dots");
        const temp = join(dir, ".~show.dots.1234.tmp");
        writeFileSync(target, "old");
        writeFileSync(temp, "new");

        await replaceFileDurably(temp, target);

        expect(readFileSync(target, "utf8")).toBe("new");
        expect(existsSync(temp)).toBe(false);
        expect(readdirSync(dir)).toEqual(["show.dots"]);
    });

    it("leaves both files alone when the rename keeps failing", async () => {
        const target = join(dir, "show.dots");
        const temp = join(dir, ".~show.dots.1234.tmp");
        writeFileSync(target, "old");
        writeFileSync(temp, "new");
        const clock = fakeClock();

        await expect(
            replaceFileDurably(temp, target, {
                platform: "win32",
                now: clock.now,
                sleep: clock.sleep,
                rename: async () => {
                    throw errno("EBUSY");
                },
            }),
        ).rejects.toBeInstanceOf(RenameRetriesExhaustedError);

        expect(readFileSync(target, "utf8")).toBe("old");
        expect(readFileSync(temp, "utf8")).toBe("new");
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
