/**
 * Messages between the page (the renderer) and the worker that stands in for
 * Electron's main process. Values are copied by `postMessage`, as Electron's
 * IPC copies them.
 */

/** Page to worker. */
export type ToWorker =
    | { type: "invoke"; id: number; channel: string; args: unknown[] }
    | { type: "send"; channel: string; args: unknown[] }
    /** The page's answer to an `ask` */
    | { type: "answer"; id: number; ok: true; value: unknown }
    | { type: "answer"; id: number; ok: false; error: string };

/** Worker to page. */
export type FromWorker =
    | { type: "ready"; status: WorkerStatus }
    | { type: "fatal"; message: string }
    | {
          type: "result";
          id: number;
          ok: true;
          value: unknown;
      }
    | { type: "result"; id: number; ok: false; error: string }
    | { type: "emit"; channel: string; args: unknown[] }
    /** Something only the page can do, such as drawing an SVG (`PAGE_CHANNELS`) */
    | { type: "ask"; id: number; channel: string; args: unknown[] };

export type WorkerStatus = {
    /**
     * Where the show is kept. "opfs": a copy in the browser's storage, so it
     * survives a reload. "memory": only for this page, because the browser
     * has no usable storage (e.g. a private window) or another tab holds it.
     */
    storage: "opfs" | "memory";
    /** Why storage is "memory", for the person. */
    storageProblem?: "other-tab" | "unsupported";
};

/**
 * Channels only the web build has, handled by the worker. The renderer's
 * stand-ins for Electron's file dialogs use them.
 */
export const WEB_CHANNELS = {
    /** (bytes: Uint8Array, name: string) => number (200, or an error code) */
    openShow: "web:openShow",
    /** () => void */
    closeShow: "web:closeShow",
    /** () => { name: string; bytes: Uint8Array } | null */
    exportShow: "web:exportShow",
    /** () => void: copy the show to browser storage now, e.g. as the page is hidden */
    flush: "web:flush",
    /** (bytes: Uint8Array) => PreviousDotsImportResult, for the new-show wizard */
    readPreviousDots: "web:readPreviousDots",
    /** (data: ArrayBuffer, name: string) => LegacyDatabaseResponse */
    insertAudio: "web:insertAudio",
    /**
     * () => string | null: the name of a show kept from an earlier visit that
     * couldn't be reopened (e.g. saved by a newer build), which creating or
     * opening a show replaces.
     */
    keptShow: "web:keptShow",
} as const;

/** Channels the worker asks the page, which has the DOM the worker lacks. */
export const PAGE_CHANNELS = {
    /**
     * (bytes: Uint8Array, format: "svg" | "pdf", long: number) => RasterizedImage: an SVG, or
     * a PDF's first page, drawn as a PNG `long` pixels on its long edge. For a field image
     * that becomes the show's floor (ADR 0002 D-23).
     */
    rasterizeImage: "web:rasterizeImage",
} as const;

export interface RasterizedImage {
    png: Uint8Array;
    width: number;
    height: number;
    /** Pages in a PDF; 1 for an SVG */
    pageCount: number;
}

/** Messages the worker sends the page unasked, like `webContents.send`. */
export const WEB_EVENTS = {
    /** The show has changes its last download doesn't. */
    changed: "web:changed",
    /**
     * Browser storage failed (e.g. it's full), so the worker stopped keeping
     * the show there: the page treats it as kept in memory only.
     */
    storageLost: "web:storageLost",
} as const;
