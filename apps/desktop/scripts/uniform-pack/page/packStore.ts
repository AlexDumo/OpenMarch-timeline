/**
 * Stands in for `@/hooks/queries/useUniformPack` on the tool page (vite.config.mts): the atlas
 * composer (`flatsAtlas.ts`) reads a worn pack's bytes through `readStoredUniformPackBytes`, which
 * in the app reads the show database. Here the page puts the pack it renders in place first.
 */
const packs = new Map<string, { name: string; bytes: Uint8Array }>();

export function putPack(value: string, name: string, bytes: Uint8Array) {
    packs.set(value, { name, bytes });
}

export async function readStoredUniformPackBytes(
    value: string | null | undefined,
): Promise<{ value: string; name: string; bytes: Uint8Array } | null> {
    // a mode's key (`<pack>#<mode>`) reads its pack
    const pack = value ? packs.get(value.split("#")[0].split("~")[0]) : null;
    return pack && value ? { value, ...pack } : null;
}
