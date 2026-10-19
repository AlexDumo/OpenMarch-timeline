/**
 * The show's Library: embedded copies of the Library items a show uses (ADR 0002 D-12,
 * props-spec.md section 2 "In the show", package C1.11).
 *
 * A Version is embedded as its parts' bytes in `library_blobs`, deduped by hash, and one
 * `library_items` row naming them. Neither table has history triggers, so embedding inside an
 * undoable edit stays when the edit is undone, and pruning never shows up in undo.
 *
 * The editor is the show's only writer (D-4): it reads a Version's parts from the local Library
 * over `library:read-parts` and embeds them here. Nothing here touches the local Library.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
// The main process embeds a floor on open (D-23), so no renderer database module here
import * as schema from "@om-electron/database/migrations/schema";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { getCues, updateCuesInTransaction, type DatabaseCue } from "./cues";
import {
    DerivedFromSchema,
    LibraryItemIdSchema,
    LicenseFieldsSchema,
    VersionHashSchema,
    type LibraryItemKind,
} from "@om-electron/main/library/types";
import { hashParts, versionHashOf } from "@/view3d/library/showHash";
import {
    keepsOf,
    libraryReferences,
    LIBRARY_REFERENCE_SOURCES,
    type LibraryReference,
} from "./libraryReferences";
import {
    planLibraryPrune,
    type LibraryKeep,
    type LibraryPrunePlan,
    type LibraryRef,
} from "@/view3d/library/showLibraryPrune";

/** The item's metadata as it was when embedded; the show never reads it from the Library. */
export const ShowLibraryMetadataSchema = z
    .object({
        tags: z.array(z.string()),
        createdAt: z.string(),
        updatedAt: z.string(),
        originalFilename: z.string().nullable(),
        derivedFrom: DerivedFromSchema.nullable(),
    })
    .extend(LicenseFieldsSchema.shape);
export type ShowLibraryMetadata = z.infer<typeof ShowLibraryMetadataSchema>;

const LibraryRefSchema = z.object({
    itemId: LibraryItemIdSchema,
    versionHash: VersionHashSchema,
});
const PartsSchema = z.record(z.string(), VersionHashSchema);

/** A Version to embed, with its parts' bytes. */
export interface EmbedLibraryVersion {
    itemId: string;
    versionHash: string;
    kind: LibraryItemKind;
    name: string;
    builtIn: boolean;
    metadata: ShowLibraryMetadata;
    /** Versions this one pins, such as a Uniform's Garments and Artwork */
    pins: readonly LibraryRef[];
    /** Part role to bytes */
    parts: Readonly<Record<string, Uint8Array>>;
}

/** An embedded Version, as the show loads it at open. Bytes are read separately, by hash. */
export interface ShowLibraryItem {
    itemId: string;
    versionHash: string;
    kind: LibraryItemKind;
    name: string;
    builtIn: boolean;
    metadata: ShowLibraryMetadata;
    pins: LibraryRef[];
    /** Part role to `library_blobs` hash */
    parts: Record<string, string>;
    /** A model's parsed sidecar, or null */
    sidecar: unknown;
    embeddedAt: string;
}

const SIDECAR_ROLE = "sidecar";

/** Matches the `library_items` row of one Version. */
const isLibraryVersion = (ref: LibraryRef) =>
    and(
        eq(schema.library_items.item_id, ref.itemId),
        eq(schema.library_items.version_hash, ref.versionHash),
    );

function parseSidecar(bytes: Uint8Array | undefined): string | null {
    if (!bytes) return null;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    JSON.parse(text);
    return text;
}

/**
 * Embeds a Version in the show, unless it is already there.
 *
 * Checks that the parts hash to `versionHash` first, so a show never holds a Version under a
 * name its bytes don't have. Not undoable: call it from inside an undoable edit and the Version
 * stays when the edit is undone (a later prune removes it if nothing keeps it).
 */
