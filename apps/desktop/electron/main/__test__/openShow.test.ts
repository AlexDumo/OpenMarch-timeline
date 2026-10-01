// @vitest-environment node
/**
 * The main-process open path (`openShow.ts`) with convert on open (P9.3):
 * the dialogs it shows, the stop status, serialized opens, the renderer's SQL
 * held off during a conversion, and new files. Real files; fake dialogs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as DatabaseServices from "@om-electron/database/database.services";
import { OPEN_STOPPED_STATUS } from "@om-electron/database/convertOnOpenGate";
import type { ConvertOnOpenHooks } from "@om-electron/database/convertOnOpen";
import {
    backupsIn,
    createPageShow,
    GATE_ON,
    migrationsFolder,
    sha256,
    stateOf,
    withDb,
} from "@om-electron/database/__test__/convertOnOpenFixtures";
import type { ConvertOnOpenDialogs } from "../convertOnOpenFlow";
import { openShowFile, type OpenShowResult } from "../openShow";

/** Fake dialogs that record every call. */
function fakeDialogs({
    olderRelease = "stop",
    preparing,
}: {
    olderRelease?: "open" | "stop";
    /** Runs inside the preparing state, before the work. */
    preparing?: () => Promise<void>;
} = {}) {
    const calls: string[] = [];
    const dialogs: ConvertOnOpenDialogs = {
        async warnOlderRelease(fileName) {
            calls.push(`warn ${fileName}`);
            return olderRelease;
        },
        async whilePreparing(fileName, work) {
            calls.push(`preparing ${fileName}`);
            await preparing?.();
            return work();
        },
        converted(fileName) {
            calls.push(`converted ${fileName}`);
        },
        async backupFailed(fileName) {
            calls.push(`backup failed ${fileName}`);
        },
        async conversionFailed(fileName) {
            calls.push(`conversion failed ${fileName}`);
        },
    };
    return { dialogs, calls };
}

async function open(
    filePath: string,
    {
        isNewFile = false,
        env = GATE_ON,
        dialogs = fakeDialogs().dialogs,
        hooks,
    }: {
        isNewFile?: boolean;
        env?: Record<string, string | undefined>;
        dialogs?: ConvertOnOpenDialogs;
        hooks?: ConvertOnOpenHooks;
    } = {},
): Promise<OpenShowResult> {
    const result = await openShowFile(filePath, isNewFile, {
        migrationsFolder,
        env,
        dialogs: () => dialogs,
        hooks,
    });
    result.db?.close();
    // setActiveDb resumes the renderer's SQL once the window has reloaded.
    if (result.sqlSuspended) DatabaseServices.resumeSqlProxy();
    return result;
}

const sqlProxyWorks = () =>
    DatabaseServices.handleSqlProxy(null, "SELECT 1", [], "get").then(
        () => true,
        () => false,
    );

