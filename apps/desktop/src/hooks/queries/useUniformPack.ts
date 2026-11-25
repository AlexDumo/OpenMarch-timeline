/**
 * The show's imported uniforms (fork #1257): uniform packs stored as show assets of kind
 * `uniform`, read by the 3D View window through its read-only proxy, and the editor's write that
 * makes one the band's uniform.
 *
 * A show may come from anyone, so a stored pack is read like an imported one: in the uniform pack
 * worker (`runUniformPackJob`), never on the main thread.
 */
import {
    mutationOptions,
    queryOptions,
    type QueryClient,
} from "@tanstack/react-query";
import { db } from "@/global/database/db";
import {
    UniformPackSupersededError,
    resolveStoredUniformPack,
    saveUniformItemsPack,
    setUniformPack,
} from "@/db-functions/view3dUniformPack";
import { parseShowAssetRef, showAssetRefValue } from "@/showAssets/ref";
import {
    UNIFORM_ASSET_KIND,
    UNIFORM_PACK_PART,
    type UniformPackManifest,
} from "@/view3d/core/uniformPack/format";
import { runUniformPackJob } from "@/view3d/uniformPack/runUniformPackJob";
import { isPassingPackFailure } from "@/view3d/uniformPack/protocol";
import { conToastError } from "@/utilities/utils";
import tolgee from "@/global/singletons/Tolgee";
import { DEFAULT_STALE_TIME } from "./constants";
import { fieldPropertiesQueryOptions } from "./useFieldProperties";
import { venueSettingsKeys } from "./useVenueSettings";
import {
    showAssetBlobCache,
    showAssetKeys,
    showAssetsQueryOptions,
} from "./useShowAssets";

/** One stored pack's file, unread */
export interface StoredUniformPackBytes {
    /** The value that names it (`library:<id>@<hash>`) */
    value: string;
    /** The asset's name in the show */
    name: string;
    /** The pack file, exactly as stored: what Save uniform file writes. Shared: never change it. */
    bytes: Uint8Array;
}

/** One stored pack, read in the worker */
export interface StoredUniformPack extends StoredUniformPackBytes {
    manifest: UniformPackManifest;
    /** Each item image's size in pixels, by file, from its header (fork #1258) */
    itemSizes: Record<string, { width: number; height: number }>;
}

/** One of the show's uniforms: its newest version, and every version's value */
export interface UniformPackEntry {
    /** The uniform asset's id, the same for all its versions */
    id: string;
    /** The newest version (`library:<id>@<hash>`) */
    value: string;
    name: string;
    /** Every version's value, oldest first; editing items adds versions (fork #1258) */
    versions: string[];
}

/** The show's uniforms, oldest first, one entry per asset however many versions it has */
export const uniformPacksQueryOptions = () =>
    queryOptions({
        ...showAssetsQueryOptions(),
        select: (assets): UniformPackEntry[] => {
            const byId = new Map<string, UniformPackEntry>();
            for (const asset of assets) {
                if (asset.kind !== UNIFORM_ASSET_KIND) continue;
                const value = showAssetRefValue(asset);
                const entry = byId.get(asset.id);
                if (entry) {
                    entry.value = value;
                    entry.name = asset.name;
                    entry.versions.push(value);
                } else
                    byId.set(asset.id, {
                        id: asset.id,
                        value,
                        name: asset.name,
                        versions: [value],
                    });
            }
            return [...byId.values()];
        },
    });

/**
 * The stored file of the pack `value` names, or null when it names no uniform asset the show
 * has. Bytes come through the show's blob cache: never change them.
 */
export async function readStoredUniformPackBytes(
    value: string | null | undefined,
): Promise<StoredUniformPackBytes | null> {
    // a version an editing burst just replaced reads as its uniform's newest one
    const stored = await resolveStoredUniformPack({ db, value });
    if (!stored) return null;
    const bytes = await showAssetBlobCache.get(stored.hash);
    return bytes ? { value: stored.value, name: stored.name, bytes } : null;
}

/**
 * The mode ids of the uniform version `value` names (none for a pack without modes), read in
 * the worker without decoding its images; undefined when the show has no such uniform or it
 * doesn't read
 */