export async function embedLibraryVersionInTransaction({
    tx,
    version,
}: {
    tx: DbTransaction;
    version: EmbedLibraryVersion;
}): Promise<{ embedded: boolean }> {
    const existing = await tx
        .select({ item_id: schema.library_items.item_id })
        .from(schema.library_items)
        .where(isLibraryVersion(version))
        .get();
    if (existing) return { embedded: false };

    const partHashes = await hashParts(version.parts);
    const actual = await versionHashOf(partHashes);
    if (actual !== version.versionHash) {
        throw new Error(
            `Parts of ${version.itemId} don't match its Version hash ${version.versionHash}`,
        );
    }

    let sidecar: string | null;
    try {
        sidecar = parseSidecar(version.parts[SIDECAR_ROLE]);
    } catch (error) {
        throw new Error(`The sidecar of ${version.itemId} isn't JSON`, {
            cause: error,
        });
    }

    for (const [role, hash] of Object.entries(partHashes)) {
        await tx
            .insert(schema.library_blobs)
            .values({ hash, data: version.parts[role] })
            .onConflictDoNothing()
            .run();
    }
    await tx
        .insert(schema.library_items)
        .values({
            item_id: version.itemId,
            version_hash: version.versionHash,
            kind: version.kind,
            name: version.name,
            built_in: version.builtIn ? 1 : 0,
            parts: JSON.stringify(partHashes),
            pins: JSON.stringify(version.pins),
            metadata: JSON.stringify(version.metadata),
            sidecar,
        })
        .run();
    return { embedded: true };
}

/**
 * Embeds Versions in one plain transaction, all or nothing, such as the copies an import adds.
 * Not undoable, like workspace settings: nothing here is an edit to the show.
 */
export async function embedLibraryVersions({
    db,
    versions,
}: {
    db: DbConnection;
    versions: readonly EmbedLibraryVersion[];
}): Promise<void> {
    await db.transaction(async (tx) => {
        for (const version of versions) {
            await embedLibraryVersionInTransaction({ tx, version });
        }
    });
}

const ShowLibraryRowSchema = z.object({
    item_id: LibraryItemIdSchema,
    version_hash: VersionHashSchema,
    kind: z.enum(["model", "artwork", "uniform"]),
    name: z.string(),
    built_in: z.union([z.literal(0), z.literal(1)]),
    parts: z.string().transform((s, ctx) => {
        try {
            return PartsSchema.parse(JSON.parse(s));
        } catch {
            ctx.addIssue({ code: "custom", message: "bad parts" });
            return z.NEVER;
        }
    }),
    pins: z.string().transform((s, ctx) => {
        try {
            return z.array(LibraryRefSchema).parse(JSON.parse(s));
        } catch {
            ctx.addIssue({ code: "custom", message: "bad pins" });
            return z.NEVER;
        }
    }),
    metadata: z.string().transform((s, ctx) => {
        try {
            return ShowLibraryMetadataSchema.parse(JSON.parse(s));
        } catch {
            ctx.addIssue({ code: "custom", message: "bad metadata" });
            return z.NEVER;
        }
    }),
    sidecar: z
        .string()
        .nullable()
        .transform((s, ctx) => {
            if (s === null) return null;
            try {
                return JSON.parse(s) as unknown;
            } catch {
                ctx.addIssue({ code: "custom", message: "bad sidecar" });
                return z.NEVER;
            }
        }),
    embedded_at: z.string(),
});

/**
 * Loads every embedded Version, without bytes. A row that doesn't parse is skipped with a
 * warning, so one bad row never stops a show from opening. Never writes.
 */
export async function getShowLibraryItems({
    db,
}: {
    db: DbConnection | DbTransaction;
}): Promise<ShowLibraryItem[]> {
    const rows = await db.select().from(schema.library_items).all();
    const items: ShowLibraryItem[] = [];
    for (const row of rows) {
        const parsed = ShowLibraryRowSchema.safeParse(row);
        if (!parsed.success) {
            console.warn(
                `Skipping show Library item ${row.item_id}@${row.version_hash}`,
                parsed.error,
            );
            continue;
        }
        const r = parsed.data;
        items.push({
            itemId: r.item_id,
            versionHash: r.version_hash,
            kind: r.kind,
            name: r.name,
            builtIn: r.built_in === 1,
            metadata: r.metadata,
            pins: r.pins,
            parts: r.parts,
            sidecar: r.sidecar,
            embeddedAt: r.embedded_at,
        });
    }
    return items;
}

