/**
 * FORK-ONLY (see ../LAB.md): never merge into OpenMarch's `main`.
 *
 * A lab test build opens straight into its show, so a tester lands in the
 * editor rather than on the start page: it skips the welcome flow (the
 * editor mode is the test's, the language and theme the defaults) and opens
 * the example show the test names (`VITE_PUBLIC_LAB_SHOW`, from the
 * manifest's `show`), unless a show is already open, kept from before a
 * reload. Closing the show reloads the page, which opens a fresh copy.
 */
import { WEB_CHANNEL } from "./channel";
import { invokeWorker, ipcRenderer } from "./ipc";
import { WEB_CHANNELS } from "../protocol";
import { webExampleShows } from "../../src/utilities/webBuild";
import { EDITOR_MODE_SETTING } from "../../src/stores/EditorModeStore";

export const isLabBuild = WEB_CHANNEL === "lab";

/** The welcome flow opens while no editor mode is stored; stores the test's. */
async function skipWelcomeFlow() {
    if (await ipcRenderer.invoke("settings:get", EDITOR_MODE_SETTING)) return;
    ipcRenderer.send("settings:set", {
        [EDITOR_MODE_SETTING]: import.meta.env.VITE_PUBLIC_LAB_MODE || "expert",
    });
}

/**
 * Whether the start page should show instead: New show closes the show and
 * asks the start page for its dialog (src/utilities/openNewShowDialog.ts).
 */
function newShowRequested() {
    try {
        return sessionStorage.getItem("openmarch:openNewShowDialog") === "1";
    } catch {
        return false;
    }
}

/** Call once the worker has started and reopened any show from before. */
export async function startLabBuild() {
    await skipWelcomeFlow();
    if (newShowRequested()) return;
    if (await invokeWorker<boolean>("database:isReady")) return;
    // A kept show this build couldn't reopen: the start page asks before
    // anything replaces it.
    if (await invokeWorker<string | null>(WEB_CHANNELS.keptShow)) return;
    const show =
        webExampleShows.find(
            (example) => example.id === import.meta.env.VITE_PUBLIC_LAB_SHOW,
        ) ?? webExampleShows[0];
    if (!show) return;
    try {
        const response = await fetch(show.file);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const status = await invokeWorker<number>(
            WEB_CHANNELS.openShow,
            new Uint8Array(await response.arrayBuffer()),
            show.file.split("/").pop() ?? `${show.id}.dots`,
        );
        if (status !== 200) throw new Error(`status ${status}`);
    } catch (error) {
        // The start page offers the example shows instead.
        console.error(`Couldn't open ${show.name}:`, error);
    }
}

/**
 * Keeps the lab's feedback widget out of the 3D View window, which loads the
 * same page as the editor. The widget mounts on an element with this id and
 * skips mounting when one is already there; it runs after this module (both
 * are deferred, and this one comes first), so claiming the id is enough. The
 * style hides it should it get in first anyway.
 */
export function keepLabWidgetOut() {
    if (!isLabBuild) return;
    const placeholder = document.createElement("div");
    placeholder.id = "om-lab-widget";
    placeholder.hidden = true;
    const style = document.createElement("style");
    style.textContent = "#om-lab-widget { display: none !important; }";
    document.head.append(style);
    document.body.append(placeholder);
}
