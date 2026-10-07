/* eslint-disable no-console */
import {
    app,
    BrowserWindow,
    shell,
    ipcMain,
    Menu,
    dialog,
    MenuItemConstructorOptions,
} from "electron";
import Store from "electron-store";
import * as fs from "fs";
import { release } from "node:os";
import { isWindows7 } from "./gpu";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve, sep } from "node:path";
import * as DatabaseServices from "../database/database.services";
import { applicationMenu } from "./application-menu";
import { PDFExportService } from "./services/export-service";
import { VideoExportService } from "./services/video-export-service";
import {
    addRecentFile,
    getRecentFiles,
    removeRecentFile,
    clearRecentFiles,
    updateRecentFileSvgPreview,
    clearMissingRecentFiles,
} from "./services/recent-files-service";
import type AudioFile from "../../src/global/classes/AudioFile";
import { init, captureException } from "@sentry/electron/main";

import { DrizzleMigrationService } from "../database/services/DrizzleMigrationService";
import { getOrm } from "../database/db";
import {
    applyAutomaticUpdatesSetting,
    automaticUpdatesAreEnabled,
    startAutomaticUpdates,
} from "./update";
import { repairDatabase } from "../database/repair";
import { removeIfPresent, replaceFileDurably } from "../database/atomicFile";
import {
    type RecoverableShow,
    type RecoverableWorkingCopy,
    type SaveOutcome,
    type WorkingCopyConflictChoice,
    type WorkingCopyStatus,
    WorkingCopySession,
    discardWorkingCopy,
    scanWorkingCopies,
} from "../database/workingCopy/WorkingCopySession";
import { choosePreviousDotsFile } from "./services/previous-dots-import-service";
import {
    initAuthBeforeReady,
    initAuthAfterReady,
    handleAuthSecondInstance,
} from "./auth";

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.js    > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//

let isQuitting = false;
let windowIsClosing = false;
const store = new Store();
const DB_USER_VERSION = 7;

/** Active new-show draft file in userData/new-show-drafts (not in recent files until finalized). */
let currentNewShowDraftPath: string | null = null;

function getNewShowDraftsDirectory(): string {
    return join(app.getPath("userData"), "new-show-drafts");
}

function isNewShowDraftPath(filePath: string): boolean {
    if (!filePath) return false;
    const draftsDir = getNewShowDraftsDirectory();
    return resolve(filePath).startsWith(resolve(draftsDir) + sep);
}

// Check if running in Playwright codegen mode
export const isCodegen = !!process.env.PLAYWRIGHT_CODEGEN;

const enableSentry =
    process.env.NODE_ENV !== "development" && !store.get("optOutAnalytics");
console.log("Sentry error reporting enabled:", enableSentry);
init({
    dsn: "https://72e6204c8e527c4cb7a680db2f9a1e0b@o4509010215239680.ingest.us.sentry.io/4509010222579712",
    enabled: enableSentry,
});

ipcMain.on("settings:set", (_, settings) => {
    for (const [key, value] of Object.entries(settings)) {
        store.set(key, value);
    }

    if (Object.prototype.hasOwnProperty.call(settings, "automaticUpdates")) {
        const enabled = automaticUpdatesAreEnabled(settings.automaticUpdates);
        if (app.isPackaged && !process.env.SNAP) {
            // Applies immediately so opting out also cancels an already-staged install.
            applyAutomaticUpdatesSetting(enabled);
            if (enabled) {
                void startAutomaticUpdates({
                    isPackaged: true,
                    automaticUpdatesEnabled: true,
                });
            }
        }
    }
});

ipcMain.handle("settings:get", (_, key) => {
    return store.get(key);
});

ipcMain.handle("env:get", () => {
    return {
        isCodegen: isCodegen,
        isCI: !!process.env.CI,
        isPlaywrightSession: !!process.env.PLAYWRIGHT_SESSION,
    };
});

ipcMain.handle("shell:openExternal", async (_, url: string) => {
    try {
        const parsedUrl = new URL(url);
        // Only allow http and https protocols
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
            throw new Error(`Unsafe URL protocol: ${parsedUrl.protocol}`);
        }
        await shell.openExternal(url);
    } catch (error) {
        console.error("Error opening external URL:", error);
        throw error;
    }
});

process.env.DIST_ELECTRON = join(__dirname, "../");
process.env.DIST = join(process.env.DIST_ELECTRON, "../dist");
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
    ? join(process.env.DIST_ELECTRON, "../public")
    : process.env.DIST;

// Disable GPU Acceleration for Windows 7
if (isWindows7(process.platform, release())) app.disableHardwareAcceleration();

// Set application name for Windows 10+ notifications
if (process.platform === "win32") app.setAppUserModelId(app.getName());

// Initialize auth protocol handler before app is ready
initAuthBeforeReady();

if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
}

// Remove electron security warnings
// This warning only shows in development mode
// Read more on https://www.electronjs.org/docs/latest/tutorial/security
// process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'