export async function uniformPackModes(
    value: string,
): Promise<string[] | undefined> {
    try {
        const stored = await readStoredUniformPackBytes(value);
        if (!stored) return undefined;
        const manifest = await readPackManifest(stored.bytes);
        return (manifest.modes ?? []).map((mode) => mode.id);
    } catch (error) {
        console.warn("3D View: couldn't read the uniform's modes", error);
        return undefined;
    }
}

/** A pack file's manifest, read and checked in the worker; throws when it isn't a pack */
export async function readPackManifest(
    bytes: Uint8Array,
): Promise<UniformPackManifest> {
    return (await readPackInWorker(bytes)).manifest;
}

/**
 * A pack file's manifest and its item images' sizes, read in a fresh worker. With `decoded`
 * (the sha256 of images known to decode), every other image in it is decoded too, so damaged
 * image data is refused here; the answer lists every image's hash.
 */
async function readPackInWorker(bytes: Uint8Array, decoded?: string[]) {
    // a copy: the worker takes it, and callers' bytes may be shared
    const result = await runUniformPackJob({
        type: "pack",
        bytes: bytes.slice(),
        decode: decoded !== undefined,
        decoded,
    });
    if (result.type !== "pack") throw new Error("uniform pack: no manifest");
    return result;
}

/**
 * What this window knows decodes, so a read doesn't decode the same images again: each pack
 * version whose every image decoded (a version's bytes never change), and each image by its
 * sha256 (an item edit's new version shares most of the last one's). Only images that decoded
 * are kept, never a failure.
 */
const decodedVersions = new Set<string>();
const decodedImages = new Set<string>();
const DECODED_IMAGES_KEPT = 512;
const noteDecoded = (value: string, hashes: readonly string[]) => {
    decodedVersions.add(value);
    for (const hash of hashes) {
        decodedImages.delete(hash);
        decodedImages.add(hash);
    }
    while (decodedImages.size > DECODED_IMAGES_KEPT)
        decodedImages.delete(decodedImages.values().next().value!);
};

/**
 * Whether reads decode the pack's images. The 3D View window turns this off
 * ({@link composeChecksUniformPacks}): it composes the pack it reads, which decodes the art anyway,
 * and a refusal there asks for a decoding read ({@link recheckUniformPack}). The editor decodes.
 */
let readsDecode = true;
/** Packs a decoding read must check from scratch: their art didn't compose */
const recheck = new Set<string>();

/**
 * For the 3D View window: reads don't decode the images, because composing the art does, and a
 * compose the worker refuses calls {@link recheckUniformPack}. Saves decoding every layer twice
 * when the window opens on a show wearing a uniform.
 */
export function composeChecksUniformPacks(): void {
    readsDecode = false;
}

/**
 * The pack `value` names, read, or null when it names no uniform asset the show has, or its
 * bytes don't read as a pack, or an image in it doesn't decode (the art couldn't be drawn: see
 * `wornPackProblem`). Under the assets' key, so adding one refreshes it.
 *
 * A refusal is believed only when a second, fresh worker refuses too: one decode can fail for
 * want of memory (two workers decoding at once, an integrated GPU). A worker that ran out of
 * time or died says nothing about the file: that read throws, so it is tried again (here, and on
 * the next use) rather than kept as "may be damaged" for good.
 */
export const uniformPackQueryOptions = (value: string | null | undefined) =>
    queryOptions<StoredUniformPack | null>({
        queryKey: [...showAssetKeys.all(), "uniformPack", value ?? ""],
        queryFn: async () => {
            const stored = await readStoredUniformPackBytes(value);
            if (!stored) return null;
            const fresh = recheck.has(stored.value) || recheck.has(value ?? "");
            const decode =
                fresh || (readsDecode && !decodedVersions.has(stored.value));
            const read = () =>
                readPackInWorker(
                    stored.bytes,
                    decode ? (fresh ? [] : [...decodedImages]) : undefined,
                );
            let result: Awaited<ReturnType<typeof read>>;
            try {
                result = await read();
            } catch (error) {
                if (isPassingPackFailure(error)) throw error;
                try {
                    // once more in a fresh worker before calling it damaged
                    result = await read();
                } catch (again) {
                    if (isPassingPackFailure(again)) throw again;
                    console.warn(
                        "3D View: the show's uniform doesn't read",
                        again,
                    );
                    return null;
                }
            }
            recheck.delete(stored.value);
            if (value) recheck.delete(value);
            if (decode) noteDecoded(stored.value, result.decoded ?? []);
            return {
                ...stored,
                manifest: result.manifest,
                itemSizes: result.itemSizes,
            };
        },
        enabled: parseShowAssetRef(value) !== null,
        staleTime: DEFAULT_STALE_TIME,
        retry: (failures, error) => failures < 3 && isPassingPackFailure(error),
    });

