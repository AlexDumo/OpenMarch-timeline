/**
 * What the show's assets cost and who uses them, for the Assets view (fork #1001; ADR 0010
 * amendment 2026-11-15): each asset's size, how many things in the show name it now, the ones
 * nothing names (which Remove unused… may take out), and names that point at an asset the show
 * doesn't have (a prop an undo brought back, say), which draw as blocks.
 *
 * Pure: no React, no database.
 */
import type { ShowAsset } from "@/db-functions/showAssets";
import { MODEL_ASSET_KIND } from "./modelImport/rules";
import { UNIFORM_ASSET_KIND } from "@/view3d/core/uniformPack/format";
import { showAssetRefValue } from "./ref";
import { FLAG_ASSET_KIND } from "./flags";

/**
 * The kinds whose every use this build can find (props' models, cue values, the venue's uniform). Another kind, such
 * as one a later build names from elsewhere, is never called unused, so never removed.
 */
export const REMOVABLE_ASSET_KINDS: ReadonlySet<string> = new Set([
    MODEL_ASSET_KIND,
    // imported uniforms (fork #1257): the venue's `uniformArtwork` is their use
    UNIFORM_ASSET_KIND,
    // the show's flags (fork #985): Equipment cues are their use
    FLAG_ASSET_KIND,
]);

/**
 * The kinds whose uses an undo or redo can bring back (the venue's uniform, an Equipment cue's
 * flag): Remove unused… keeps one any undo or redo step names.
 */
export const HISTORY_CHECKED_ASSET_KINDS: ReadonlySet<string> = new Set([
    UNIFORM_ASSET_KIND,
    FLAG_ASSET_KIND,
]);

/** Past this many bytes of assets, the show says it's large (ADR 0010 D-19) */
export const LARGE_SHOW_ASSET_BYTES = 500 * 1024 * 1024;

export interface AssetUse {
    asset: ShowAsset;
    /** The value that names it (`library:<id>@<hash>`) */
    value: string;
    /** Its parts' bytes, each blob once */
    bytes: number;
    /** How many things in the show name it now */
    uses: number;
}

export interface ShowAssetUse {
    /** Every asset, in the store's order */
    assets: AssetUse[];
    /** The assets nothing names, of a kind whose uses this build can find */
    unused: AssetUse[];
    /** The bytes removing the unused assets frees: blobs no used asset shares */
    unusedBytes: number;
    /** Every blob's bytes */
    totalBytes: number;
    /** Values that name an asset the show doesn't have, each once */
    missing: string[];
    /** How many things name a missing asset */
    missingUses: number;
}

const ASSET_REF = /^library:/;

/**
 * Who uses the show's `assets`, from the `references` the show holds now (props' models, cue
 * values; anything else is ignored) and each blob's size.
 */
export function showAssetUse(
    assets: readonly ShowAsset[],
    sizes: ReadonlyMap<string, number>,
    references: readonly (string | null | undefined)[],
    /** Values never called unused though nothing names them now: an undo could bring them back */
    keep: ReadonlySet<string> = new Set(),
): ShowAssetUse {
    const counts = new Map<string, number>();
    for (const value of references)
        if (value && ASSET_REF.test(value))
            counts.set(value, (counts.get(value) ?? 0) + 1);

    const blobsOf = (asset: ShowAsset) => new Set(Object.values(asset.parts));
    const rows = assets.map((asset): AssetUse => {
        const value = showAssetRefValue(asset);
        let bytes = 0;
        for (const hash of blobsOf(asset)) bytes += sizes.get(hash) ?? 0;
        return { asset, value, bytes, uses: counts.get(value) ?? 0 };
    });
    const unused = rows.filter(
        (row) =>
            row.uses === 0 &&
            REMOVABLE_ASSET_KINDS.has(row.asset.kind) &&
            !keep.has(row.value),
    );

    const kept = new Set<string>();
    for (const row of rows)
        if (row.uses > 0) for (const hash of blobsOf(row.asset)) kept.add(hash);
    const freed = new Set<string>();
    for (const row of unused)
        for (const hash of blobsOf(row.asset))
            if (!kept.has(hash)) freed.add(hash);
    let unusedBytes = 0;
    for (const hash of freed) unusedBytes += sizes.get(hash) ?? 0;
    let totalBytes = 0;
    for (const bytes of sizes.values()) totalBytes += bytes;

    const known = new Set(rows.map((row) => row.value));
    const missing = [...counts.keys()].filter((value) => !known.has(value));
    const missingUses = missing.reduce(
        (sum, value) => sum + (counts.get(value) ?? 0),
        0,
    );
    return {
        assets: rows,
        unused,
        unusedBytes,
        totalBytes,
        missing,
        missingUses,
    };
}

/**
 * The values Remove unused… keeps because an undo or redo step names them: `inHistory` once that's
 * been read, and until then (or when it can't be read) every one of `uniforms`, so nothing an
 * undo needs is ever offered.
 */
