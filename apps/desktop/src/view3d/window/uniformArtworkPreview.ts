/**
 * "Custom uniforms (preview)", a per-computer choice in the 3D View settings' Preferences
 * (docs/3d/uniform-artwork.md, "Opt-in preview"; owner decision 2026-11-24). It shows the
 * custom-uniform controls: the template downloads, Import uniform…, Save uniform file, Logos
 * and numbers, Modes and the sample uniform. The uniform file format may still change, so it is
 * off by default in release builds and on in dev servers and the dev, examples and lab web builds
 * ({@link customUniformsDefault}).
 *
 * It never changes what a show draws: a show whose band wears a custom uniform draws it with the
 * setting off too, and the uniform picker says so (`UniformPicker`).
 *
 * Saved under {@link UNIFORM_ARTWORK_STORAGE_KEY}, the key of the hidden flag it replaces, as
 * "1" or "0", so a computer that set the flag to "1" finds the setting on. Other windows of the
 * app hear a change through the `storage` event.
 */
import { create } from "zustand";
import { webChannel } from "@/utilities/webBuild";

/** Where the choice is saved: "1" on, "0" off, absent for the build's default. */
export const UNIFORM_ARTWORK_STORAGE_KEY = "view3d.uniformArtwork";

/** Set once the "uniform files may change" note has shown after an import or a save. */
export const UNIFORM_PREVIEW_WARNED_STORAGE_KEY = "view3d.uniformPreviewWarned";

/** The build a default is for: a dev server, and the web build's channel (undefined in Electron) */
export interface CustomUniformsBuild {
    dev: boolean;
    webChannel: string | undefined;
    /** False when the web build's `WEB_CHANNEL` wasn't set and fell back to "dev" */
    channelNamed?: boolean;
}

/** Web channels whose builds start with the setting on: local, the fork's examples, lab tests */
const PREVIEW_ON_CHANNELS = new Set(["dev", "examples", "lab"]);

/**
 * On in a dev server and in the web builds named "dev", "examples" (the fork's preview) or "lab";
 * off in releases: packaged Electron, the stable, nightly (public once upstream) and preview
 * sites. A production web build whose `WEB_CHANNEL` wasn't set (it reads as "dev") is off too, so
 * a deploy that forgot its channel doesn't turn the preview on for its users.
 */
export function customUniformsDefault(env: CustomUniformsBuild): boolean {
    if (env.dev) return true;
    if (env.webChannel === undefined) return false;
    if (env.webChannel === "dev" && env.channelNamed === false) return false;
    return PREVIEW_ON_CHANNELS.has(env.webChannel);
}

const BUILD: CustomUniformsBuild = {
    dev: import.meta.env.DEV,
    webChannel,
    channelNamed: import.meta.env.VITE_PUBLIC_WEB_CHANNEL_NAMED !== "false",
};

/** The saved choice, else the build's default (also when storage is blocked). */
export function loadCustomUniforms(
    storage?: Storage,
    env: CustomUniformsBuild = BUILD,
): boolean {
    const fallback = customUniformsDefault(env);
    try {
        const saved = (storage ?? window.localStorage).getItem(
            UNIFORM_ARTWORK_STORAGE_KEY,
        );
        return saved === "1" ? true : saved === "0" ? false : fallback;
    } catch {
        return fallback;
    }
}

interface CustomUniformsState {
    enabled: boolean;
    setEnabled: (on: boolean) => void;
}

export const useCustomUniformsStore = create<CustomUniformsState>((set) => ({
    enabled: loadCustomUniforms(),
    setEnabled: (enabled) => {
        try {
            window.localStorage.setItem(
                UNIFORM_ARTWORK_STORAGE_KEY,
                enabled ? "1" : "0",
            );
        } catch {
            // Private or blocked storage: the choice lasts for this session only.
        }
        set({ enabled });
    },
}));

// another window of the app changed it
if (typeof window !== "undefined")
    window.addEventListener("storage", (event) => {
        if (event.key === UNIFORM_ARTWORK_STORAGE_KEY || event.key === null)
            useCustomUniformsStore.setState({ enabled: loadCustomUniforms() });
    });

/** Whether the custom-uniform controls show; re-renders when the setting changes. */
export function useCustomUniforms(): boolean {
    return useCustomUniformsStore((s) => s.enabled);
}

/**
 * Set when the note shows, so it shows once per session even where storage is blocked (a
 * private window): the saved flag makes it once per computer.
 */
let warnedThisSession = false;

/** For tests: forget that the note showed this session. */
export function _resetPreviewWarning() {
    warnedThisSession = false;
}

/** Whether the once-only "uniform files may change" note has shown on this computer. */
export function previewWarningShown(storage?: Storage): boolean {
    if (warnedThisSession) return true;
    try {
        return (
            (storage ?? window.localStorage).getItem(
                UNIFORM_PREVIEW_WARNED_STORAGE_KEY,
            ) === "1"
        );
    } catch {
        return false;
    }
}

/** Records that the note has shown, so it doesn't show again. */
export function markPreviewWarningShown(storage?: Storage) {
    warnedThisSession = true;
    try {
        (storage ?? window.localStorage).setItem(
            UNIFORM_PREVIEW_WARNED_STORAGE_KEY,
            "1",
        );
    } catch {
        // Blocked storage: the note may show once more next session.
    }
}
