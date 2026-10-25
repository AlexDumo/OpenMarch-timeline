/* eslint-disable no-console */
/**
 * The Sketchpad window (ADR 0006 D-4): at most one, with a tab per open sketch (owner decision
 * Q2), opened from the editor and closed with the editor or the show. It loads the editor's
 * renderer bundle with `?view=sketchpad` and gets its own preload (`preload/sketchpad.ts`), like
 * the 3D View (ADR 0002 D-3).
 *
 * Unlike the 3D View, the window writes: sketches are outside the show's undo history, so its
 * saves come straight to main on the fixed `sketch:*` channels. Each handler checks its sender
 * and validates its payload (`sketchpadHandlers.ts`). After a write, main sends `sketch:changed`
 * to the editor, which refreshes its sidebar.
 *
 * Closing the window, or the show, first asks the window to save and waits up to 2 s for it.
 */
import { BrowserWindow, ipcMain, shell } from "electron";
import * as DatabaseServices from "../database/database.services";
import { pruneSketchFiles } from "../database/sketches";
import type { LibraryStore } from "./library/store";
import { createSketchHandlers } from "./sketchpadHandlers";
import { showNameFromPath } from "./view3dWindow";
import {
    SKETCH_CHANGED_CHANNEL,
    SKETCH_CHANNELS,
    SKETCH_EXTERNAL_CHANGE_CHANNEL,
    SKETCH_FLUSH_REQUEST_CHANNEL,
    SKETCH_FLUSH_TIMEOUT_MS,
    SKETCH_FLUSHED_CHANNEL,
    SKETCH_OPEN_REQUEST_CHANNEL,
    sketchOpenRequestSchema,
    type SketchExternalChange,
    type SketchOpenRequest,
} from "../../src/sketchpad/protocol";

/** Window → main, `invoke`: the window is listening; returns the requests that came before */
export const SKETCH_WINDOW_READY_CHANNEL = "sketch:window-ready";

export interface SketchpadWindowConfig {
    /** Absolute path of the built `preload/sketchpad.js`. */
    preload: string;
    /** Vite dev server URL in development, otherwise undefined. */
    devServerUrl?: string;
    /** Absolute path of the built renderer `index.html`. */
    indexHtml: string;
    icon: string;
    /** Show a native frame (Playwright codegen), like the editor window. */
    frame: boolean;
    getTheme: () => string;
    getLanguage: () => string;
    /** The editor window, which lists, renames and deletes sketches from its sidebar. */
    getEditorWindow: () => BrowserWindow | null;
    /** The Library, for templates saved to "My Library" (ADR 0006 D-6). */
    getLibraryStore: () => Promise<LibraryStore>;
}

/** Height of the app's TitleBar, so native window controls line up with it. */
const TITLE_BAR_HEIGHT = 37;

const TITLE_BAR_COLORS = {
    dark: { color: "#0f0e13", symbolColor: "#d0d0d0" },
    light: { color: "#ecebf0", symbolColor: "#202020" },
} as const;

let config: SketchpadWindowConfig | null = null;
let sketchpadWindow: BrowserWindow | null = null;
/** The window's renderer asked for its requests, so new ones can be sent */
let windowReady = false;
/** Open requests that came before the window was listening */
let pendingRequests: SketchOpenRequest[] = [];
let lastFlushToken = 0;
const flushWaiters = new Map<number, () => void>();

function liveWindow(): BrowserWindow | null {
    return sketchpadWindow && !sketchpadWindow.isDestroyed()
        ? sketchpadWindow
        : null;
}

function isSketchpadSender(sender: Electron.WebContents): boolean {
    return sender === liveWindow()?.webContents;
}

function getEditorWebContents(): Electron.WebContents | null {
    const editor = config?.getEditorWindow();
    return editor && !editor.isDestroyed() ? editor.webContents : null;
}

function isEditorSender(sender: Electron.WebContents): boolean {
    return sender === getEditorWebContents();
}

function sendToWindow(channel: string, payload: unknown) {
    liveWindow()?.webContents.send(channel, payload);
}

type Who = "window" | "editor" | "both";

/** Registers a `sketch:*` handler that only the given sender may call. */
function handle<R>(
    channel: string,
    who: Who,
    fn: (payload: unknown, from: "window" | "editor") => R,
) {
    ipcMain.handle(channel, (event, payload: unknown) => {
        const fromWindow = isSketchpadSender(event.sender);
        const fromEditor = isEditorSender(event.sender);
        const allowed =
            who === "both"
                ? fromWindow || fromEditor
                : who === "window"
                  ? fromWindow
                  : fromEditor;
        if (!allowed)
            throw new Error(
                `${channel} is only available to the ${who === "both" ? "editor and the Sketchpad" : who === "window" ? "Sketchpad window" : "editor"}`,
            );
        return fn(payload, fromWindow ? "window" : "editor");
    });
}

