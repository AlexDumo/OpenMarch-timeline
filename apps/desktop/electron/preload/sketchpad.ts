/**
 * Preload for the Sketchpad window (ADR 0006 D-4). It runs sandboxed, so it may import only
 * `electron`, and it exposes only `window.sketchpad`. Channel names are hard-coded, like the
 * other preloads; main checks the sender and validates every payload.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
// Types only: a value import would be split into a chunk shared with the editor's preload,
// which a sandboxed preload can't `require`.
import type {
    FieldPropertiesJson,
    SketchDoc,
    SketchExternalChange,
    SketchFilePayload,
    SketchListItem,
    SketchOpenRequest,
    SketchSavePayload,
    SketchTemplate,
    SketchTemplateListItem,
    TemplateDestinationId,
} from "../../src/sketchpad/protocol";

/** Listens on a main → window channel; returns a function that removes the listener */
function listen<T>(channel: string, callback: (payload: T) => void) {
    const listener = (_event: IpcRendererEvent, payload: T) =>
        callback(payload);
    ipcRenderer.on(channel, listener);
    return () => {
        ipcRenderer.removeListener(channel, listener);
    };
}

const SKETCHPAD_API = {
    isMacOS: process.platform === "darwin",

    /** The show's sketches, for the Open menu */
    list: () => ipcRenderer.invoke("sketch:list") as Promise<SketchListItem[]>,
    load: (id: string) =>
        ipcRenderer.invoke("sketch:load", id) as Promise<SketchDoc>,
    save: (payload: SketchSavePayload) =>
        ipcRenderer.invoke("sketch:save", payload) as Promise<void>,
    remove: (id: string) =>
        ipcRenderer.invoke("sketch:remove", id) as Promise<unknown>,
    getFile: (sha256: string) =>
        ipcRenderer.invoke(
            "sketch:get-file",
            sha256,
        ) as Promise<SketchFilePayload | null>,
    /** Stores an image; resolves with its sha256, which main computes */
    putFile: (file: SketchFilePayload) =>
        ipcRenderer.invoke("sketch:put-file", file) as Promise<string>,

    templates: {
        list: () =>
            ipcRenderer.invoke("sketch:templates") as Promise<
                SketchTemplateListItem[]
            >,
        load: (id: string, destination: TemplateDestinationId) =>
            ipcRenderer.invoke("sketch:template-load", {
                id,
                destination,
            }) as Promise<SketchTemplate>,
        /** Saves a new template, or an edited one back in place; `thumbnail` is a small PNG */
        save: (
            template: SketchTemplate,
            destination: TemplateDestinationId,
            thumbnail?: Uint8Array | null,
        ) =>
            ipcRenderer.invoke("sketch:template-save", {
                template,
                destination,
                thumbnail,
            }) as Promise<void>,
        remove: (id: string, destination: TemplateDestinationId) =>
            ipcRenderer.invoke("sketch:template-remove", {
                id,
                destination,
            }) as Promise<unknown>,
    },

    /** The show's current field, which new sketches copy */
    field: () =>
        ipcRenderer.invoke("sketch:field") as Promise<FieldPropertiesJson>,

    /**
     * Says the window is listening, and resolves with what the editor asked it to open before
     * then. Subscribe with `onOpenRequest` first.
     */
    ready: () =>
        ipcRenderer.invoke("sketch:window-ready") as Promise<
            SketchOpenRequest[]
        >,
    /** The editor asks to open a sketch, a new sketch or one from a template */
    onOpenRequest: (callback: (request: SketchOpenRequest) => void) =>
        listen("sketch:open-request", callback),
    /** Main asks for a save before the window or the show closes; answer with `flushed` */
    onFlushRequest: (callback: (token: number) => void) =>
        listen("sketch:flush-request", callback),
    flushed: (token: number) => ipcRenderer.send("sketch:flushed", token),
    /** The editor renamed or deleted a sketch, which may be open in a tab */
    onExternalChange: (callback: (change: SketchExternalChange) => void) =>
        listen("sketch:external-change", callback),
};

contextBridge.exposeInMainWorld("sketchpad", SKETCHPAD_API);

export type SketchpadApi = typeof SKETCHPAD_API;