let win: BrowserWindow | null = null;
// Here, you can also use other preload
const preload = join(__dirname, "../preload/index.js");
const url = process.env.VITE_DEV_SERVER_URL;
const indexHtml = join(process.env.DIST, "index.html");
// eslint-disable-next-line max-lines-per-function
async function createWindow(title?: string) {
    win = new BrowserWindow({
        title: title || "OpenMarch",
        icon: join(process.env.VITE_PUBLIC, "favicon.ico"),
        minWidth: 1000,
        minHeight: 600,
        autoHideMenuBar: true,
        // Show frame in codegen mode for easier interaction
        frame: isCodegen,
        trafficLightPosition: { x: 24, y: 9 },
        titleBarStyle: "hidden",
        webPreferences: {
            preload,
            // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
            // Consider using contextBridge.exposeInMainWorld
            // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
            nodeIntegration: false, // is default value after Electron v5
            contextIsolation: true, // protect against prototype pollution
            spellcheck: true,
        },
    });
    app.commandLine.appendSwitch("enable-features", "AudioServiceOutOfProcess");

    // Initialize auth IPC handlers before renderer navigation to avoid startup
    // races where the renderer invokes auth channels before handlers exist.
    initAuthAfterReady(() => win);

    win.webContents.session.webRequest.onHeadersReceived(
        (details, callback) => {
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    "Content-Security-Policy": [
                        "script-src 'self' 'unsafe-inline' https://app.glitchtip.com https://us-assets.i.posthog.com; worker-src 'self' data: blob:;",
                    ],
                },
            });
        },
    );

    if (url) {
        // electron-vite-vue#298
        void win.loadURL(url);
        win.on("ready-to-show", () => {
            // Always open DevTools in codegen mode for debugging
            if (win && (isCodegen || process.env.NODE_ENV === "development")) {
                win.webContents.openDevTools();
            }
        });
    } else {
        void win.loadFile(indexHtml);
    }

    // Test actively push message to the Electron-Renderer
    win.webContents.on("did-finish-load", () => {
        win?.maximize();
        win?.webContents.send(
            "main-process-message",
            new Date().toLocaleString(),
        );
    });

    win.webContents.on(
        "did-start-navigation",
        (_event, _url, _isInPlace, isMainFrame) => {
            if (!isMainFrame || !currentNewShowDraftPath) return;
            void discardNewShowDraft().catch((error) => {
                console.error(
                    "Error discarding new show draft on navigation:",
                    error,
                );
            });
        },
    );

    win.on("close", async (event: Electron.Event) => {
        if (isQuitting) return;

        event.preventDefault();
        if (windowIsClosing) return;
        windowIsClosing = true;

        // A working copy saves before the window hides, so a save problem
        // can still be shown and the user can cancel quitting.
        if (workingCopy) {
            const proceed = await endWorkingCopy("quit").catch((e) => {
                console.error("Error saving before quit:", e);
                return true;
            });
            if (!proceed) {
                windowIsClosing = false;
                return;
            }
        }

        win!.hide(); // use non-null assertion now that we're inside the if-block

        try {
            await closeCurrentFile(true);
        } catch (e) {
            console.error("Error closing file:", e);
        }

        isQuitting = true;
        win!.destroy();
        win = null;
        app.quit();
    });

    // Save when the user switches away, so the show on disk is current.
    win.on("blur", () => {
        void workingCopy?.flush("blur");
    });

    // Make all links open with the browser, not with the application
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("https:")) void shell.openExternal(url);
        return { action: "deny" };
    });

    // Context menu with spellcheck suggestions and basic edit actions
    win.webContents.on("context-menu", (event, params) => {
        const template: MenuItemConstructorOptions[] = [];

        if (params.misspelledWord && params.dictionarySuggestions.length > 0) {
            template.push(
                ...params.dictionarySuggestions.map((suggestion) => ({
                    label: suggestion,
                    click: () => {
                        win?.webContents.replaceMisspelling(suggestion);
                    },
                })),
                { type: "separator" },
            );
        }

        if (params.isEditable) {
            template.push(
                { role: "undo" },
                { role: "redo" },
                { type: "separator" },
                { role: "cut" },
                { role: "copy" },
                { role: "paste" },
                { type: "separator" },
                { role: "selectAll" },
            );
        } else if (params.selectionText && params.selectionText.trim()) {
            template.push({ role: "copy" }, { role: "selectAll" });
        }

        if (!template.length) return;

        const menu = Menu.buildFromTemplate(template);
        menu.popup({ window: win! });
    });
}

function resolveStartupDatabasePath(): string {
    let pathToOpen = store.get("databasePath") as string;
    const pathFromArgs = process.argv.find((arg) => arg.endsWith(".dots"));
    if (pathFromArgs) pathToOpen = pathFromArgs;
    console.log("Path to Open:", pathToOpen);
    if (pathToOpen && isNewShowDraftPath(pathToOpen)) {
        if (fs.existsSync(pathToOpen)) fs.unlinkSync(pathToOpen);
        store.delete("databasePath");
        return "";
    }
    return pathToOpen || "";
}

function getPlaywrightDefaultDocumentsPath(): string | undefined {
    if (
        process.env.PLAYWRIGHT_SESSION &&
        process.env.PLAYWRIGHT_NEW_FILE_PATH
    ) {
        return dirname(process.env.PLAYWRIGHT_NEW_FILE_PATH);
    }
    return undefined;
}

async function showSaveDialogHandler(options: Electron.SaveDialogOptions) {
    if (!win) return { canceled: true, filePath: "" };
    const playwrightPath = getPlaywrightDefaultDocumentsPath();
    if (playwrightPath && process.env.PLAYWRIGHT_NEW_FILE_PATH) {
        return {
            canceled: false,
            filePath: process.env.PLAYWRIGHT_NEW_FILE_PATH,
        };
    }
    return await dialog.showSaveDialog(win, options);
}

async function openRecentFile(filePath: string) {
    store.set("databasePath", filePath);
    addRecentFile(filePath);

    const resCode = await setActiveDb(filePath);

    win?.webContents.send("load-file-response", resCode);

    return resCode;
}

function initDatabaseIpcHandlers() {
    ipcMain.handle("database:isReady", DatabaseServices.databaseIsReady);
    ipcMain.handle("database:getPath", () => DatabaseServices.getDbPath());
    ipcMain.handle("database:save", async () => saveFile());
    ipcMain.handle("database:load", async () => loadDatabaseFile());
    ipcMain.handle("database:create", async () => newFile());
    ipcMain.handle("database:createAtPath", async (_, filePath: string) =>
        createFileAtPath(filePath),
    );
    ipcMain.handle("dialog:showSaveDialog", async (_, options) =>
        showSaveDialogHandler(options),
    );
    ipcMain.handle("getDefaultDocumentsPath", () => {
        return getPlaywrightDefaultDocumentsPath() ?? app.getPath("documents");
    });
    ipcMain.handle("file:exists", (_, filePath: string) => {
        if (!filePath) return false;
        const pathToCheck = filePath.endsWith(".dots")
            ? filePath
            : `${filePath}.dots`;
        return fs.existsSync(pathToCheck);
    });
    ipcMain.handle("newShow:getPending", () => {
        return store.get("pendingNewShowDialog") === true;
    });
    ipcMain.handle("newShow:clearPending", () => {
        store.set("pendingNewShowDialog", false);
    });
    ipcMain.handle("newShow:createDraft", async () => createNewShowDraft());
    ipcMain.handle(
        "newShow:finalizeDraft",
        async (_, targetPath: string, projectName: string) =>
            finalizeNewShowDraft(targetPath, projectName),
    );
    ipcMain.handle("newShow:discardDraft", async () => discardNewShowDraft());
    ipcMain.handle("newShow:getDraftPath", () => currentNewShowDraftPath);
    ipcMain.handle("newShow:choosePreviousDotsFile", async () =>
        choosePreviousDotsFile(win),
    );
    ipcMain.handle("database:repair", async (_, dbPath: string) => {
        try {
            // Repair reads the show file, so it must hold the latest changes.
            if (!(await endWorkingCopy("repair"))) return dbPath;
            DatabaseServices.closePersistentConnection();
            const newPath = await repairDatabase(dbPath);
            await setActiveDb(newPath);
            return newPath;
        } catch (error) {
            console.error("Error repairing database:", error);
            throw error;
        }
    });
    ipcMain.handle("audio:insert", async () => insertAudioFile());
    initWorkingCopyIpcHandlers();
}

