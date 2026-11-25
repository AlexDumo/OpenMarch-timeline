/**
 * "Custom uniforms (preview)", a per-computer choice in the 3D View settings' Preferences
 * (docs/3d/uniform-artwork.md, "Opt-in preview"; owner decision 2026-11-24). It shows the
 * custom-uniform controls: the template downloads, Import uniform…, Save uniform file, Logos
 * and numbers, Modes and the sample uniform. The uniform file format may still change, so it is
 * off by default in release builds and on in developer builds (dev servers and the fork's
 * examples and nightly Workers, `isDevBuild`) and lab builds.
 *
 * It never changes what a show draws: a show whose band wears a custom uniform draws it with the
 * setting off too, and the uniform picker says so (`UniformPicker`).
 *
 * Saved under {@link UNIFORM_ARTWORK_STORAGE_KEY}, the key of the hidden flag it replaces, as
 * "1" or "0", so a computer that set the flag to "1" finds the setting on. Other windows of the
 * app hear a change through the `storage` event.
 */
import { create } from "zustand";
import { isDevBuildFor } from "@/utilities/devBuild";
import { webChannel } from "@/utilities/webBuild";

/** Where the choice is saved: "1" on, "0" off, absent for the build's default. */
export const UNIFORM_ARTWORK_STORAGE_KEY = "view3d.uniformArtwork";

/** Set once the "uniform files may change" note has shown after an import or a save. */
export const UNIFORM_PREVIEW_WARNED_STORAGE_KEY = "view3d.uniformPreviewWarned";

/** On in developer and lab builds, off in releases (Electron and the stable and preview sites). */
export function customUniformsDefault(env: {
    dev: boolean;
    webChannel: string | undefined;
}): boolean {
    return isDevBuildFor(env) || env.webChannel === "lab";
}

const BUILD = { dev: import.meta.env.DEV, webChannel };

/** The saved choice, else the build's default (also when storage is blocked). */
export function loadCustomUniforms(
    storage?: Storage,
    env: { dev: boolean; webChannel: string | undefined } = BUILD,
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

/** Whether the once-only "uniform files may change" note has shown on this computer. */
export function previewWarningShown(storage?: Storage): boolean {
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
    try {
        (storage ?? window.localStorage).setItem(
            UNIFORM_PREVIEW_WARNED_STORAGE_KEY,
            "1",
        );
    } catch {
        // Blocked storage: the note may show once more next session.
    }
}