/** Registers the Sketchpad IPC handlers. Call once, after `app` is ready. */
// eslint-disable-next-line max-lines-per-function -- one registration per channel
export function initSketchpadWindow(windowConfig: SketchpadWindowConfig) {
    config = windowConfig;
    const handlers = createSketchHandlers({
        getDb: DatabaseServices.getConnectionOutsideTransaction,
        getLibraryStore: windowConfig.getLibraryStore,
        onChanged: (id) =>
            getEditorWebContents()?.send(SKETCH_CHANGED_CHANNEL, id),
    });
    const C = SKETCH_CHANNELS;

    handle(C.list, "both", () => handlers.list());
    handle(C.load, "window", (p) => handlers.load(p));
    handle(C.save, "window", (p) => handlers.save(p));
    handle(C.remove, "both", async (p, from) => {
        const removed = await handlers.remove(p);
        if (removed && from === "editor")
            sendToWindow(SKETCH_EXTERNAL_CHANGE_CHANNEL, {
                id: removed.sketch.id,
                change: "removed",
            } satisfies SketchExternalChange);
        return removed;
    });
    handle(C.restore, "editor", (p) => handlers.restore(p));
    handle(C.rename, "editor", async (p) => {
        const renamed = await handlers.rename(p);
        const { id, name } = p as { id: string; name: string };
        if (renamed)
            sendToWindow(SKETCH_EXTERNAL_CHANGE_CHANNEL, {
                id,
                change: "renamed",
                name: name.trim(),
            } satisfies SketchExternalChange);
        return renamed;
    });
    handle(C.duplicate, "editor", (p) => handlers.duplicate(p));
    handle(C.getFile, "window", (p) => handlers.getFile(p));
    handle(C.putFile, "window", (p) => handlers.putFile(p));
    handle(C.templates, "both", () => handlers.listTemplates());
    handle(C.templateLoad, "window", (p) => handlers.loadTemplate(p));
    handle(C.templateSave, "window", (p) => handlers.saveTemplate(p));
    handle(C.templateRemove, "both", async (p, from) => {
        const removed = await handlers.removeTemplate(p);
        if (removed && from === "editor")
            sendToWindow(SKETCH_EXTERNAL_CHANGE_CHANNEL, {
                id:
                    removed.destination === "show"
                        ? removed.removed.sketch.id
                        : removed.entry.id,
                change: "removed",
            } satisfies SketchExternalChange);
        return removed;
    });
    handle(C.templateRestore, "editor", (p) => handlers.restoreTemplate(p));
    handle(C.templateRename, "editor", async (p) => {
        const renamed = await handlers.renameTemplate(p);
        const { id, name } = p as { id: string; name: string };
        if (renamed)
            sendToWindow(SKETCH_EXTERNAL_CHANGE_CHANNEL, {
                id,
                change: "renamed",
                name: name.trim(),
            } satisfies SketchExternalChange);
        return renamed;
    });
    handle(C.templateDuplicate, "editor", (p) => handlers.duplicateTemplate(p));
    handle(C.templateCopy, "editor", (p) => handlers.copyTemplate(p));
    handle(C.field, "window", async () => {
        const db = await DatabaseServices.getConnectionOutsideTransaction();
        const row = db
            .prepare("SELECT json_data FROM field_properties WHERE id = 1")
            .get() as { json_data: string } | undefined;
        if (!row) throw new Error("The show has no field");
        return JSON.parse(row.json_data) as unknown;
    });
    handle(C.open, "editor", (p) => {
        const request = sketchOpenRequestSchema.parse(p);
        return openSketchpadWindow(
            request.kind === "window" ? undefined : request,
        );
    });

    handle(SKETCH_WINDOW_READY_CHANNEL, "window", () => {
        windowReady = true;
        return pendingRequests.splice(0);
    });
    ipcMain.on(SKETCH_FLUSHED_CHANNEL, (event, token: unknown) => {
        if (!isSketchpadSender(event.sender) || typeof token !== "number")
            return;
        flushWaiters.get(token)?.();
    });
}

function buildQuery(): Record<string, string> {
    const theme = config?.getTheme() === "light" ? "light" : "dark";
    return {
        view: "sketchpad",
        show: showNameFromPath(DatabaseServices.getDbPath()),
        theme,
        lang: config?.getLanguage() || "en",
    };
}