function initRecentFilesIpcHandlers() {
    ipcMain.handle("recent-files:get", getRecentFiles);
    ipcMain.handle("recent-files:remove", (_, filePath) =>
        removeRecentFile(filePath),
    );
    ipcMain.handle("recent-files:clear", clearRecentFiles);
    ipcMain.handle("recent-files:clear-missing", clearMissingRecentFiles);
    ipcMain.handle("recent-files:open", async (_, filePath) =>
        openRecentFile(filePath),
    );
}

function initIpcHandlers() {
    initDatabaseIpcHandlers();
    initRecentFilesIpcHandlers();
}

void app.whenReady().then(async () => {
    app.setName("OpenMarch");
    console.log("NODE:", process.versions.node);

    if (isCodegen) {
        console.log("🎭 Running in Playwright Codegen mode");
    } else {
        console.log("Not running in codegen mode");
    }

    Menu.setApplicationMenu(applicationMenu);

    // Working copies left by a crash. Their shows open from the launch page,
    // where the user can recover or discard the unsaved changes.
    recoverableWorkingCopies = scanWorkingCopies(getWorkingCopyRoot());
    const pathToOpen = resolveStartupDatabasePath();
    const pendingRecovery = recoverableWorkingCopies.some(
        (entry) => resolve(entry.manifest.showPath) === resolve(pathToOpen),
    );
    if (pathToOpen.length > 0 && !pendingRecovery)
        await setActiveDb(pathToOpen);
    DatabaseServices.initHandlers();

    console.log("db_path: " + DatabaseServices.getDbPath());

    initIpcHandlers();
    initGetters();

    await createWindow("OpenMarch - " + store.get("databasePath"));

    void startAutomaticUpdates({
        isPackaged: app.isPackaged,
        automaticUpdatesEnabled: automaticUpdatesAreEnabled(
            store.get("automaticUpdates"),
        ),
        isSnap: Boolean(process.env.SNAP),
    });
});

function initGetters() {
    // Exports
    ipcMain.handle("export:pdf", async (_, params) => {
        await saveBeforeExport();
        return await PDFExportService.export(
            params.sheets,
            params.organizeBySection,
            params.quarterPages,
        );
    });

    // Create Export Directory
    ipcMain.handle(
        "export:createExportDirectory",
        async (_, defaultName: string) => {
            await saveBeforeExport();
            return await PDFExportService.createExportDirectory(defaultName);
        },
    );

    // Export SVG pages to PDF
    ipcMain.handle("export:generateDocForMarcher", async (_, args) => {
        return await PDFExportService.generateDocForMarcher(args);
    });

    // Video export (streamed file writing)
    ipcMain.handle("export:videoStart", async (_, fileExtension: string) => {
        await saveBeforeExport();
        return await VideoExportService.start(fileExtension);
    });
    ipcMain.handle(
        "export:videoChunk",
        async (_, sessionId: string, data: Uint8Array, position: number) => {
            return await VideoExportService.writeChunk(
                sessionId,
                data,
                position,
            );
        },
    );
    ipcMain.handle(
        "export:videoEnd",
        async (_, sessionId: string, success: boolean) => {
            return await VideoExportService.end(sessionId, success);
        },
    );

    // Get current filename
    ipcMain.handle("get-current-filename", async () => {
        return PDFExportService.getCurrentFilename();
    });

    // Opens the export directory
    ipcMain.handle("open-export-directory", async (_, exportDir: string) => {
        return PDFExportService.openExportDirectory(exportDir);
    });

    // Export Full Charts
    // ipcMain.handle(

    //    "send:exportCanvas",
    //   async (_, dataUrl: string) =>
    //       await exportCanvas(dataUrl)
    //);
}

// Close the show's connection on the way out so nothing is left mid-write.
app.on("will-quit", () => {
    DatabaseServices.closeDatabase();
});

app.on("window-all-closed", async () => {
    win = null;
    if (process.platform !== "darwin") app.quit();
});

app.on("open-file", async (event, path) => {
    event.preventDefault();
    await setActiveDb(path);
});

// Handle instances where the app is already running and a file is opened
// const gotTheLock = app.requestSingleInstanceLock();
// if (!gotTheLock) {
//   app.quit();
// } else {
//   app.on('second-instance', (event, argv) => {
//     // Handle the file path passed when a second instance is opened
//     const filePath = argv.find(arg => !arg.startsWith('--') && path.extname(arg));
//     if (mainWindow && filePath) {
//       mainWindow.webContents.send('open-file', filePath);
//     }
//   });
// }

app.on("second-instance", (_event, commandLine) => {
    // First check if this is an auth callback (Windows/Linux)
    const isAuthCallback = handleAuthSecondInstance(commandLine, () => win);

    // If not an auth callback, just focus the window
    if (!isAuthCallback && win) {
        if (win.isMinimized()) win.restore();
        win.focus();
    }
});

// Custom title bar buttons

const isMacOS = process.platform === "darwin";

ipcMain.on("window:minimize", () => {
    win?.minimize();
});

ipcMain.on("window:maximize", () => {
    if (win?.isMaximized()) {
        win.unmaximize();
    } else {
        win?.maximize();
    }
});

ipcMain.on("window:close", () => {
    // With a working copy, the window's close handler saves and closes the
    // show once, and can still be cancelled.
    if (!workingCopy) void closeCurrentFile();
    win?.close();
});

ipcMain.on(`menu:open`, () => {
    if (!isMacOS) {
        applicationMenu.popup();
    }
});

// Theme stores

ipcMain.handle("get-theme", () => {
    return store.get("theme", "light");
});

ipcMain.handle("set-theme", (event, theme) => {
    store.set("theme", theme);
});

// Language stores

ipcMain.handle("get-language", () => {
    return store.get("language", "en");
});

ipcMain.handle("set-language", (event, language) => {
    store.set("language", language);
});

// file management

ipcMain.handle("closeCurrentFile", () => {
    void closeCurrentFile();
});

// Plugins
ipcMain.handle("plugins:list", async () => {
    const pluginsDir = join(app.getPath("userData"), "plugins");
    if (!fs.existsSync(pluginsDir)) return [];
    return fs
        .readdirSync(pluginsDir)
        .filter((file) => file.endsWith(".om.js"))
        .map((file) => join(pluginsDir, file));
});

ipcMain.handle("plugins:get", async (_, pluginPath) => {
    return fs.readFileSync(pluginPath, "utf-8");
});