describe("opening a show with convert on open", () => {
    let tempDir: string;
    let showPath: string;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmarch-open-"));
        showPath = path.join(tempDir, "show.dots");
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
        await createPageShow(showPath);
    });

    afterEach(() => {
        DatabaseServices.resumeSqlProxy();
        DatabaseServices.closePersistentConnection();
        DatabaseServices.setDbPath("", false);
        fs.rmSync(tempDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it("gate off: opens as before, no dialogs, nothing converted", async () => {
        const { dialogs, calls } = fakeDialogs();
        const result = await open(showPath, { env: {}, dialogs });

        expect(result).toMatchObject({ status: 200, sqlSuspended: false });
        expect(calls).toEqual([]);
        expect(stateOf(showPath)).toMatchObject({
            userVersion: 7,
            timelines: 0,
        });
        expect(DatabaseServices.getDbPath()).toBe(showPath);
    });

    it("converts, says so, and holds the renderer's SQL off while it does", async () => {
        let sqlDuringConversion: boolean | undefined;
        const { dialogs, calls } = fakeDialogs({
            preparing: async () => {
                sqlDuringConversion = await sqlProxyWorks();
            },
        });

        const result = await open(showPath, { dialogs });

        expect(result).toMatchObject({ status: 200, sqlSuspended: true });
        expect(sqlDuringConversion).toBe(false);
        expect(await sqlProxyWorks()).toBe(true);
        expect(calls).toEqual(["preparing show.dots", "converted show.dots"]);
        expect(stateOf(showPath)).toMatchObject({
            userVersion: 8,
            timelineMode: true,
        });
    });

    it("a failed backup stops the open with OPEN_STOPPED_STATUS and opens nothing", async () => {
        const { dialogs, calls } = fakeDialogs();
        const result = await open(showPath, {
            dialogs,
            hooks: {
                backup: () => ({
                    ok: false,
                    code: "file-busy",
                    message: "busy",
                }),
            },
        });

        expect(result.status).toBe(OPEN_STOPPED_STATUS);
        expect(result.db).toBeUndefined();
        expect(DatabaseServices.getDbPath()).toBe("");
        expect(calls).toEqual([
            "preparing show.dots",
            "backup failed show.dots",
        ]);
        expect(stateOf(showPath).userVersion).toBe(7);
    });

    it("a failed conversion stops the open, keeps the backup and leaves the file at 7", async () => {
        const { dialogs, calls } = fakeDialogs();
        const result = await open(showPath, {
            dialogs,
            hooks: {
                afterStep: (step) => {
                    if (step === "user-version") throw new Error("boom");
                },
            },
        });

        expect(result.status).toBe(OPEN_STOPPED_STATUS);
        expect(DatabaseServices.getDbPath()).toBe("");
        expect(calls).toEqual([
            "preparing show.dots",
            "conversion failed show.dots",
        ]);
        expect(stateOf(showPath)).toMatchObject({
            userVersion: 7,
            timelines: 0,
        });
        expect(backupsIn(tempDir)).toHaveLength(1);
    });

    it.each([
        ["stop", OPEN_STOPPED_STATUS],
        ["open", 200],
    ] as const)(
        "older release, the person chooses %s: status %i",
        async (choice, status) => {
            await open(showPath);
            withDb(showPath, (db) => db.exec("PRAGMA user_version = 7"));
            const { dialogs, calls } = fakeDialogs({ olderRelease: choice });

            const result = await open(showPath, { dialogs });

            expect(result.status).toBe(status);
            expect(calls).toEqual(["warn show.dots"]);
            expect(DatabaseServices.getDbPath()).toBe(
                choice === "open" ? showPath : "",
            );
            expect(stateOf(showPath).userVersion).toBe(7);
        },
    );

    it("two opens of the same file at once: converted once, both open quietly", async () => {
        const first = fakeDialogs();
        const second = fakeDialogs();

        const results = await Promise.all([
            open(showPath, { dialogs: first.dialogs }),
            open(showPath, { dialogs: second.dialogs }),
        ]);

        expect(results.map((r) => r.status)).toEqual([200, 200]);
        expect(first.calls).toEqual([
            "preparing show.dots",
            "converted show.dots",
        ]);
        expect(second.calls).toEqual([]);
        expect(backupsIn(tempDir)).toHaveLength(1);
        expect(stateOf(showPath)).toMatchObject({
            userVersion: 8,
            timelines: 1,
        });
        expect(DatabaseServices.getDbPath()).toBe(showPath);
    });

    it("a second file opened mid-conversion waits for the first", async () => {
        const otherPath = path.join(tempDir, "other.dots");
        await createPageShow(otherPath);
        let release!: () => void;
        const released = new Promise<void>((r) => (release = r));
        let entered!: () => void;
        const inConversion = new Promise<void>((r) => (entered = r));
        const first = fakeDialogs({
            preparing: async () => {
                entered();
                await released;
            },
        });

        const firstOpen = open(showPath, { dialogs: first.dialogs });
        await inConversion;
        const otherHashBefore = sha256(otherPath);
        const secondOpen = open(otherPath);
        // Give the second open every chance to start; it must not.
        await new Promise((r) => setTimeout(r, 50));

        expect(DatabaseServices.getDbPath()).toBe(showPath);
        expect(sha256(otherPath)).toBe(otherHashBefore);
        expect(await sqlProxyWorks()).toBe(false);

        release();
        const [a, b] = await Promise.all([firstOpen, secondOpen]);
        expect([a.status, b.status]).toEqual([200, 200]);
        expect(DatabaseServices.getDbPath()).toBe(otherPath);
        expect(stateOf(showPath).userVersion).toBe(8);
        expect(stateOf(otherPath).userVersion).toBe(8);
    });

    describe("new files", () => {
        it("gate on: created converted, with no backup and no dialogs", async () => {
            const newPath = path.join(tempDir, "new.dots");
            const { dialogs, calls } = fakeDialogs();

            const result = await open(newPath, { isNewFile: true, dialogs });

            expect(result).toMatchObject({ status: 200, sqlSuspended: false });
            expect(calls).toEqual([]);
            expect(backupsIn(tempDir)).toEqual([]);
            const state = stateOf(newPath);
            expect(state).toMatchObject({
                userVersion: 8,
                timelineMode: true,
                timelines: 0,
            });
            expect(JSON.parse(state.settingsJson!)).toMatchObject({
                defaultTempo: 120,
            });

            // Opening it again changes nothing.
            const again = fakeDialogs();
            expect(
                (await open(newPath, { dialogs: again.dialogs })).status,
            ).toBe(200);
            expect(again.calls).toEqual([]);
        });

        it("gate off: created at 7 in page mode, as before", async () => {
            const newPath = path.join(tempDir, "new.dots");

            const result = await open(newPath, { isNewFile: true, env: {} });

            expect(result.status).toBe(200);
            expect(stateOf(newPath)).toMatchObject({
                userVersion: 7,
                timelineMode: undefined,
            });
        });
    });
});
