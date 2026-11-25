/**
 * Stands in for `@/hooks/queries/useUniformPack` on the tool page (vite.config.mts): the atlas
 * composer (`flatsAtlas.ts`) reads a worn pack's bytes through `readStoredUniformPackBytes`, which
 * in the app reads the show database. Here the page puts the pack it renders in place first.
 *
 * Typed as the real export (the type checker resolves `@/` to the app, the tool page's Vite to
 * this file), so a change to the app's signature fails the type check.
 */
import type * as App from "@/hooks/queries/useUniformPack";

const packs = new Map<string, { name: string; bytes: Uint8Array }>();

export function putPack(value: string, name: string, bytes: Uint8Array) {
    packs.set(value, { name, bytes });
}

export const readStoredUniformPackBytes: typeof App.readStoredUniformPackBytes =
    async (value) => {
        // a mode's or a draft's key (`<pack>#<mode>`, `<pack>~<n>`) reads its pack
        const pack = value
            ? packs.get(value.split("#")[0].split("~")[0])
            : null;
        return pack && value ? { value, ...pack } : null;
    };