ipcMain.handle("plugins:install", async (_, pluginUrl) => {
    const pluginsDir = join(app.getPath("userData"), "plugins");
    if (!fs.existsSync(pluginsDir)) {
        fs.mkdirSync(pluginsDir);
    }
    let response;

    try {
        response = await fetch(pluginUrl);
        if (!response.ok) {
            return false;
        }
    } catch (e) {
        console.error(e);
        return false;
    }

    const pluginCode = await response.text();
    const pluginName = pluginUrl.split("/").pop();
    const pluginPath = join(pluginsDir, pluginName);

    fs.writeFileSync(pluginPath, pluginCode, "utf-8");
    return true;
});

ipcMain.handle("plugins:uninstall", async (_, fileName) => {
    const pluginsDir = join(app.getPath("userData"), "plugins");
    if (!fs.existsSync(pluginsDir)) {
        fs.mkdirSync(pluginsDir);
    }

    try {
        fs.rmSync(join(pluginsDir, fileName));
        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
});

// Log handler - allows renderer to send logs to main process
ipcMain.handle(
    "log:print",
    (
        _,
        level: "log" | "info" | "warn" | "error",
        message: string,
        ...args: any[]
    ) => {
        const timestamp = new Date().toISOString();
        const prefix = `[Renderer ${timestamp}]`;

        switch (level) {
            case "log":
                console.log(prefix, message, ...args);
                break;
            case "info":
                console.info(prefix, message, ...args);
                break;
            case "warn":
                console.warn(prefix, message, ...args);
                break;
            case "error":
                console.error(prefix, message, ...args);
                break;
            default:
                console.log(prefix, message, ...args);
        }
    },
);

// Note: second-instance is already handled above with auth callback support

app.on("activate", () => {
    const allWindows = BrowserWindow.getAllWindows();
    if (allWindows.length) {
        allWindows[0].focus();
    } else {
        void createWindow();
    }
});

// New window example arg: new windows url
ipcMain.handle("open-win", (_, arg) => {
    const childWindow = new BrowserWindow({
        webPreferences: {
            preload,
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    if (process.env.VITE_DEV_SERVER_URL) {
        void childWindow.loadURL(`${url}#${arg}`);
    } else {
        void childWindow.loadFile(indexHtml, { hash: arg });
    }
});

/************************************** FILE SYSTEM INTERACTIONS **************************************/
/**
 * Creates a new database file at the specified path.
 *
 * @param filePath The path where the file should be created
 * @returns 200 for success, -1 for failure
 */
async function createFileAtPath(filePath: string) {
    console.log("createFileAtPath:", filePath);

    if (!filePath) return -1;

    if (!filePath.endsWith(".dots")) {
        filePath = `${filePath}.dots`;
    }

    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
    await setActiveDb(filePath, true);

    addRecentFile(filePath);

    return 200;
}

/**
 * Opens a new .dots file at path without reloading the window (for new-show wizard draft).
 */
async function openDatabaseAtPathWithoutReload(
    filePath: string,
    isNewFile: boolean,
): Promise<number> {
    if (!filePath || !win) return -1;
    if (!(await endWorkingCopy("switch"))) return -1;

    if (!filePath.endsWith(".dots")) {
        filePath = `${filePath}.dots`;
    }

    if (isNewFile && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }

    let db: ReturnType<typeof DatabaseServices.connect> | undefined;
    try {
        const resCode = DatabaseServices.setDbPath(filePath, isNewFile);
        if (resCode !== 200) {
            return resCode;
        }

        store.set("databasePath", filePath);
        win.setTitle("OpenMarch - " + filePath);

        db = DatabaseServices.connect();
        if (!db) {
            console.error("Error connecting to database");
            return -1;
        }

        const drizzleDb = getOrm(db);
        const migrator = new DrizzleMigrationService(drizzleDb, db);
        const migrationsFolder = join(
            app.getAppPath(),
            "electron",
            "database",
            "migrations",
        );

        db.prepare(`PRAGMA user_version = ${DB_USER_VERSION}`).run();
        await migrator.applyPendingMigrations(migrationsFolder);
        await DrizzleMigrationService.initializeDatabase(drizzleDb, db);

        return 200;
    } catch (error) {
        captureException(error);
        store.delete("databasePath");
        DatabaseServices.closeDatabase();
        console.error("Error opening database without reload:", error);
        return -1;
    } finally {
        db?.close();
    }
}

/**
 * Creates a draft .dots under userData/new-show-drafts for the new-show wizard.
 */
export async function createNewShowDraft(): Promise<{ path: string } | number> {
    const draftsDir = getNewShowDraftsDirectory();
    if (!fs.existsSync(draftsDir)) {
        fs.mkdirSync(draftsDir, { recursive: true });
    }

    const draftPath = join(draftsDir, `${randomUUID()}.dots`);
    const result = await openDatabaseAtPathWithoutReload(draftPath, true);
    if (result !== 200) {
        return -1;
    }

    currentNewShowDraftPath = draftPath;
    return { path: draftPath };
}

const sanitizeNewShowFilename = (name: string): string =>
    name.trim().replace(/[<>:"/\\|?*]/g, "_");

function resolveFinalizeTargetPath(
    projectName: string,
    targetPath: string,
): string {
    const trimmed = targetPath.trim();
    const normalizedPath = trimmed.replace(/\\/g, "/");
    const pathParts = normalizedPath.split("/");
    const sanitized = sanitizeNewShowFilename(projectName) || "Untitled";
    const lastPart = pathParts[pathParts.length - 1] || "";

    if (!lastPart.endsWith(".dots")) {
        pathParts[pathParts.length - 1] = `${sanitized}.dots`;
        return pathParts.join("/");
    }

    if (!lastPart.startsWith(sanitizeNewShowFilename(projectName))) {
        pathParts[pathParts.length - 1] = `${sanitized}.dots`;
        return pathParts.join("/");
    }

    return trimmed;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function moveFileWithRetry(source: string, dest: string): Promise<void> {
    const resolvedSource = resolve(source);
    const resolvedDest = resolve(dest);
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            fs.renameSync(resolvedSource, resolvedDest);
            return;
        } catch (err: unknown) {
            const code =
                err && typeof err === "object" && "code" in err
                    ? (err as NodeJS.ErrnoException).code
                    : undefined;

            if (code === "EXDEV") {
                fs.copyFileSync(resolvedSource, resolvedDest);
                fs.unlinkSync(resolvedSource);
                return;
            }

            if (code === "EBUSY" && attempt < maxAttempts - 1) {
                await sleep(25 * (attempt + 1));
                continue;
            }

            throw err;
        }
    }
}

async function unlinkFileWithRetry(filePath: string): Promise<void> {
    const resolvedPath = resolve(filePath);
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            fs.unlinkSync(resolvedPath);
            return;
        } catch (err: unknown) {
            const code =
                err && typeof err === "object" && "code" in err
                    ? (err as NodeJS.ErrnoException).code
                    : undefined;

            if (code === "EBUSY" && attempt < maxAttempts - 1) {
                await sleep(25 * (attempt + 1));
                continue;
            }

            throw err;
        }
    }
}

/**
 * Moves the draft file to the user's chosen path and reloads into the editor.
 */
export async function finalizeNewShowDraft(
    targetPath: string,
    projectName?: string,
): Promise<number> {
    if (!currentNewShowDraftPath || !win) return -1;

    const draftPath = resolve(currentNewShowDraftPath);
    const finalPath = resolve(
        projectName
            ? resolveFinalizeTargetPath(projectName, targetPath)
            : targetPath.endsWith(".dots")
              ? targetPath
              : `${targetPath}.dots`,
    );

    const finalDir = dirname(finalPath);
    if (!fs.existsSync(finalDir)) {
        fs.mkdirSync(finalDir, { recursive: true });
    }

    DatabaseServices.closePersistentConnection();

    let backupPath: string | null = null;
    if (fs.existsSync(finalPath)) {
        backupPath = join(
            finalDir,
            `.${basename(finalPath)}.bak-${randomUUID()}`,
        );
        try {
            await moveFileWithRetry(finalPath, backupPath);
        } catch (error) {
            console.error(
                "Failed to backup existing show before finalize:",
                error,
            );
            captureException(error);
            return -1;
        }
    }

    try {
        await moveFileWithRetry(draftPath, finalPath);
    } catch (error) {
        console.error("Failed to finalize new show draft:", error);
        if (backupPath && fs.existsSync(backupPath)) {
            try {
                await moveFileWithRetry(backupPath, finalPath);
            } catch (restoreError) {
                console.error(
                    "Failed to restore show backup after finalize failure:",
                    restoreError,
                );
                captureException(restoreError);
            }
        }
        captureException(error);
        return -1;
    }

    if (backupPath) {
        try {
            await unlinkFileWithRetry(backupPath);
        } catch {
            // best-effort cleanup
        }
    }

    currentNewShowDraftPath = null;

    await setActiveDb(finalPath, false);
    addRecentFile(finalPath);

    return 200;
}

/**
 * Deletes the draft file and clears the DB connection without reloading.
 */
export async function discardNewShowDraft(): Promise<number> {
    const draftPath = currentNewShowDraftPath
        ? resolve(currentNewShowDraftPath)
        : null;
    currentNewShowDraftPath = null;

    if (!draftPath) {
        return 200;
    }

    DatabaseServices.closeDatabase();

    const storedPath = store.get("databasePath") as string | undefined;
    if (storedPath === draftPath) {
        store.delete("databasePath");
    }

    if (fs.existsSync(draftPath)) {
        await unlinkFileWithRetry(draftPath);
    }

    return 200;
}

/**
 * Creates a new database file path to connect to.
 *
 * @returns 200 for success, -1 for failure
 */
/**
 * Opens the new-show dialog in the renderer (LaunchPage modal).
 * If a file is open, closes it and sets a flag so the dialog opens after reload.
 */
export async function requestNewShowFromMenu() {
    if (!win) return -1;

    const dbPath = DatabaseServices.getDbPath();
    if (dbPath && dbPath.length > 0) {
        store.set("pendingNewShowDialog", true);
        return closeCurrentFile();
    }

    win.webContents.send("new-show:open");
    return 200;
}

export async function newFile() {
    console.log("newFile");

    if (!win) return -1;

    let filePath: string | undefined;

    // In Playwright test mode, use the provided test file path instead of showing dialog
    if (
        process.env.PLAYWRIGHT_SESSION &&
        process.env.PLAYWRIGHT_NEW_FILE_PATH
    ) {
        console.log(
            "Using test file path:",
            process.env.PLAYWRIGHT_NEW_FILE_PATH,
        );
        filePath = process.env.PLAYWRIGHT_NEW_FILE_PATH;
    } else {
        const dialogResult = await dialog.showSaveDialog(win, {
            buttonLabel: "Create New",
            filters: [{ name: "OpenMarch File", extensions: ["dots"] }],
        });
        if (dialogResult.canceled || !dialogResult.filePath) return;
        filePath = dialogResult.filePath;
    }

    return createFileAtPath(filePath);
}

// Database (main file)

/**
 * Opens a dialog to create a new database file path to connect to with the data of the current database.
 * I.e. Save As..
 * OpenMarch automatically saves changes to the database, so this is not a save function.
 *
 * @returns 200 for success, 0 if cancelled, -1 for failure
 */
export async function saveFile() {
    console.log("saveFile");

    if (!win) return -1;

    try {
        const path = await dialog.showSaveDialog(win, {
            buttonLabel: "Save Copy",
            filters: [{ name: "OpenMarch File", extensions: ["dots"] }],
        });
        if (path.canceled || !path.filePath) return 0;
        const target = resolve(path.filePath);

        // A copy over the open show would replace the file under the open
        // connection. Its contents are already the show's, so there is nothing to do.
        if (target === resolve(DatabaseServices.getDbPath())) {
            const outcome = await workingCopy?.flush("save");
            return !outcome || outcome.ok ? 200 : -1;
        }

        await writeSnapshotTo(target);
        addRecentFile(target);
        return 200;
    } catch (err) {
        console.log(err);
        return -1;
    }
}

/**
 * Writes a consistent copy of the open show to `target`, replacing any file
 * there only once the copy is complete and on disk.
 */
async function writeSnapshotTo(target: string) {
    const tempPath = join(
        dirname(target),
        `.~${basename(target)}.${randomUUID().slice(0, 8)}.tmp`,
    );
    const db = DatabaseServices.connect();
    try {
        db.prepare("VACUUM INTO ?").run(tempPath);
    } catch (error) {
        await removeIfPresent(tempPath);
        throw error;
    } finally {
        db.close();
    }
    try {
        await replaceFileDurably(tempPath, target);
    } catch (error) {
        await removeIfPresent(tempPath);
        throw error;
    }
}

/**
 * Opens a dialog to load a database file path to connect to.
 *
 * @returns 200 for success, -1 for failure
 */
export async function loadDatabaseFile() {
    console.log("loadDatabaseFile");

    if (!win) return -1;

    // If there is no previous path, open a dialog
    dialog
        .showOpenDialog(win, {
            filters: [
                { name: "OpenMarch File", extensions: ["dots"] },
                { name: "All Files", extensions: ["*"] },
            ],
        })
        .then(async (path) => {
            if (path.canceled) return -1;

            store.set("databasePath", path.filePaths[0]); // Save the path for next time
            // Add to recent files
            addRecentFile(path.filePaths[0]);

            const resCode = await setActiveDb(path.filePaths[0]);

            // Handle alert dialogs in frontend
            win?.webContents.send("load-file-response", resCode);

            return resCode;
        })
        .catch((err) => {
            console.log(err);
            return -1;
        });
}

// Custom function to send request and wait for response
function requestSvgBeforeClose(win: BrowserWindow): Promise<string> {
    return new Promise((resolve, reject) => {
        const requestId = `get-svg-${Date.now()}`;
        const responseChannel = `get-svg-response-${requestId}`;

        const cleanup = (
            handler?: (event: Electron.IpcMainEvent, svg: string) => void,
        ) => {
            if (handler) {
                ipcMain.removeListener(responseChannel, handler);
            }
            clearTimeout(timeoutId);
        };

        const handler = (event: Electron.IpcMainEvent, svg: string) => {
            cleanup(handler);
            resolve(svg);
        };

        ipcMain.once(responseChannel, handler);

        win.webContents.send("get-svg-on-close", requestId);

        // Optional timeout to avoid hanging
        const timeoutId = setTimeout(() => {
            cleanup(handler);
            reject(new Error("Timeout waiting for SVG response"));
        }, 5000);
    });
}

/**
 * Closes the current database file.
 *
 * @returns 200 for success, -1 for failure
 */
export async function closeCurrentFile(isAppQuitting = false) {
    console.log("closeCurrentFile called. isAppQuitting:", isAppQuitting);
    // console.trace();

    if (!win) return -1;

    if (currentNewShowDraftPath) {
        await discardNewShowDraft();
        if (!isAppQuitting) {
            win.webContents.reload();
        }
        return 200;
    }

    try {
        const svgResult = await requestSvgBeforeClose(win);
        updateRecentFileSvgPreview(DatabaseServices.getDbPath(), svgResult);
    } catch (error) {
        console.error("Error getting SVG on close:", error);
    }

    // Save and release a working copy; the user may cancel if that fails.
    if (!(await endWorkingCopy(isAppQuitting ? "quit" : "close"))) return 0;

    // Close the current file
    DatabaseServices.closeDatabase();
    store.set("databasePath", "");

    // Only reload if we're NOT quitting the app
    if (!isAppQuitting) {
        win.webContents.reload();
    }

    return 200;
}

// Audio files

const AUDIO_FILE_DIALOG_FILTERS: Electron.FileFilter[] = [
    {
        name: "Audio File",
        extensions: ["mp3", "wav", "ogg", "m4a", "aac", "webm"],
    },
    { name: "All Files", extensions: ["*"] },
];

function audioInsertError(
    message: string,
): DatabaseServices.LegacyDatabaseResponse<AudioFile[]> {
    return { success: false, error: { message } };
}

async function pickAudioFilePath(): Promise<string | null> {
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
        filters: AUDIO_FILE_DIALOG_FILTERS,
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
}

async function readAudioFileBuffer(filePath: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, (err, data) => {
            if (err) reject(err);
            else resolve(data);
        });
    });
}

