/**
 * Whether the 3D View offers uniform artwork drawn as flats
 * (docs/3d/uniform-artwork.md), still a preview: in dev builds, the fork's
 * preview and lab web builds, or when the {@link UNIFORM_ARTWORK_STORAGE_KEY}
 * setting is "1". Elsewhere the band picker leaves the sample out, and a show
 * that picked it wears its preset.
 */
import { webChannel } from "@/utilities/webBuild";

/** The setting that offers uniform artwork outside preview builds: "1" is on. */
export const UNIFORM_ARTWORK_STORAGE_KEY = "view3d.uniformArtwork";

export function uniformArtworkAvailable(): boolean {
    if (
        import.meta.env.DEV ||
        webChannel === "examples" ||
        webChannel === "lab"
    )
        return true;
    try {
        return localStorage.getItem(UNIFORM_ARTWORK_STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}