/** Reads one blob's bytes, or undefined when the show doesn't have it. */
export async function readLibraryBlob({
    db,
    hash,
}: {
    db: DbConnection | DbTransaction;
    hash: string;
}): Promise<Uint8Array | undefined> {
    const row = await db
        .select({ data: schema.library_blobs.data })
        .from(schema.library_blobs)
        .where(eq(schema.library_blobs.hash, hash))
        .get();
    return row?.data;
}

/**
 * One embedded Version with its parts' bytes, ready to embed in another show as it is: same
 * item, Version, name, license and pins. Undefined when the show doesn't hold it whole.
 */
export async function readEmbeddedVersion({
    db,
    ref,
}: {
    db: DbConnection | DbTransaction;
    ref: LibraryRef;
}): Promise<EmbedLibraryVersion | undefined> {
    const row = await db
        .select()
        .from(schema.library_items)
        .where(isLibraryVersion(ref))
        .get();
    if (!row) return undefined;
    const parsed = ShowLibraryRowSchema.safeParse(row);
    if (!parsed.success) return undefined;
    const r = parsed.data;
    const parts: Record<string, Uint8Array> = {};
    for (const [role, hash] of Object.entries(r.parts)) {
        const bytes = await readLibraryBlob({ db, hash });
        if (!bytes) return undefined;
        parts[role] = new Uint8Array(bytes);
    }
    return {
        itemId: r.item_id,
        versionHash: r.version_hash,
        kind: r.kind,
        name: r.name,
        builtIn: r.built_in === 1,
        metadata: r.metadata,
        pins: r.pins,
        parts,
    };
}

/**
 * Library items an undo or redo row names. History lives in the show file and outlives the
 * session, so an item a past edit used must survive a prune: undoing that edit brings the use
 * back. Matching on the item id anywhere in the row's SQL is coarse, and keeps every Version of
 * the item, which errs toward keeping. One source of `libraryReferences`.
 */
export async function libraryKeepsFromHistory({
    db,
}: {
    db: DbConnection | DbTransaction;
}): Promise<LibraryKeep[]> {
    return keepsOf(await LIBRARY_REFERENCE_SOURCES.history.read(db));
}

const libraryCueValue = (ref: LibraryRef) =>
    `library:${ref.itemId}@${ref.versionHash}`;

/**
 * Library Versions the show's cues name (Carry, Silk and Uniform values), each once. Save never
 * prunes a Library item a cue names (ADR 0004 amendment of 2026-10-11, and of 2026-10-15). One
 * source of `libraryReferences`.
 */
export async function libraryKeepsFromCues({
    db,
}: {
    db: DbConnection | DbTransaction;
}): Promise<LibraryKeep[]> {
    const keeps = new Map<string, LibraryKeep>();
    for (const ref of await LIBRARY_REFERENCE_SOURCES.cues.read(db))
        keeps.set(`${ref.itemId}@${ref.versionHash}`, {
            itemId: ref.itemId,
            versionHash: ref.versionHash!,
        });
    return [...keeps.values()];
}

/**
 * Removes the Versions nothing keeps, then the blobs no remaining Version names (props-spec.md
 * section 2). Everything the show names is kept (`libraryReferences`: cues, the floor, the Item
 * tables and history); `keep` adds more.
 */
export async function pruneShowLibraryInTransaction({
    tx,
    keep,
}: {
    tx: DbTransaction;
    keep: readonly LibraryKeep[];
}): Promise<LibraryPrunePlan> {
    const rows = await tx
        .select({
            item_id: schema.library_items.item_id,
            version_hash: schema.library_items.version_hash,
            parts: schema.library_items.parts,
            pins: schema.library_items.pins,
        })
        .from(schema.library_items)
        .all();
    const items = [];
    const unreadable: LibraryKeep[] = [];
    for (const row of rows) {
        const parts = PartsSchema.safeParse(safeJson(row.parts));
        const pins = z.array(LibraryRefSchema).safeParse(safeJson(row.pins));
        if (!parts.success || !pins.success) {
            // Can't tell what it names, so neither it nor any blob is pruned
            unreadable.push({
                itemId: row.item_id,
                versionHash: row.version_hash,
            });
            continue;
        }
        items.push({
            itemId: row.item_id,
            versionHash: row.version_hash,
            parts: parts.data,
            pins: pins.data,
        });
    }
    const blobHashes = (
        await tx
            .select({ hash: schema.library_blobs.hash })
            .from(schema.library_blobs)
            .all()
    ).map((r) => r.hash);

    const plan = planLibraryPrune({
        items,
        blobHashes,
        keep: [...keep, ...keepsOf(await libraryReferences({ db: tx }))],
    });
    if (unreadable.length > 0) plan.blobs = [];

    for (const ref of plan.items) {
        await tx
            .delete(schema.library_items)
            .where(isLibraryVersion(ref))
            .run();
    }
    if (plan.blobs.length > 0)
        await tx
            .delete(schema.library_blobs)
            .where(inArray(schema.library_blobs.hash, plan.blobs))
            .run();
    return plan;
}

function safeJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/** A cue that names a Library item, with where it sits, for the list "Replace with…" shows. */
export interface LibraryCueUse {
    cue: DatabaseCue;
    /** The cue's beat as the editor counts it: its index in the show's beats */
    beatIndex: number;
    /** A tag target's name, else null */
    tagName: string | null;
}

/** A prop or piece of equipment using a Library item, as its model or on an Artwork slot. */
export interface LibraryItemUse {
    marcherId: number;
    /** The item's name, else its drill number */
    label: string;
    /** The Artwork slot it sits on; null for the item's model */
    slot: string | null;
}

/** What stops a show's Library item from being deleted (props-spec.md section 2, [26.10]). */
export interface LibraryItemUses {
    /** Cues naming any Version of the item, by beat */
    cues: LibraryCueUse[];
    /** True when it is the show's floor (D-23) */
    floor: boolean;
    /** Props and equipment using it, as a model or on a slot, dormant assignments included */
    items: LibraryItemUse[];
    /** Other embedded items whose Versions pin it, such as a Uniform pinning its Artwork */
    pinnedBy: { itemId: string; name: string }[];
}

/** Whether anything in `uses` stops the delete. */
export const isInUse = (uses: LibraryItemUses) =>
    uses.cues.length > 0 ||
    uses.floor ||
    uses.items.length > 0 ||
    uses.pinnedBy.length > 0;

/** Whether "Replace with…" can clear `uses`: cues alone use the item. */
export const isReplaceable = (uses: LibraryItemUses) =>
    uses.cues.length > 0 &&
    !uses.floor &&
    uses.items.length === 0 &&
    uses.pinnedBy.length === 0;

/**
 * What uses any Version of `itemId`, from `libraryReferences` (cues, the floor, the Item
 * tables) and other items' pins. History isn't a use: see `deleteShowLibraryItem`. Never writes.
 */
export async function libraryItemUses({
    db,
    itemId,
}: {
    db: DbConnection | DbTransaction;
    itemId: string;
}): Promise<LibraryItemUses> {
    const refs = (await libraryReferences({ db })).filter(
        (r) => r.itemId === itemId,
    );
    return {
        cues: await cueUses(
            db,
            refs.flatMap((r) => (r.source === "cues" ? [r.cueId] : [])),
        ),
        floor: refs.some((r) => r.source === "floor"),
        items: await itemUses(db, refs),
        pinnedBy: await pinnedBy(db, itemId),
    };
}

async function pinnedBy(
    db: DbConnection | DbTransaction,
    itemId: string,
): Promise<{ itemId: string; name: string }[]> {
    const found = new Map<string, string>();
    const others = await db
        .select({
            item_id: schema.library_items.item_id,
            name: schema.library_items.name,
            pins: schema.library_items.pins,
        })
        .from(schema.library_items)
        .orderBy(asc(schema.library_items.name))
        .all();
    for (const other of others) {
        if (other.item_id === itemId) continue;
        const pins = z.array(LibraryRefSchema).safeParse(safeJson(other.pins));
        // A row that can't be read might pin it, so it counts as a use
        if (!pins.success || pins.data.some((pin) => pin.itemId === itemId))
            found.set(other.item_id, other.name);
    }
    return [...found].map(([id, name]) => ({ itemId: id, name }));
}