function bufferToArrayBuffer(data: Buffer): ArrayBuffer {
    return data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
}

/**
 * Opens a dialog to import an audio file to the database.
 *
 * @returns 200 for success, -1 for failure (TODO, this function's return value is always error)
 */
export async function insertAudioFile(): Promise<
    DatabaseServices.LegacyDatabaseResponse<AudioFile[]>
> {
    console.log("insertAudioFile");

    if (!win) return audioInsertError("insertAudioFile: window not loaded");

    if (!DatabaseServices.databaseIsReady()) {
        console.error("insertAudioFile: Database is not ready");
        return audioInsertError(
            "No file is open. Create or open a show first.",
        );
    }

    try {
        const filePath = await pickAudioFilePath();
        if (!filePath) {
            return audioInsertError(
                "insertAudioFile: Operation was cancelled or no audio file was provided",
            );
        }

        console.log("loading audio file into buffer:", filePath);
        const data = await readAudioFileBuffer(filePath);

        if (!DatabaseServices.databaseIsReady()) {
            console.error(
                "insertAudioFile: Database became unavailable during upload",
            );
            return audioInsertError(
                "Database became unavailable. Please try again after ensuring the database file is ready.",
            );
        }

        const databaseResponse = await DatabaseServices.insertAudioFile({
            data: bufferToArrayBuffer(data),
            path: filePath,
            nickname: basename(filePath),
            selected: true,
        });

        if (!databaseResponse.success) {
            console.error(
                "insertAudioFile: Failed to insert audio file:",
                databaseResponse.error,
            );
        } else {
            console.log(
                "insertAudioFile: Successfully inserted audio file with ID:",
                databaseResponse.result?.[0]?.id,
            );
        }

        return databaseResponse;
    } catch (err) {
        console.error("Error inserting audio file:", err);
        return audioInsertError(
            err instanceof Error ? err.message : String(err),
        );
    }
}

