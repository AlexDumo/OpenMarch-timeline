// @vitest-environment node
/**
 * Quitting while a file converts on open (P9.9). The P9.4 packaged run found
 * that on macOS a Quit sent while "Preparing your file…" was up was cancelled:
 * Electron asks every window to close, and the `closable: false` preparing
 * window refused, so the conversion finished and the app kept running.
 *
 * These tests run the real open path (`openShowDatabase` under the open lock,
 * the Electron dialogs with `electron` mocked, the built worker) and the real
 * file close (`closeShowFileNow`) against a fake of Electron's quit sequence
 * (`Browser::Quit` in Electron 40): `before-quit`, then every window asked to
 * close, newest first; a window that refuses cancels the quit. When the last
 * window closes without a quit, `window-all-closed` fires, and on Windows and
 * Linux the app quits (as `index.ts` does).
 */
import { EventEmitter } from "node:events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import { dialog, type BrowserWindow } from "electron";
import * as DatabaseServices from "@om-electron/database/database.services";
import { OPEN_STOPPED_STATUS } from "@om-electron/database/convertOnOpenGate";
import {
    CONVERSION_STEPS,
    type ConvertWorkerTestHooks,
} from "@om-electron/database/convertOnOpenProtocol";
import {
    buildConvertWorker,
    type BuiltConvertWorker,
} from "@om-electron/database/__test__/buildConvertWorker";
import {
    backupsIn,
    createPageShow,
    GATE_ON,
    migrationsFolder,
    stateOf,
    withDb,
} from "@om-electron/database/__test__/convertOnOpenFixtures";
import { closeShowFileNow } from "../closeShowFile";
import { electronConvertOnOpenDialogs } from "../convertOnOpenDialogs";
import {
    appQuitRequested,
    conversionInProgress,
    markQuitRequested,
    quitInsteadOfClosing,
    resetConversionQuitForTests,
    runningConversionWorkers,
    stopConversionWorkersOnQuit,
} from "../convertWorkerHost";
import { openShowDatabase, openStoppedByQuit, withOpenLock } from "../openShow";
import { hideOverlayScript } from "../preparingOverlay";

// Hoisted above the imports by vitest.
vi.mock("electron", () => ({
    dialog: {
        showMessageBox: vi.fn(),
        showErrorBox: vi.fn(),
    },
    shell: { showItemInFolder: vi.fn() },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    BrowserWindow: vi.fn(),
}));
vi.mock("@sentry/electron/main", () => ({ captureException: vi.fn() }));

/**
 * How the mocked message boxes behave: "answer" resolves at once with the
 * first button; "wait" stays up until its `signal` aborts, then resolves as
 * if cancelled (`cancelId`), as Electron does.
 */
let messageBoxes: "answer" | "wait" = "answer";

function fakeShowMessageBox(
    ...args: unknown[]
): Promise<Electron.MessageBoxReturnValue> {
    const options = args.at(-1) as Electron.MessageBoxOptions;
    if (messageBoxes === "answer")
        return Promise.resolve({ response: 0, checkboxChecked: false });
    const cancelled = {
        response: options.cancelId ?? 0,
        checkboxChecked: false,
    };
    return new Promise((resolve) => {
        if (options.signal?.aborted) resolve(cancelled);
        options.signal?.addEventListener("abort", () => resolve(cancelled));
    });
}

interface PreventableEvent {
    preventDefault(): void;
}

/** A fake of Electron's `app` quit sequence (`Browser::Quit`, `WindowList::CloseAllWindows`). */
class FakeApp extends EventEmitter {
    windows: FakeWindow[] = [];
    /** Electron's `is_quitting_`. */
    isQuitting = false;
    /** The process would exit: every window closed while quitting, or `exit()`. */
    exited = false;
    /** The exit was forced with `app.exit()`. */
    forcedExit = false;
    quitCalls = 0;
    beforeQuitEvents = 0;
    cancelledQuits = 0;

    constructor(readonly platform: NodeJS.Platform = "darwin") {
        super();
    }