/** The cues with ids `cueIds`, with their beat and tag, by beat. */
async function cueUses(
    db: DbConnection | DbTransaction,
    cueIds: readonly number[],
): Promise<LibraryCueUse[]> {
    if (cueIds.length === 0) return [];
    const ids = new Set(cueIds);
    const beats = await db
        .select({ id: schema.beats.id })
        .from(schema.beats)
        .orderBy(asc(schema.beats.position), asc(schema.beats.id))
        .all();
    const indexOf = new Map(beats.map((b, i) => [b.id, i]));
    const tags = new Map(
        (
            await db
                .select({ id: schema.tags.id, name: schema.tags.name })
                .from(schema.tags)
                .all()
        ).map((t) => [t.id, t.name]),
    );
    const cues: LibraryCueUse[] = [];
    for (const cue of await getCues({ db })) {
        if (!ids.has(cue.id)) continue;
        cues.push({
            cue,
            // A cue's beat always exists: deleting a beat moves or deletes its cues
            beatIndex: indexOf.get(cue.beatId) ?? 0,
            tagName:
                cue.target.kind === "tag"
                    ? (tags.get(cue.target.tagId) ?? null)
                    : null,
        });
    }
    return cues.sort(
        (a, b) => a.beatIndex - b.beatIndex || a.cue.id - b.cue.id,
    );
}

/** The props and equipment among `refs`, named, by name then slot. */
async function itemUses(
    db: DbConnection | DbTransaction,
    refs: readonly LibraryReference[],
): Promise<LibraryItemUse[]> {
    const raw = refs.flatMap(
        (r): { marcherId: number; slot: string | null }[] =>
            r.source === "itemModels"
                ? [{ marcherId: r.marcherId, slot: null }]
                : r.source === "itemArtworkSlots"
                  ? [{ marcherId: r.marcherId, slot: r.slot }]
                  : [],
    );
    if (raw.length === 0) return [];
    const marchers = await db
        .select({
            id: schema.marchers.id,
            name: schema.marchers.name,
            drill_prefix: schema.marchers.drill_prefix,
            drill_order: schema.marchers.drill_order,
        })
        .from(schema.marchers)
        .where(
            inArray(
                schema.marchers.id,
                raw.map((r) => r.marcherId),
            ),
        )
        .all();
    const labels = new Map(
        marchers.map((m) => [
            m.id,
            m.name?.trim() || `${m.drill_prefix}${m.drill_order}`,
        ]),
    );
    const seen = new Set<string>();
    const uses: LibraryItemUse[] = [];
    for (const r of raw) {
        const key = `${r.marcherId}:${r.slot ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        uses.push({
            ...r,
            label: labels.get(r.marcherId) ?? `#${r.marcherId}`,
        });
    }
    return uses.sort(
        (a, b) =>
            a.label.localeCompare(b.label) ||
            (a.slot ?? "").localeCompare(b.slot ?? ""),
    );
}

/**
 * What deleting a show's Library item did:
 *
 * - `deleted`: every Version and the blobs only it named are gone;
 * - `inUse`: cues, the floor, props or other items use it, and nothing changed;
 * - `keptForUndo`: nothing uses it now, but an undo or redo row names it, so it stays until a
 *   later prune finds nothing naming it (props-spec.md section 2: undoing an old edit must find
 *   the item it used). The show prunes when it closes. After "Replace with…" this is always the
 *   outcome: the replace is undoable.
 */
export type DeleteShowLibraryItemResult =
    | { outcome: "deleted" }
    | { outcome: "inUse"; uses: LibraryItemUses }
    | { outcome: "keptForUndo" };

async function deleteUnusedInTransaction(
    tx: DbTransaction,
    itemId: string,
): Promise<DeleteShowLibraryItemResult> {
    const history = await LIBRARY_REFERENCE_SOURCES.history.read(tx);
    if (history.some((r) => r.itemId === itemId))
        return { outcome: "keptForUndo" };
    await tx
        .delete(schema.library_items)
        .where(eq(schema.library_items.item_id, itemId))
        .run();
    // Every remaining Version is kept, so only orphan blobs go
    const remaining = await tx
        .selectDistinct({ item_id: schema.library_items.item_id })
        .from(schema.library_items)
        .all();
    await pruneShowLibraryInTransaction({
        tx,
        keep: remaining.map((r) => ({ itemId: r.item_id })),
    });
    return { outcome: "deleted" };
}