/**
 * The art of the pack `value` names didn't compose. When the worker refused it (not a failure
 * that says nothing about the file, see `isPassingPackFailure`), reads it again with every image
 * decoded, in fresh workers: only if that is refused twice too does every view that asks
 * `wornPackProblem` in this window say it can't be read. Returns whether it rechecks.
 */
export function recheckUniformPack(
    qc: QueryClient,
    value: string,
    error: unknown,
): boolean {
    if (isPassingPackFailure(error)) return false;
    recheck.add(value);
    decodedVersions.delete(value);
    void qc.invalidateQueries({
        queryKey: uniformPackQueryOptions(value).queryKey,
        exact: true,
    });
    return true;
}

/**
 * Stores a pack file in the show and dresses the band in it, as one undo step; then refreshes
 * the assets and the venue settings. The file is read in the worker first. With `versionOf`
 * (an edit of a uniform's items), the pack is a new version of that uniform asset. Resolves with
 * the value now in `uniformArtwork`.
 */
export const setUniformPackMutationOptions = (qc: QueryClient) =>
    mutationOptions({
        mutationFn: async ({
            pack,
            versionOf,
            expect,
            amend,
        }: {
            pack: Uint8Array;
            versionOf?: string;
            /** An item edit (fork #1258): store only while the venue names this */
            expect?: string;
            /** An item edit's burst token, from its first save */
            amend?: string;
        }): Promise<{ value: string; token?: string | null }> => {
            const manifest = await readPackManifest(pack);
            const field = await qc.fetchQuery(fieldPropertiesQueryOptions());
            if (expect !== undefined)
                return await saveUniformItemsPack({
                    db,
                    pack,
                    manifest,
                    field,
                    versionOf,
                    expect,
                    amend,
                });
            return {
                value: await setUniformPack({
                    db,
                    pack,
                    manifest,
                    field,
                    versionOf,
                }),
            };
        },
        onSuccess: async () => {
            // together: the 3D View hears of both at once, so it never reads the new assets
            // against the old venue for the seconds the asset refetch can take
            await Promise.all([
                qc.invalidateQueries({ queryKey: venueSettingsKeys.all() }),
                qc.invalidateQueries({ queryKey: showAssetKeys.all() }),
            ]);
        },
        onError: (error) => {
            // an item edit the venue had moved on from: dropped on purpose, nothing failed
            if (error instanceof UniformPackSupersededError) return;
            conToastError(tolgee.t("view3d.uniformImport.saveFailed"), error);
        },
    });

/**
 * The show's uniform that `value` names a version of, by its asset id: a version an editing
 * burst just replaced still finds its uniform (see `resolveStoredUniformPack`)
 */
export function uniformEntryOf(
    packs: readonly UniformPackEntry[] | undefined,
    value: string | null | undefined,
): UniformPackEntry | undefined {
    const id = parseShowAssetRef(value)?.id;
    return id ? packs?.find((p) => p.id === id) : undefined;
}

/**
 * Keeps a uniform pack query's last data while the value it reads moves to another version of
 * the same uniform (an item edit's save), so what shows it doesn't blink out; never across
 * different uniforms
 */
export const keepSameUniform =
    (value: string | null | undefined) =>
    (previous: StoredUniformPack | null | undefined) =>
        previous &&
        parseShowAssetRef(previous.value)?.id === parseShowAssetRef(value)?.id
            ? previous
            : undefined;