    quit = () => {
        this.quitCalls++;
        if (this.isQuitting || this.exited) return;
        let prevented = false;
        this.beforeQuitEvents++;
        this.emit("before-quit", {
            preventDefault: () => (prevented = true),
        } satisfies PreventableEvent);
        if (prevented) return;
        this.isQuitting = true;
        if (this.windows.length === 0) {
            this.exited = true;
            return;
        }
        // macOS closes the newest window first. Every window is asked, even after one refused.
        const windows = [...this.windows];
        if (this.platform === "darwin") windows.reverse();
        for (const window of windows) window.close();
    };

    exit = () => {
        this.exited = true;
        this.forcedExit = true;
    };

    /** `Browser::OnWindowCloseCancelled`: a refused close cancels the quit. */
    windowCloseCancelled() {
        if (this.isQuitting) this.cancelledQuits++;
        this.isQuitting = false;
    }

    /** `Browser::OnWindowAllClosed`. */
    windowClosed(window: FakeWindow) {
        this.windows = this.windows.filter((w) => w !== window);
        if (this.windows.length > 0) return;
        if (this.isQuitting) this.exited = true;
        else this.emit("window-all-closed");
    }
}

/** A fake `BrowserWindow`: the main window, with a page that runs the overlay's scripts. */
class FakeWindow extends EventEmitter {
    destroyed = false;
    progress: number[] = [];
    scripts: string[] = [];
    reloads = 0;
    /** Holds the overlay's paint wait until released (a quit before the worker starts). */
    holdPaint: Promise<void> | undefined;
    /** Called with each script the page runs. */
    onScript: ((code: string) => void) | undefined;
    webContents = {
        executeJavaScript: async (code: string) => {
            this.scripts.push(code);
            this.onScript?.(code);
            if (code.includes("requestAnimationFrame")) await this.holdPaint;
            return true;
        },
        reload: () => void this.reloads++,
    };

    constructor(
        private readonly app: FakeApp,
        private readonly closable = true,
    ) {
        super();
        app.windows.push(this);
    }

    /** `NativeWindowMac::Close` (`NativeWindowViews::Close` does the same). */
    close() {
        if (this.destroyed) return;
        if (!this.closable) {
            this.app.windowCloseCancelled();
            return;
        }
        let prevented = false;
        this.emit("close", {
            preventDefault: () => (prevented = true),
        } satisfies PreventableEvent);
        if (prevented) this.app.windowCloseCancelled();
        else this.destroy();
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.app.windowClosed(this);
    }

    isDestroyed = () => this.destroyed;
    setProgressBar = (p: number) => void this.progress.push(p);

    /** The overlay is up: shown, and not hidden since. */
    get overlayShown() {
        const last = this.scripts.findLast(
            (s) =>
                s === hideOverlayScript ||
                s.includes("document.body.append(overlay)"),
        );
        return last !== undefined && last !== hideOverlayScript;
    }
}

let worker: BuiltConvertWorker;

beforeAll(async () => {
    worker = await buildConvertWorker();
}, 120_000);

afterAll(() => worker?.remove());

/**
 * The parts of `index.ts` around the open and the quit, wired as the app
 * wires them: the stored `databasePath`, `closeCurrentFile` (the real
 * `closeShowFileNow` under the open lock), the main window's `close` handler,
 * `window-all-closed`, `setActiveDb`, and `stopConversionWorkersOnQuit`.
 */