/**
 * Applies pending migrations to an open show connection, backing up the show
 * file first. A new file is initialized instead.
 */
async function prepareShowDatabase(
    db: ReturnType<typeof DatabaseServices.connect>,
    showPath: string,
    isNewFile: boolean,
) {
    const drizzleDb = getOrm(db);
    const migrator = new DrizzleMigrationService(drizzleDb, db);

    const migrationsFolder = join(
        app.getAppPath(),
        "electron",
        "database",
        "migrations",
    );

    // If this isn't a new file, create backups before applying migrations
    if (!isNewFile) {
        console.log("Checking database version to see if migration is needed");
        if (migrator.hasPendingMigrations(migrationsFolder)) {
            const backupDir = join(app.getPath("userData"), "backups");
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir);
            }
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const originalName = showPath.split(/[\\/]/).pop();
            const backupPath = join(
                backupDir,
                `backup_${timestamp}_${originalName}`,
            );
            console.log("Creating backup of database in " + backupPath);
            fs.copyFileSync(showPath, backupPath);

            console.log("Deleting backups older than 30 days");
            // Delete backups older than 30 days
            const files = fs.readdirSync(backupDir);
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            files.forEach((file) => {
                const filePath = join(backupDir, file);
                const stats = fs.statSync(filePath);
                if (stats.birthtime < thirtyDaysAgo) {
                    fs.unlinkSync(filePath);
                }
            });
        }
    } else {
        db.prepare(`PRAGMA user_version = ${DB_USER_VERSION}`).run();
    }
    await migrator.applyPendingMigrations(migrationsFolder);

    if (isNewFile) {
        await DrizzleMigrationService.initializeDatabase(drizzleDb, db);
    }
}