export function keptForHistory(
    uniforms: readonly string[],
    inHistory: ReadonlySet<string> | undefined,
): ReadonlySet<string> {
    return inHistory ?? new Set(uniforms);
}

/** A size for people: "4.1 MB", "820 KB", "12 bytes" (the unit words are the caller's) */
export function sizeParts(bytes: number): {
    value: string;
    unit: "bytes" | "kb" | "mb" | "gb";
} {
    const KB = 1024;
    const MB = KB * 1024;
    const GB = MB * 1024;
    const one = (n: number) => String(Number(n.toFixed(n < 10 ? 1 : 0)));
    if (bytes >= GB) return { value: one(bytes / GB), unit: "gb" };
    if (bytes >= MB) return { value: one(bytes / MB), unit: "mb" };
    if (bytes >= KB) return { value: one(bytes / KB), unit: "kb" };
    return { value: String(bytes), unit: "bytes" };
}

/** One asset as the Assets view lists it: the version it shows, and its other versions */
export interface AssetGroup {
    /** The version in use, else the newest */
    row: AssetUse;
    /** Every other version, in the store's order */
    others: AssetUse[];
    /** Whether every other version is older than `row` */
    allOlder: boolean;
    /** The other versions' bytes, each blob once and none `row` holds */
    othersBytes: number;
}

/**
 * The Assets view's rows: one per asset, however many versions it has (editing a uniform's
 * items adds versions, fork #1258), in the order each asset first appears. The row shows the
 * version in use (the newest one in use, if several are), else the newest; the others are
 * counted beside it, and Remove unused… still takes out the ones nothing names.
 */
export function groupAssetVersions(
    rows: readonly AssetUse[],
    sizes: ReadonlyMap<string, number>,
): AssetGroup[] {
    const byId = new Map<string, AssetUse[]>();
    for (const row of rows) {
        const list = byId.get(row.asset.id);
        if (list) list.push(row);
        else byId.set(row.asset.id, [row]);
    }
    return [...byId.values()].map((versions) => {
        const used = versions.filter((v) => v.uses > 0);
        const row = (used.length ? used : versions).at(-1)!;
        const others = versions.filter((v) => v !== row);
        const own = new Set(Object.values(row.asset.parts));
        const blobs = new Set<string>();
        for (const v of others)
            for (const hash of Object.values(v.asset.parts))
                if (!own.has(hash)) blobs.add(hash);
        let othersBytes = 0;
        for (const hash of blobs) othersBytes += sizes.get(hash) ?? 0;
        return {
            row,
            others,
            allOlder: others.every(
                (v) => versions.indexOf(v) < versions.indexOf(row),
            ),
            othersBytes,
        };
    });
}

/** A line of Remove unused…: one asset's unused versions */
export interface RemovableLine {
    id: string;
    name: string;
    /** How many of its versions go */
    count: number;
    bytes: number;
    /** Whether another version of it stays (in use or kept for undo) */
    olderOnly: boolean;
    /** With `olderOnly`: whether every version that goes was added before the one in use */
    allOlder: boolean;
}

/**
 * Remove unused…'s list, one line per asset (fork #1287): an item edit leaves versions of a
 * uniform that look alike, so they are counted on one line, as older versions when a version of
 * the same uniform stays.
 */
export function removableLines(
    unused: readonly AssetUse[],
    all: readonly AssetUse[],
): RemovableLine[] {
    const going = new Set(unused.map((row) => row.value));
    const order = new Map(all.map((row, i) => [row.value, i]));
    const lines = new Map<string, RemovableLine>();
    for (const row of unused) {
        const line = lines.get(row.asset.id);
        if (line) {
            line.count++;
            line.bytes += row.bytes;
            line.name = row.asset.name;
        } else
            lines.set(row.asset.id, {
                id: row.asset.id,
                name: row.asset.name,
                count: 1,
                bytes: row.bytes,
                olderOnly: false,
                allOlder: false,
            });
    }
    for (const line of lines.values()) {
        const versions = all.filter((r) => r.asset.id === line.id);
        const staying = versions.filter((r) => !going.has(r.value));
        line.olderOnly = staying.length > 0;
        // older than the version in use, not just than one kept for undo
        const inUse = staying.filter((r) => r.uses > 0);
        const firstInUse = Math.min(
            ...inUse.map((r) => order.get(r.value) ?? 0),
        );
        line.allOlder =
            inUse.length > 0 &&
            versions
                .filter((r) => going.has(r.value))
                .every((r) => (order.get(r.value) ?? 0) < firstInUse);
    }
    return [...lines.values()];
}

/**
 * What Remove unused… counts, consistent with its grouped list: versions when any line is a
 * group of versions, otherwise assets (one line each)
 */
export function removableCount(lines: readonly RemovableLine[]): {
    count: number;
    unit: "assets" | "versions";
} {
    const versions = lines.some((l) => l.olderOnly || l.count > 1);
    return versions
        ? { count: lines.reduce((n, l) => n + l.count, 0), unit: "versions" }
        : { count: lines.length, unit: "assets" };
}