function startApp({
    test,
    platform = "darwin",
    timeoutMs,
}: {
    test?: ConvertWorkerTestHooks;
    platform?: NodeJS.Platform;
    timeoutMs?: number;
} = {}) {
    const app = new FakeApp(platform);
    const main = new FakeWindow(app);
    const store = new Map<string, string>();
    let isQuitting = false;
    const closes: boolean[] = [];
    const thumbnails: string[] = [];
    const quitLog: string[] = [];

    const closeCurrentFile = (isAppQuitting: boolean) =>
        withOpenLock(() => {
            closes.push(isAppQuitting);
            return closeShowFileNow(isAppQuitting, {
                page: () => (main.destroyed ? null : main.webContents),
                hasDraft: () => false,
                discardDraft: async () => {},
                // The page answers only while it can query the file.
                requestSvg: async () => {
                    if (DatabaseServices.isSqlProxySuspended())
                        throw new Error("Timeout waiting for SVG response");
                    return "<svg/>";
                },
                saveSvgPreview: (filePath) => thumbnails.push(filePath),
                forgetFileToReopen: () => store.set("databasePath", ""),
            });
        });

    main.on("close", (event: PreventableEvent) => {
        if (isQuitting) return;
        if (quitInsteadOfClosing(event, app)) return;
        markQuitRequested();
        event.preventDefault();
        void closeCurrentFile(true).then(() => {
            isQuitting = true;
            main.destroy();
            app.quit();
        });
    });

    app.on("window-all-closed", () => {
        if (platform !== "darwin") app.quit();
    });

    stopConversionWorkersOnQuit(app, {
        log: (message) => quitLog.push(message),
        timeoutMs,
        beforeQuitting: async () => {
            await closeCurrentFile(true);
            isQuitting = true;
        },
    });

    /** `setActiveDb` and `setActiveDbNow`, as far as the stored path goes. */
    const setActiveDb = (filePath: string) =>
        withOpenLock(() => setActiveDbNow(filePath));
    const setActiveDbNow = async (filePath: string) => {
        if (appQuitRequested()) return OPEN_STOPPED_STATUS;
        const result = await openShowDatabase(filePath, false, {
            migrationsFolder,
            env: GATE_ON,
            dialogs: () =>
                electronConvertOnOpenDialogs(main as unknown as BrowserWindow),
            convertWorker: { workerPath: worker.workerPath, test },
        });
        result.db?.close();
        if (result.sqlSuspension !== undefined)
            DatabaseServices.resumeSqlProxy(result.sqlSuspension);
        if (result.status === 200) store.set("databasePath", filePath);
        else if (openStoppedByQuit(result.status))
            store.set("databasePath", filePath);
        else store.delete("databasePath");
        return result.status;
    };

    return { app, main, store, closes, thumbnails, quitLog, setActiveDb };
}

/** Resolves once the open shows its first converted page in the overlay. */
const convertingStarted = (main: FakeWindow) =>
    vi.waitFor(
        () =>
            expect(
                main.scripts.some((s) => s.includes("Converting page")),
            ).toBe(true),
        { timeout: 10_000 },
    );

/** Resolves once a message box is up. */
const messageBoxShown = () =>
    vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalled(), {
        timeout: 10_000,
    });

