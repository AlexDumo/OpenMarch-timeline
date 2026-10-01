// @vitest-environment node
/**
 * Quitting while a file converts on open (P9.9). The P9.4 packaged run found
 * that on macOS a Quit sent while "Preparing your file…" was up was cancelled:
 * Electron asks every window to close, and the `closable: false` preparing
 * window refused, so the conversion finished and the app kept running.
 *
 * These tests run the real open path (`openShowFile`, the Electron dialogs
 * with `electron` mocked, the built worker) against a fake of Electron's quit
 * sequence (`Browser::Quit` in Electron 40): `before-quit`, then every window
 * asked to close, newest first; a window that refuses cancels the quit.
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
import type { ConvertWorkerTestHooks } from "@om-electron/database/convertOnOpenProtocol";
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
} from "@om-electron/database/__test__/convertOnOpenFixtures";
import { electronConvertOnOpenDialogs } from "../convertOnOpenDialogs";
import {
    appQuitRequested,
    conversionInProgress,
    keepFileToReopen,
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
        showMessageBox: vi.fn(async () => ({ response: 0 })),
        showErrorBox: vi.fn(),
    },
    shell: { showItemInFolder: vi.fn() },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    BrowserWindow: vi.fn(),
}));
vi.mock("@sentry/electron/main", () => ({ captureException: vi.fn() }));

interface PreventableEvent {
    preventDefault(): void;
}

/** A fake of Electron's `app` quit sequence (`Browser::Quit`, `WindowList::CloseAllWindows`). */
class FakeApp extends EventEmitter {
    windows: FakeWindow[] = [];
    /** Electron's `is_quitting_`. */
    isQuitting = false;
    /** The process would exit: every window closed while quitting. */
    exited = false;
    quitCalls = 0;
    beforeQuitEvents = 0;
    cancelledQuits = 0;

    quit = () => {
        this.quitCalls++;
        if (this.isQuitting) return;
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
        for (const window of [...this.windows].reverse()) window.close();
    };

    /** `Browser::OnWindowCloseCancelled`: a refused close cancels the quit. */
    windowCloseCancelled() {
        if (this.isQuitting) this.cancelledQuits++;
        this.isQuitting = false;
    }

    windowClosed(window: FakeWindow) {
        this.windows = this.windows.filter((w) => w !== window);
        if (this.windows.length === 0 && this.isQuitting) this.exited = true;
    }
}

/** A fake `BrowserWindow`: the main window, with a page that runs the overlay's scripts. */
class FakeWindow extends EventEmitter {
    destroyed = false;
    progress: number[] = [];
    scripts: string[] = [];
    /** Holds the overlay's paint wait until released (a quit before the worker starts). */
    holdPaint: Promise<void> | undefined;
    webContents = {
        executeJavaScript: async (code: string) => {
            this.scripts.push(code);
            if (code.includes("requestAnimationFrame")) await this.holdPaint;
            return true;
        },
    };

    constructor(
        private readonly app: FakeApp,
        private readonly closable = true,
    ) {
        super();
        app.windows.push(this);
    }

    /** `NativeWindowMac::Close`. */
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
 * wires them: the stored `databasePath`, the main window's `close` handler,
 * `setActiveDb`, and `stopConversionWorkersOnQuit` with `beforeQuitting`.
 */
function startApp({ test }: { test?: ConvertWorkerTestHooks } = {}) {
    const app = new FakeApp();
    const main = new FakeWindow(app);
    const store = new Map<string, string>();
    let isQuitting = false;
    const closes: boolean[] = [];

    /** `closeCurrentFileNow`, as far as the stored path goes. */
    const closeCurrentFile = async (isAppQuitting: boolean) => {
        closes.push(isAppQuitting);
        DatabaseServices.setDbPath("", false);
        if (!keepFileToReopen(isAppQuitting)) store.set("databasePath", "");
    };

    main.on("close", (event: PreventableEvent) => {
        if (isQuitting) return;
        if (quitInsteadOfClosing(event, app)) return;
        event.preventDefault();
        void closeCurrentFile(true).then(() => {
            isQuitting = true;
            main.destroy();
            app.quit();
        });
    });

    stopConversionWorkersOnQuit(app, {
        log: () => {},
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

    return { app, main, store, closes, setActiveDb };
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

describe("quitting while a file converts on open (P9.9)", () => {
    let tempDir: string;
    let showPath: string;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmarch-quit-"));
        showPath = path.join(tempDir, "show.dots");
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(dialog.showMessageBox).mockClear();
        await createPageShow(showPath);
    });

    afterEach(() => {
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
});
