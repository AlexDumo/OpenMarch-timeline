/**
 * The band's imported uniform (fork #1257; ADR 0010 amendment 2026-11-24): a uniform pack is a
 * show asset of kind `uniform` whose one part, `pack`, is the pack file's bytes as they are
 * (`src/view3d/core/uniformPack/format.ts`). The venue settings' `uniformArtwork` names it as
 * `library:<id>@<version hash>`, the form props' models and cue values use.
 *
 * Adding the asset is outside undo, like every show asset; pointing the venue at it is undoable,
 * so Undo puts the band back in what it wore and the pack stays in the show for next time.
 */
import type { DbConnection, DbTransaction } from "./types";
import { amendLatestUndoEntry, transactionWithHistory } from "./history";
import {
    getStoredVenueSettings,
    updateVenueSettingsInTransaction,
} from "./view3dVenue";
import {
    addShowAssetInTransaction,
    getShowAsset,
    getShowAssets,
    type ShowAsset,
    hashShowAsset,
    type ShowAssetHashes,
    removeShowAssetsInTransaction,
    valuesNamedInHistory,
} from "./showAssets";
import {
    defaultVenueForField,
    type VenueFieldInfo,
} from "@/view3d/core/venueSettings";
import {
    UNIFORM_ASSET_KIND,
    UNIFORM_PACK_PART,
    uniformPackManifestSchema,
    type UniformPackManifest,
} from "@/view3d/core/uniformPack/format";
import { parseShowAssetRef, showAssetRefValue } from "@/showAssets/ref";
import type { JsonObject } from "@/showAssets/hash";

/**
 * Adds the pack file `pack` to the show's assets (reusing it if the show has these bytes already)
 * and dresses the band in it. Returns the value now in `uniformArtwork`.
 *
 * With `versionOf`, an asset id, the pack is added as a new version of that uniform (an edit of
 * its items in the 3D View, fork #1258), so the Assets view keeps one uniform, not one per edit.
 * An id the show doesn't have as a uniform is ignored, and the pack is a uniform of its own.
 *
 * `manifest` is the pack's, read from these bytes by the caller: the editor reads untrusted packs
 * only in the uniform pack worker (`readPackManifest`), never inside a transaction on its main
 * thread. It is checked again here, which costs nothing.
 */
export async function setUniformPackInTransaction({
    tx,
    pack,
    manifest: given,
    field,
    versionOf,
    expect,
    hashes,
}: {
    tx: DbTransaction;
    pack: Uint8Array;
    manifest: UniformPackManifest;
    /** For the default venue, when the show has no venue row yet */
    field: VenueFieldInfo;
    versionOf?: string;
    /** Store only if the venue names this value now; otherwise store nothing and throw */
    expect?: string;
    /** The pack's hashes, worked out before the transaction (`hashShowAsset`) */
    hashes?: ShowAssetHashes;
}): Promise<string> {
    const manifest = uniformPackManifestSchema.parse(given);
    if (expect !== undefined) {
        const now = (await getStoredVenueSettings({ db: tx }))?.uniformArtwork;
        if (now !== expect) throw new UniformPackSupersededError();
    }
    const id =
        versionOf !== undefined &&
        (await getShowAssets({ db: tx })).some(
            (asset) =>
                asset.id === versionOf && asset.kind === UNIFORM_ASSET_KIND,
        )
            ? versionOf
            : undefined;
    const { ref } = await addShowAssetInTransaction({
        tx,
        hashes,
        asset: {
            ...(id ? { id } : {}),
            kind: UNIFORM_ASSET_KIND,
            name: manifest.name,
            parts: { [UNIFORM_PACK_PART]: pack },
            sidecar: { formatVersion: manifest.formatVersion },
            credits: { ...manifest.credits } as JsonObject,
        },
    });
    const value = showAssetRefValue(ref);
    const stored =
        (await getStoredVenueSettings({ db: tx })) ??
        defaultVenueForField(field);
    // a new uniform starts in its default mode; a new version of the same one keeps the mode
    // the band wears while it still has it (step 5 of fork #1257)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- left out
    const { uniformMode, ...rest } = stored;
    const keepsMode =
        !!id && (manifest.modes ?? []).some((m) => m.id === uniformMode);
    const venue = keepsMode ? stored : rest;
    await updateVenueSettingsInTransaction({
        tx,
        settings: { ...venue, uniformArtwork: value },
    });
    return value;
}

/** {@link setUniformPackInTransaction} as one undoable history group */
export async function setUniformPack({
    db,
    pack,
    manifest,
    field,
    versionOf,
}: {
    db: DbConnection;
    pack: Uint8Array;
    manifest: UniformPackManifest;
    field: VenueFieldInfo;
    versionOf?: string;
}): Promise<string> {
    return await transactionWithHistory(
        db,
        "setUniformPack",
        async (tx) =>
            await setUniformPackInTransaction({
                tx,
                pack,
                manifest,
                field,
                versionOf,
            }),
    );
}