/**
 * Sets the active database path and reloads the window.
 *
 * @param path path to the database file
 * @param isNewFile True if this is a new file, false if it is an existing file
 * @param recover A crashed session's working copy to continue from
 */
async function setActiveDb(
    path: string,
    isNewFile = false,
    recover?: RecoverableWorkingCopy,
) {
    let openConnection: ReturnType<typeof DatabaseServices.connect> | null =
        null;
    try {
        // Get the current path from the store if the path is "."
        // I.e. last opened file
        if (path === ".") path = store.get("databasePath") as string;

        // Save and release the show that's open now.
        if (!(await endWorkingCopy("switch"))) return 409;

        if (
            recover ||
            (workingCopySavesEnabled() && !isNewShowDraftPath(path))
        ) {
            const resCode = await openWorkingCopy(path, isNewFile, recover);
            if (resCode !== 200) {
                store.delete("databasePath");
                console.error(
                    `Error loading database file [code=${resCode}] [path=${path}]`,
                );
                return resCode;
            }
            path = workingCopy!.showPath;
        } else {
            const resCode = DatabaseServices.setDbPath(path, isNewFile);

            if (resCode !== 200) {
                store.delete("databasePath");
                console.error(
                    `Error loading database file [code=${resCode}] [path=${path}]`,
                );
                return resCode;
            }

            const db = DatabaseServices.connect();
            if (!db) {
                console.error("Error connecting to database");
                return 500;
            }
            // The renderer opens its own connection after the reload below.
            openConnection = db;
            await prepareShowDatabase(db, path, isNewFile);
        }

        win?.setTitle("OpenMarch - " + path);
        if (process.platform === "darwin") win?.setRepresentedFilename(path);

        store.set("databasePath", path); // Save current db path
        win?.webContents.reload();

        return 200;
    } catch (error) {
        captureException(error);
        store.delete("databasePath"); // Reset database path
        DatabaseServices.closeDatabase();
        dialog.showErrorBox("Error Loading Database", (error as Error).message);
        win?.webContents.reload();
        throw error;
    } finally {
        openConnection?.close();
    }
}

/************************************** WORKING COPY **************************************/
// Saving through a private working copy (docs/adr/0001). Opt-in through the
// "workingCopySaves" setting, or OPENMARCH_WORKING_COPY=1 / =0 to force it.

const WORKING_COPY_SETTING = "workingCopySaves";

/** The working copy of the open show, when the show is edited through one. */
let workingCopy: WorkingCopySession | null = null;
/** Set while the open show is being saved and released. */
let endingWorkingCopy: Promise<boolean> | null = null;
/** Working copies with unsaved changes left by a crash. */
let recoverableWorkingCopies: RecoverableWorkingCopy[] = [];

function getWorkingCopyRoot(): string {
    return join(app.getPath("userData"), "working-copies");
}

function workingCopySavesEnabled(): boolean {
    const forced = process.env.OPENMARCH_WORKING_COPY;
    if (forced === "1") return true;
    if (forced === "0") return false;
    return store.get(WORKING_COPY_SETTING) === true;
}

function reportWorkingCopyStatus(status: WorkingCopyStatus) {
    if (!win || win.isDestroyed()) return;
    win.webContents.send("working-copy:status", status);
    if (process.platform === "darwin")
        win.setDocumentEdited(
            status.state !== "saved" && status.state !== "closed",
        );
}

/**
 * Checks that a show can be opened and later saved: it exists, is readable
 * and writable, and its folder accepts the temp file a save writes beside it.
 * Nothing is written to the show itself.
 */