/**
 * What an item is for within its kind: an Artwork's surface (Silk, Base floor, Uniform part…) or
 * a model's kind (prop, equipment), from its sidecar; null for a Uniform or an unreadable
 * sidecar. "Replace with…" matches on it, so a Silk is never replaced with a floor.
 */
export function libraryRoleOf(
    kind: LibraryItemKind,
    sidecar: unknown,
): string | null {
    if (kind === "uniform" || typeof sidecar !== "object" || sidecar === null)
        return null;
    const { kind: modelKind, surface } = sidecar as {
        kind?: unknown;
        surface?: unknown;
    };
    const role = kind === "model" ? modelKind : surface;
    return typeof role === "string" ? role : null;
}

/** Throws unless `to` is embedded, of the same kind and role as `itemId`, and another item. */
async function assertReplacementInTransaction(
    tx: DbTransaction,
    itemId: string,
    to: LibraryRef,
): Promise<void> {
    const describe = async (where: ReturnType<typeof isLibraryVersion>) => {
        const row = await tx
            .select({
                kind: schema.library_items.kind,
                sidecar: schema.library_items.sidecar,
            })
            .from(schema.library_items)
            .where(where)
            .get();
        return row
            ? {
                  kind: row.kind,
                  role: libraryRoleOf(
                      row.kind as LibraryItemKind,
                      row.sidecar === null ? null : safeJson(row.sidecar),
                  ),
              }
            : undefined;
    };
    if (to.itemId === itemId)
        throw new Error(`Can't replace ${itemId} with itself`);
    const target = await describe(isLibraryVersion(to));
    if (!target)
        throw new Error(
            `The show doesn't have ${to.itemId}@${to.versionHash} to replace ${itemId} with`,
        );
    const from = await describe(eq(schema.library_items.item_id, itemId));
    if (from && from.kind !== target.kind)
        throw new Error(
            `Can't replace a ${from.kind} with a ${target.kind}: the kind must match`,
        );
    if (from && from.role !== target.role)
        throw new Error(
            `Can't replace a ${from.role ?? "plain"} ${from.kind} with a ${target.role ?? "plain"} one: the role must match`,
        );
}

/**
 * Deletes the show's copy of a Library item, every Version (props-spec.md section 2, [26.10]).
 *
 * Without `replaceWith`, it's refused while anything uses it (`libraryItemUses`: cues, the
 * show's floor, props and equipment, other items' pins). With it ("Replace with…"), every cue
 * naming the item is pointed at `replaceWith` first, as one undoable edit, in the same
 * transaction; any other use still refuses. The delete itself is never in
 * history, like embedding and pruning, so see {@link DeleteShowLibraryItemResult} for when the
 * item stays.
 */
export async function deleteShowLibraryItem({
    db,
    itemId,
    replaceWith,
}: {
    db: DbConnection;
    itemId: string;
    replaceWith?: LibraryRef;
}): Promise<DeleteShowLibraryItemResult> {
    if (!replaceWith)
        return await db.transaction(async (tx) => {
            const uses = await libraryItemUses({ db: tx, itemId });
            if (isInUse(uses)) return { outcome: "inUse", uses };
            return await deleteUnusedInTransaction(tx, itemId);
        });

    // Checked first, outside history: an undoable edit must change something
    const found = await db.transaction(async (tx) => {
        await assertReplacementInTransaction(tx, itemId, replaceWith);
        return await libraryItemUses({ db: tx, itemId });
    });
    if (!isInUse(found))
        return await db.transaction((tx) =>
            deleteUnusedInTransaction(tx, itemId),
        );
    if (!isReplaceable(found)) return { outcome: "inUse", uses: found };

    return await transactionWithHistory(
        db,
        "replaceLibraryItem",
        async (tx): Promise<DeleteShowLibraryItemResult> => {
            await assertReplacementInTransaction(tx, itemId, replaceWith);
            const uses = await libraryItemUses({ db: tx, itemId });
            // Something else started using it since: nothing is changed
            if (!isReplaceable(uses))
                throw new Error(`${itemId} is in use beyond its cues`);
            const value = libraryCueValue(replaceWith);
            await updateCuesInTransaction({
                tx,
                modifiedCues: uses.cues.map(({ cue }) => ({
                    id: cue.id,
                    value,
                })),
            });
            return await deleteUnusedInTransaction(tx, itemId);
        },
    );
}
