/**
 * Deleting the show's copy of a Library item (props-spec.md section 2, [26.10]), and what stops
 * it: everything `libraryReferences` names, and other items' pins. Kept apart from
 * `showLibrary.ts`, which the main process loads (convert on open, prune on close) and which
 * can't load history or the cue modules.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@om-electron/database/migrations/schema";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { getCues, updateCuesInTransaction, type DatabaseCue } from "./cues";
import type { LibraryItemKind } from "@om-electron/main/library/types";
import type { LibraryRef } from "@/view3d/library/showLibraryPrune";
import {
    libraryReferences,
    LIBRARY_REFERENCE_SOURCES,
    type LibraryReference,
} from "./libraryReferences";
import {
    isLibraryVersion,
    libraryCueValue,
    LibraryRefSchema,
    pruneShowLibraryInTransaction,
    safeJson,
} from "./showLibrary";

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