/**
 * Thrown when an item edit arrives after the venue moved on from the pack it started from (an
 * Undo or another uniform picked while it saved): nothing is stored, so the edit can't undo the
 * Undo or clear Redo.
 */
export class UniformPackSupersededError extends Error {
    constructor() {
        super("the venue no longer names the pack this edit started from");
        this.name = "UniformPackSupersededError";
    }
}

/**
 * Saves an edit of the band's uniform items (fork #1258): `pack` is the whole new pack, a new
 * version of uniform `versionOf`, stored only while the venue still names `expect`.
 *
 * Edits come in bursts (the window saves a moment after each pause). The first save of a burst
 * is one undo step, from the pack the burst started from. Each later save of the burst passes
 * that save's `token` as `amend`: while it is still the latest undo entry, the venue is pointed
 * at the new pack without a new undo step (so Undo still goes back to where the burst started),
 * and the version it replaces is removed, unless anything in the history names it. So a burst
 * leaves two versions, its origin and its latest, and one undo step. If anything else became
 * the latest undo entry, the save starts a new burst instead.
 *
 * Returns the value now in `uniformArtwork` and the burst's token.
 */
export async function saveUniformItemsPack({
    db,
    pack,
    manifest,
    field,
    versionOf,
    expect,
    amend,
}: {
    db: DbConnection;
    pack: Uint8Array;
    manifest: UniformPackManifest;
    field: VenueFieldInfo;
    versionOf?: string;
    expect: string;
    amend?: string;
}): Promise<{ value: string; token: string | null }> {
    // the slow part, before any lock: hashing the whole pack
    const hashes = await hashShowAsset({
        parts: { [UNIFORM_PACK_PART]: pack },
        sidecar: { formatVersion: manifest.formatVersion },
    });
    if (amend !== undefined) {
        const amended = await amendLatestUndoEntry(
            db,
            amend,
            ["view3d_venue"],
            async (tx) =>
                await setUniformPackInTransaction({
                    tx,
                    pack,
                    manifest,
                    field,
                    versionOf,
                    expect,
                    hashes,
                }),
            // once the venue's change has left the history: the version this one replaces,
            // unless the history still names it
            async (tx, value) => {
                const replaced = parseShowAssetRef(expect);
                if (
                    replaced &&
                    expect !== value &&
                    !(
                        await valuesNamedInHistory({
                            db: tx,
                            values: [expect],
                        })
                    ).has(expect)
                )
                    await removeShowAssetsInTransaction({
                        tx,
                        refs: [replaced],
                    });
            },
        );
        if (amended.amended) return { value: amended.result, token: amend };
    }
    let token: string | null = null;
    const value = await transactionWithHistory(
        db,
        "setUniformItems",
        async (tx) =>
            await setUniformPackInTransaction({
                tx,
                pack,
                manifest,
                field,
                versionOf,
                expect,
                hashes,
            }),
        {
            onUndoToken: (t) => {
                token = t;
            },
        },
    );
    return { value, token };
}

/**
 * The stored uniform pack `value` names, for drawing it: its own version, or, when that version
 * is gone, the newest version of the same uniform. Null when the show has no uniform of that id.
 *
 * Why the fallback: an editing burst's save removes the version it replaces in the same
 * transaction that points the venue at the new one, so the venue in the database never names a
 * removed version. But the 3D View learns of the asset change and of the venue change
 * separately, and for a moment its venue can still name the version just removed. Reading that
 * as "the show has no such uniform" made the band drop to its preset for seconds (fork #1287).
 * The removed version's successor is the version of the same uniform the venue names now (or,
 * if it names another uniform, the last version added), which the window's venue names a moment
 * later.
 */
export async function resolveStoredUniformPack({
    db,
    value,
}: {
    db: DbConnection | DbTransaction;
    value: string | null | undefined;
}): Promise<{ value: string; name: string; hash: string } | null> {
    const ref = parseShowAssetRef(value);
    if (!ref || !value) return null;
    const exact = await getShowAsset({ db, ref });
    const pick = (asset: ShowAsset | undefined) =>
        asset &&
        asset.kind === UNIFORM_ASSET_KIND &&
        asset.parts[UNIFORM_PACK_PART]
            ? {
                  value: showAssetRefValue(asset),
                  name: asset.name,
                  hash: asset.parts[UNIFORM_PACK_PART],
              }
            : null;
    if (exact) return pick(exact);
    // the removed version's successor: what the venue names now, when it's the same uniform (a
    // save whose bytes match an older version reuses that version's row, so the last row added
    // isn't always the newest look)
    const now = parseShowAssetRef(
        (await getStoredVenueSettings({ db }))?.uniformArtwork as
            | string
            | undefined,
    );
    if (now && now.id === ref.id) {
        const current = await getShowAsset({ db, ref: now });
        if (current) return pick(current);
    }
    // otherwise the last version added
    const versions = (await getShowAssets({ db })).filter(
        (asset) => asset.id === ref.id && asset.kind === UNIFORM_ASSET_KIND,
    );
    return pick(versions.at(-1));
}