/**
 * Asks the window to save every open sketch, and resolves when it has, or after 2 s
 * (ADR 0006 D-4). Resolves at once when no window is open.
 */
export function flushSketchpadWindow(): Promise<void> {
    const window = liveWindow();
    if (!window || !windowReady) return Promise.resolve();
    const token = ++lastFlushToken;
    return new Promise<void>((resolve) => {
        const done = () => {
            clearTimeout(timer);
            flushWaiters.delete(token);
            resolve();
        };
        const timer = setTimeout(() => {
            console.warn("The Sketchpad didn't finish saving within 2 s");
            done();
        }, SKETCH_FLUSH_TIMEOUT_MS);
        flushWaiters.set(token, done);
        window.webContents.send(SKETCH_FLUSH_REQUEST_CHANNEL, token);
    });
}

/**
 * Opens the Sketchpad window, or focuses it, and passes it `request`: a sketch to open or focus
 * in its tab, or a new sketch.
 *
 * @returns false when no show is open.
 */
export function openSketchpadWindow(request?: SketchOpenRequest): boolean {
    if (!config || !DatabaseServices.databaseIsReady()) return false;

    const existing = liveWindow();
    if (existing) {
        if (request) {
            if (windowReady)
                existing.webContents.send(SKETCH_OPEN_REQUEST_CHANNEL, request);
            else pendingRequests.push(request);
        }
        if (existing.isMinimized()) existing.restore();
        existing.show();
        existing.focus();
        return true;
    }

    windowReady = false;
    pendingRequests = request ? [request] : [];
    const query = buildQuery();
    const isMacOS = process.platform === "darwin";
    const colors = TITLE_BAR_COLORS[query.theme === "light" ? "light" : "dark"];

    const created = new BrowserWindow({
        title: `Sketchpad — ${query.show}`,
        icon: config.icon,
        width: 1360,
        height: 860,
        minWidth: 720,
        minHeight: 480,
        backgroundColor: colors.color,
        autoHideMenuBar: true,
        frame: config.frame,
        titleBarStyle: "hidden",
        trafficLightPosition: { x: 24, y: 9 },
        // Frameless like the editor and the 3D View: the app's TitleBar is the drag region, and
        // the system draws the window controls on Windows and Linux.
        titleBarOverlay: isMacOS
            ? undefined
            : { ...colors, height: TITLE_BAR_HEIGHT },
        webPreferences: {
            preload: config.preload,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: true,
        },
    });
    sketchpadWindow = created;

    // Save before closing (ADR 0006 D-4): the first close waits for the window's last save.
    let saved = false;
    created.on("close", (event) => {
        if (saved) return;
        event.preventDefault();
        void flushSketchpadWindow().finally(() => {
            saved = true;
            if (!created.isDestroyed()) created.destroy();
        });
    });
    created.on("closed", () => {
        if (sketchpadWindow === created) {
            sketchpadWindow = null;
            windowReady = false;
            pendingRequests = [];
        }
    });

    // Keep the window on the bundled renderer: no navigation, no popups.
    created.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("https:")) void shell.openExternal(url);
        return { action: "deny" };
    });
    created.webContents.on("will-navigate", (event) => event.preventDefault());

    if (config.devServerUrl) {
        const url = new URL(config.devServerUrl);
        for (const [key, value] of Object.entries(query)) {
            url.searchParams.set(key, value);
        }
        void created.loadURL(url.toString());
    } else {
        void created.loadFile(config.indexHtml, { query });
    }

    console.log("Sketchpad window opened");
    return true;
}

/**
 * Closes the Sketchpad window after its last save (up to 2 s). Called when the show or the
 * editor closes, before the show's database closes.
 */
export async function closeSketchpadWindow(): Promise<void> {
    const window = liveWindow();
    if (!window) return;
    await flushSketchpadWindow();
    if (!window.isDestroyed()) window.destroy();
    if (sketchpadWindow === window) sketchpadWindow = null;
    windowReady = false;
    pendingRequests = [];
}

/** Deletes images no sketch refers to any more (ADR 0006 D-5). Called as the show closes. */
export async function pruneSketchFilesOnClose(): Promise<void> {
    if (!DatabaseServices.databaseIsReady()) return;
    try {
        const removed = pruneSketchFiles(
            await DatabaseServices.getConnectionOutsideTransaction(),
        );
        if (removed > 0) console.log(`Pruned ${removed} unused sketch images`);
    } catch (error) {
        // An older file without the sketch tables, or a show that's busy: try next time
        console.warn("Couldn't prune sketch images", error);
    }
}

/** The open Sketchpad window, if any. */
export function getSketchpadWindow(): BrowserWindow | null {
    return liveWindow();
}