function checkShowFileForWorkingCopy(showPath: string): number {
    if (!fs.existsSync(showPath)) return 404;
    try {
        fs.accessSync(showPath, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
        return 403;
    }
    // On macOS, access checks can pass for Documents or Downloads while
    // writes still fail without folder access.
    const probe = join(
        dirname(showPath),
        `.~${basename(showPath)}.${randomUUID().slice(0, 8)}.tmp`,
    );
    try {
        fs.writeFileSync(probe, "", { flag: "wx" });
        fs.unlinkSync(probe);
    } catch (error) {
        console.error("Can't write beside the show:", error);
        return 403;
    }
    return 200;
}

/** Opens `showPath` through a new working copy, or continues a crashed one. */
async function openWorkingCopy(
    showPath: string,
    isNewFile: boolean,
    recover?: RecoverableWorkingCopy,
): Promise<number> {
    if (isNewFile) {
        // A new show starts as a file at its final path, then opens like
        // any other show.
        const created = DatabaseServices.setDbPath(showPath, true);
        if (created !== 200) return created;
        const db = DatabaseServices.connect();
        try {
            await prepareShowDatabase(db, showPath, true);
        } finally {
            db.close();
            DatabaseServices.closeDatabase();
        }
    }

    if (!recover) {
        const resCode = checkShowFileForWorkingCopy(showPath);
        if (resCode !== 200) return resCode;
    }

    const prepare = async (db: ReturnType<typeof DatabaseServices.connect>) => {
        const { user_version } = db.prepare("PRAGMA user_version").get() as {
            user_version: number;
        };
        if (user_version === -1)
            throw new Error(
                "user_version is -1, meaning the database was not created successfully",
            );
        // Migrations change only the working copy. The show file keeps its
        // old format until the first save after an edit.
        await prepareShowDatabase(db, showPath, false);
    };
    const options = {
        workingRoot: getWorkingCopyRoot(),
        appVersion: app.getVersion(),
        onStatus: reportWorkingCopyStatus,
    };
    const session = recover
        ? await WorkingCopySession.resume(recover, options, prepare)
        : await WorkingCopySession.open(showPath, options, prepare);
    if (recover)
        recoverableWorkingCopies = recoverableWorkingCopies.filter(
            (entry) => entry.id !== recover.id,
        );

    workingCopy = session;
    DatabaseServices.connectToWorkingCopy({
        showPath: session.showPath,
        workingPath: session.workingPath,
        onActivity: () => session.noteActivity(),
    });
    console.log(
        `Editing ${session.showPath} through working copy ${session.workingPath}`,
    );
    return 200;
}

/** Saves the open show before an export reads it from disk or shares it. */
async function saveBeforeExport() {
    const outcome = await workingCopy?.flush("export");
    if (outcome && !outcome.ok)
        console.warn("Exporting without saving first:", outcome.message);
}

type UnsavedChoice = "retry" | "overwrite" | "saveCopy" | "keep" | "cancel";

/** Asks what to do when the last save before closing didn't happen. */
async function askAboutUnsavedChanges(
    session: WorkingCopySession,
    outcome: Extract<SaveOutcome, { ok: false }>,
): Promise<UnsavedChoice> {
    const name = basename(session.showPath);
    const choices: { label: string; choice: UnsavedChoice }[] =
        outcome.state === "conflict"
            ? [
                  { label: "Keep My Version", choice: "overwrite" },
                  { label: "Save My Version As…", choice: "saveCopy" },
              ]
            : outcome.state === "readOnly"
              ? [{ label: "Save As…", choice: "saveCopy" }]
              : [
                    { label: "Try Again", choice: "retry" },
                    { label: "Save As…", choice: "saveCopy" },
                ];
    choices.push(
        { label: "Close and Recover Later", choice: "keep" },
        { label: "Cancel", choice: "cancel" },
    );
    const options: Electron.MessageBoxOptions = {
        type: "warning",
        message: `Your latest changes to ${name} haven't been saved.`,
        detail: `${outcome.message}\n\nIf you close now, OpenMarch keeps your changes and offers to recover them the next time it starts.`,
        buttons: choices.map((choice) => choice.label),
        defaultId: 0,
        cancelId: choices.length - 1,
        noLink: true,
    };
    const { response } =
        win && !win.isDestroyed()
            ? await dialog.showMessageBox(win, options)
            : await dialog.showMessageBox(options);
    return choices[response]?.choice ?? "cancel";
}

/** Asks where to save the user's version of a show as a new file. */
async function chooseCopyPath(showPath: string): Promise<string | null> {
    const name = basename(showPath).replace(/\.dots$/i, "");
    const options: Electron.SaveDialogOptions = {
        buttonLabel: "Save",
        defaultPath: join(dirname(showPath), `${name} (my changes).dots`),
        filters: [{ name: "OpenMarch File", extensions: ["dots"] }],
    };
    const result = await showSaveDialogHandler(options);
    if (result.canceled || !result.filePath) return null;
    return result.filePath.endsWith(".dots")
        ? result.filePath
        : `${result.filePath}.dots`;
}

/** Makes `newShowPath` the open show's file and saves to it. */
async function saveWorkingCopyAs(
    session: WorkingCopySession,
    newShowPath: string,
): Promise<SaveOutcome> {
    const outcome = await session.retarget(newShowPath);
    DatabaseServices.setWorkingCopyShowPath(session.showPath);
    store.set("databasePath", session.showPath);
    addRecentFile(session.showPath);
    win?.setTitle("OpenMarch - " + session.showPath);
    if (process.platform === "darwin")
        win?.setRepresentedFilename(session.showPath);
    reportWorkingCopyStatus(session.status());
    return outcome;
}

/**
 * Saves the open show for the last time and releases its working copy.
 * When the save fails, asks the user; returns false if they cancel.
 * Concurrent calls share one run.
 */
function endWorkingCopy(reason: string): Promise<boolean> {
    if (!workingCopy) return Promise.resolve(true);
    endingWorkingCopy ??= (async () => {
        const session = workingCopy!;
        try {
            let outcome = await session.flush(reason);
            while (!outcome.ok && session.hasUnsavedChanges) {
                const choice = await askAboutUnsavedChanges(session, outcome);
                if (choice === "cancel") return false;
                if (choice === "keep") break;
                if (choice === "retry") outcome = await session.flush(reason);
                else if (choice === "overwrite")
                    outcome = await session.overwriteShow();
                else {
                    const target = await chooseCopyPath(session.showPath);
                    if (target)
                        outcome = await saveWorkingCopyAs(session, target);
                }
            }
            workingCopy = null;
            DatabaseServices.closeDatabase();
            const { keptForRecovery } = await session.close();
            if (keptForRecovery)
                recoverableWorkingCopies =
                    scanWorkingCopies(getWorkingCopyRoot());
            if (process.platform === "darwin" && win && !win.isDestroyed())
                win.setDocumentEdited(false);
            return true;
        } finally {
            endingWorkingCopy = null;
        }
    })();
    return endingWorkingCopy;
}

function describeRecoverable(entry: RecoverableWorkingCopy): RecoverableShow {
    return {
        id: entry.id,
        showPath: entry.manifest.showPath,
        showExists: fs.existsSync(entry.manifest.showPath),
        lastEditAt: entry.manifest.lastEditAt,
    };
}

function initWorkingCopyIpcHandlers() {
    ipcMain.handle(
        "working-copy:get-status",
        () => workingCopy?.status() ?? null,
    );
    ipcMain.handle(
        "working-copy:resolve-conflict",
        async (_, choice: WorkingCopyConflictChoice) => {
            const session = workingCopy;
            if (!session)
                return {
                    ok: false,
                    state: "closed",
                    message: "No show is open",
                };
            if (choice === "keepMine") return session.overwriteShow();
            if (choice === "keepTheirs") {
                // Drop the working copy and reopen the show as it is on disk.
                const showPath = session.showPath;
                workingCopy = null;
                DatabaseServices.closeDatabase();
                await session.close({ discard: true });
                await setActiveDb(showPath);
                return { ok: true };
            }
            const target = await chooseCopyPath(session.showPath);
            if (!target) return { ok: false, cancelled: true };
            return saveWorkingCopyAs(session, target);
        },
    );
    ipcMain.handle("working-copy:save-as", async () => {
        const session = workingCopy;
        if (!session)
            return { ok: false, state: "closed", message: "No show is open" };
        const target = await chooseCopyPath(session.showPath);
        if (!target) return { ok: false, cancelled: true };
        return saveWorkingCopyAs(session, target);
    });
    ipcMain.handle("working-copy:list-recoverable", () =>
        recoverableWorkingCopies.map(describeRecoverable),
    );
    ipcMain.handle("working-copy:recover", async (_, id: string) => {
        const entry = recoverableWorkingCopies.find((item) => item.id === id);
        if (!entry) return 404;
        const resCode = await setActiveDb(
            entry.manifest.showPath,
            false,
            entry,
        );
        if (resCode === 200) {
            addRecentFile(entry.manifest.showPath);
        }
        return resCode;
    });
    ipcMain.handle("working-copy:discard", (_, id: string) => {
        const entry = recoverableWorkingCopies.find((item) => item.id === id);
        if (!entry) return;
        discardWorkingCopy(entry);
        recoverableWorkingCopies = recoverableWorkingCopies.filter(
            (item) => item.id !== id,
        );
    });
}