describe("quitting while a file converts on open (P9.9)", () => {
    let tempDir: string;
    let showPath: string;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmarch-quit-"));
        showPath = path.join(tempDir, "show.dots");
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
        messageBoxes = "answer";
        vi.mocked(dialog.showMessageBox)
            .mockClear()
            .mockImplementation(fakeShowMessageBox as never);
        await createPageShow(showPath);
    });

    afterEach(async () => {
        // A worker a forced exit left behind ends once its native call returns.
        await vi.waitFor(() => expect(runningConversionWorkers()).toBe(0), {
            timeout: 30_000,
        });
        resetConversionQuitForTests();
        DatabaseServices.forceResumeSqlProxy();
        DatabaseServices.closePersistentConnection();
        DatabaseServices.setDbPath("", false);
        fs.rmSync(tempDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it("one Quit mid-conversion stops the worker, keeps the file at 7 and as the one to reopen, removes the overlay, and quits", async () => {
        const { app, main, store, closes, setActiveDb } = startApp({
            // 6 pages × 2 s: still converting when the app quits.
            test: { blockPerPageMs: 2000 },
        });
        store.set("databasePath", "/previous.dots");
        const before = stateOf(showPath);

        const opened = setActiveDb(showPath);
        await convertingStarted(main);
        expect(runningConversionWorkers()).toBe(1);
        expect(main.overlayShown).toBe(true);

        app.quit(); // Cmd+Q, the menu's Quit, or the system: all reach `before-quit`.

        expect(await opened).toBe(OPEN_STOPPED_STATUS);
        await vi.waitFor(() => expect(app.exited).toBe(true));

        // One Quit was enough, and no window refused to close.
        expect(app.beforeQuitEvents).toBe(2); // the held quit, then the handler's own
        expect(app.cancelledQuits).toBe(0);
        expect(runningConversionWorkers()).toBe(0);
        expect(conversionInProgress()).toBe(false);
        // Rolled back: version 7, no timeline rows; the backup stays next to it.
        expect(stateOf(showPath)).toEqual(before);
        expect(stateOf(showPath)).toMatchObject({
            userVersion: 7,
            timelines: 0,
        });
        expect(backupsIn(tempDir)).toHaveLength(1);
        // The next launch reopens, and so converts, the file.
        expect(store.get("databasePath")).toBe(showPath);
        expect(closes).toEqual([true]);
        // The overlay is gone and the taskbar progress cleared; no dialog was shown.
        expect(main.overlayShown).toBe(false);
        expect(main.progress.at(-1)).toBe(-1);
        expect(dialog.showMessageBox).not.toHaveBeenCalled();
    }, 30_000);

    it("a Quit while the overlay paints, before the worker starts, keeps the conversion from starting", async () => {
        const { app, main, store, setActiveDb } = startApp();
        let paint!: () => void;
        main.holdPaint = new Promise((resolve) => (paint = resolve));
        const before = stateOf(showPath);

        const opened = setActiveDb(showPath);
        await vi.waitFor(() => expect(conversionInProgress()).toBe(true));
        expect(runningConversionWorkers()).toBe(0);

        app.quit();
        expect(app.isQuitting).toBe(false); // held, not cancelled by a window
        paint();

        expect(await opened).toBe(OPEN_STOPPED_STATUS);
        await vi.waitFor(() => expect(app.exited).toBe(true));
        expect(app.cancelledQuits).toBe(0);
        expect(stateOf(showPath)).toEqual(before);
        expect(backupsIn(tempDir)).toHaveLength(0);
        expect(store.get("databasePath")).toBe(showPath);
        expect(dialog.showMessageBox).not.toHaveBeenCalled();
    }, 30_000);

    it("a second Quit while the first is stopping the conversion is held too, and nothing quits twice", async () => {
        const { app, main, setActiveDb } = startApp({
            test: { blockPerPageMs: 2000 },
        });

        const opened = setActiveDb(showPath);
        await convertingStarted(main);
        app.quit();
        app.quit(); // impatient
        await opened;
        await vi.waitFor(() => expect(app.exited).toBe(true));
        expect(app.cancelledQuits).toBe(0);
        expect(stateOf(showPath).userVersion).toBe(7);
    }, 30_000);

    it("closing the main window mid-conversion quits the same way", async () => {
        const { app, main, store, setActiveDb } = startApp({
            test: { blockPerPageMs: 2000 },
        });

        const opened = setActiveDb(showPath);
        await convertingStarted(main);

        main.close(); // the red button, or the title bar's close on Windows and Linux

        expect(await opened).toBe(OPEN_STOPPED_STATUS);
        await vi.waitFor(() => expect(app.exited).toBe(true));
        expect(stateOf(showPath)).toMatchObject({
            userVersion: 7,
            timelines: 0,
        });
        expect(store.get("databasePath")).toBe(showPath);
    }, 30_000);

    it("an open queued behind the stopped one doesn't start", async () => {
        const second = path.join(tempDir, "second.dots");
        await createPageShow(second);
        const { app, main, store, setActiveDb } = startApp({
            test: { blockPerPageMs: 2000 },
        });

        const first = setActiveDb(showPath);
        await convertingStarted(main);
        const queued = setActiveDb(second);
        app.quit();

        expect(await first).toBe(OPEN_STOPPED_STATUS);
        expect(await queued).toBe(OPEN_STOPPED_STATUS);
        await vi.waitFor(() => expect(app.exited).toBe(true));
        expect(stateOf(second).userVersion).toBe(7);
        expect(store.get("databasePath")).toBe(showPath);
    }, 30_000);

    it("a Quit with no conversion in progress isn't held, and the file is closed as before", async () => {
        const { app, store, closes } = startApp();
        store.set("databasePath", showPath);

        app.quit();

        await vi.waitFor(() => expect(app.exited).toBe(true));
        expect(app.beforeQuitEvents).toBe(2); // the main window's close handler quits again
        expect(closes).toEqual([true]);
        expect(store.get("databasePath")).toBe("");
    });

    describe("regression: a window that refuses to close during before-quit", () => {
        it("a non-closable window cancels Electron's quit (the P9.4 failure, reproduced by the fake)", () => {
            const app = new FakeApp();
            new FakeWindow(app);
            new FakeWindow(app, false); // the old `modal: true, closable: false` preparing window

            app.quit();

            expect(app.cancelledQuits).toBe(1);
            expect(app.exited).toBe(false);
        });

        it("no window is asked to close until the conversion has stopped and the overlay is gone", async () => {
            const { app, main, setActiveDb } = startApp({
                test: { blockPerPageMs: 2000 },
            });
            const asked: { converting: boolean; overlay: boolean }[] = [];
            main.prependListener("close", () =>
                asked.push({
                    converting: conversionInProgress(),
                    overlay: main.overlayShown,
                }),
            );

            const opened = setActiveDb(showPath);
            await convertingStarted(main);
            app.quit();
            await opened;
            await vi.waitFor(() => expect(app.exited).toBe(true));

            expect(asked).toEqual([{ converting: false, overlay: false }]);
            expect(app.cancelledQuits).toBe(0);
        }, 30_000);
    });

    describe("the held quit's time limit", () => {
        it("exits the process when the worker can't be stopped in time (a native call ignores terminate)", async () => {
            const { app, main, quitLog, setActiveDb } = startApp({
                // A long SQLite call after each page: terminate waits for it to return.
                test: { nativeBlockRows: 30_000_000 },
                timeoutMs: 300,
            });

            const opened = setActiveDb(showPath);
            await convertingStarted(main);
            app.quit();
            app.quit(); // impatient: held too
            expect(app.exited).toBe(false);

            await vi.waitFor(() => expect(app.exited).toBe(true), {
                timeout: 5_000,
            });
            expect(app.forcedExit).toBe(true);
            expect(
                quitLog.some((m) => m.includes("didn't stop within 300 ms")),
            ).toBe(true);
            // A further Quit while it waited was held, not let through.
            expect(app.cancelledQuits).toBe(0);

            // Once the native call returns the worker ends, rolled back.
            expect(await opened).toBe(OPEN_STOPPED_STATUS);
            expect(stateOf(showPath)).toMatchObject({
                userVersion: 7,
                timelines: 0,
            });
        }, 60_000);
    });

    describe("quit timings around the conversion's dialogs", () => {
        it("in the gap between the worker's exit and the end of the preparing step: the conversion stands, one Quit", async () => {
            const { app, main, store, setActiveDb } = startApp();
            const atQuit: { workers: number; converting: boolean }[] = [];
            main.onScript = (code) => {
                // The overlay is hidden right before the preparing step ends.
                if (code === hideOverlayScript) {
                    atQuit.push({
                        workers: runningConversionWorkers(),
                        converting: conversionInProgress(),
                    });
                    app.quit();
                }
            };

            expect(await setActiveDb(showPath)).toBe(200);
            await vi.waitFor(() => expect(app.exited).toBe(true));

            expect(atQuit).toEqual([{ workers: 0, converting: true }]);
            expect(app.beforeQuitEvents).toBe(2);
            expect(app.cancelledQuits).toBe(0);
            expect(stateOf(showPath).userVersion).toBe(8);
            // No "Converted" sheet over a closing window.
            expect(dialog.showMessageBox).not.toHaveBeenCalled();
            // Not stopped by the quit: closed as usual, with its thumbnail.
            expect(store.get("databasePath")).toBe("");
        }, 30_000);

        it("while the older-release warning is up: it closes as Cancel and the app quits", async () => {
            const { app, main, store, setActiveDb } = startApp();
            expect(await setActiveDb(showPath)).toBe(200);
            // Saved by a release without the version guard.
            withDb(showPath, (db) => db.exec("PRAGMA user_version = 7"));
            const before = stateOf(showPath);
            messageBoxes = "wait";
            vi.mocked(dialog.showMessageBox).mockClear();

            const opened = setActiveDb(showPath);
            await messageBoxShown();
            expect(conversionInProgress()).toBe(false);
            app.quit();

            expect(await opened).toBe(OPEN_STOPPED_STATUS);
            await vi.waitFor(() => expect(app.exited).toBe(true));
            expect(dialog.showMessageBox).toHaveBeenCalledOnce();
            expect(stateOf(showPath)).toEqual(before);
            expect(store.get("databasePath")).toBe("");
            expect(main.destroyed).toBe(true);
        }, 30_000);

        it("while the backup-failed dialog is up: it closes and the app quits", async () => {
            const { app, setActiveDb } = startApp({
                test: {
                    backupFailure: {
                        ok: false,
                        code: "disk-full",
                        message: "The disk is full.",
                    },
                },
            });
            const before = stateOf(showPath);
            messageBoxes = "wait";

            const opened = setActiveDb(showPath);
            await messageBoxShown();
            app.quit();

            expect(await opened).toBe(OPEN_STOPPED_STATUS);
            await vi.waitFor(() => expect(app.exited).toBe(true));
            expect(stateOf(showPath)).toEqual(before);
        }, 30_000);

        it("while the conversion-failed dialog is up: it closes and the app quits", async () => {
            const { app, setActiveDb } = startApp({
                test: { failAfterStep: CONVERSION_STEPS[0] },
            });
            const before = stateOf(showPath);
            messageBoxes = "wait";

            const opened = setActiveDb(showPath);
            await messageBoxShown();
            app.quit();

            expect(await opened).toBe(OPEN_STOPPED_STATUS);
            await vi.waitFor(() => expect(app.exited).toBe(true));
            expect(stateOf(showPath)).toEqual(before);
        }, 30_000);

        it("closing the main window before the conversion starts keeps it from starting", async () => {
            const { app, main, store, setActiveDb } = startApp();
            let paint!: () => void;
            main.holdPaint = new Promise((resolve) => (paint = resolve));
            const before = stateOf(showPath);

            const opened = setActiveDb(showPath);
            await vi.waitFor(() => expect(conversionInProgress()).toBe(true));
            main.close();
            paint();

            expect(await opened).toBe(OPEN_STOPPED_STATUS);
            await vi.waitFor(() => expect(app.exited).toBe(true));
            expect(stateOf(showPath)).toEqual(before);
            expect(store.get("databasePath")).toBe(showPath);
        }, 30_000);
    });

    describe("closing the file", () => {
        it("a normal quit still saves the thumbnail of the open file", async () => {
            const { app, store, thumbnails, closes, setActiveDb } = startApp();
            expect(await setActiveDb(showPath)).toBe(200);

            app.quit();

            await vi.waitFor(() => expect(app.exited).toBe(true));
            expect(closes).toEqual([true]);
            expect(thumbnails).toEqual([showPath]);
            expect(store.get("databasePath")).toBe("");
        }, 30_000);

        it("waits for the open, and asks no thumbnail while the SQL is suspended", async () => {
            const { app, main, thumbnails, setActiveDb } = startApp({
                test: { blockPerPageMs: 2000 },
            });
            const opened = setActiveDb(showPath);
            await convertingStarted(main);
            app.quit();
            await opened;
            await vi.waitFor(() => expect(app.exited).toBe(true));
            expect(thumbnails).toEqual([]);
        }, 30_000);
    });

    describe("on Windows and Linux", () => {
        it("closing the main window mid-conversion quits once, the file at 7 and kept to reopen", async () => {
            const { app, main, store, setActiveDb } = startApp({
                platform: "win32",
                test: { blockPerPageMs: 2000 },
            });

            const opened = setActiveDb(showPath);
            await convertingStarted(main);
            main.close(); // the overlay's close button, or Alt+F4

            expect(await opened).toBe(OPEN_STOPPED_STATUS);
            await vi.waitFor(() => expect(app.exited).toBe(true));
            expect(app.cancelledQuits).toBe(0);
            expect(stateOf(showPath).userVersion).toBe(7);
            expect(store.get("databasePath")).toBe(showPath);
        }, 30_000);

        it("closing the main window with no conversion closes the file and quits", async () => {
            const { app, main, thumbnails, setActiveDb } = startApp({
                platform: "linux",
            });
            expect(await setActiveDb(showPath)).toBe(200);

            main.close();

            await vi.waitFor(() => expect(app.exited).toBe(true));
            expect(thumbnails).toEqual([showPath]);
        }, 30_000);
    });
});
