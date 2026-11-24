/**
 * Editing the placed items and the modes of the band's imported uniform (fork #1258, and step 5 of
 * fork #1257; docs/3d/uniform-artwork.md, "Placing items" and "Modes and variants"). Both live in
 * the uniform pack, so every change is a new pack file stored by the editor with undo, like any
 * venue change. A draft holds the pack's layers, items and modes together, so an item edit and a
 * mode edit in one burst are one undo step. Writing and storing a pack takes a second or
 * two, so the window keeps a **draft**: the 3D View draws the draft's items at once, and the
 * draft is saved a moment after the last change (at once for adding and removing). Changes made
 * while a save runs are saved right after it.
 *
 * - The draft belongs to the pack the band wears (`latest`). Once the venue shows the saved pack
 *   and nothing is left to save, the draft ends and the stored pack draws the same thing.
 * - If the venue moves to anything else (Undo, or another uniform picked), the draft ends and
 *   unsaved changes are dropped: Undo wins.
 * - The draft's 3D View key is `<origin>~<revision>`, so atlases for each drawn revision are
 *   composed and cached like any other look's (`flatsAtlas.ts` reads them back with
 *   {@link drawnDraft}).
 *
 * **One undo step per burst.** Edits with less than {@link BURST_IDLE_MS} between them are one
 * burst: its first save is an undo step from where it started, and each later save amends it
 * (the editor checks the step is still the latest), replacing the burst's previous version. So
 * a burst leaves two versions in the show, its origin and its latest. A save carries `expect`,
 * the pack it was made from: if the venue moved on meanwhile (Undo, another uniform), the editor
 * stores nothing, and the save can't override the Undo or clear Redo.
 *
 * New images are decoded in the uniform pack worker before they get here.
 */
import { create } from "zustand";
import {
    type UniformPackItem,
    UNIFORM_PACK_MAX_ITEMS,
} from "@/view3d/core/uniformPack/format";
import {
    tidyContents,
    type PackContents,
} from "@/view3d/core/uniformPack/modeEdits";
import type { UniformPackValue } from "@/view3d/core/marchers/uniformArtwork";
import { readStoredUniformPackBytes } from "@/hooks/queries/useUniformPack";
import { parseShowAssetRef } from "@/showAssets/ref";
import { runUniformPackJob } from "@/view3d/uniformPack/runUniformPackJob";
import {
    UniformPackStoreError,
    storeUniformItemsPack,
} from "./storeUniformPack";

/** A new item image: what the pack stores, and the decoded bitmap the window draws */
export interface ItemImage {
    png: Uint8Array;
    bitmap: ImageBitmap;
}

export interface ItemDraft {
    /** The pack the edits started from; its item images are the draft's too */
    origin: UniformPackValue;
    /** The newest pack the draft has: the origin, then each saved one */
    latest: UniformPackValue;
    /** The pack before `latest`, while the venue hasn't shown `latest` yet */
    previous: UniformPackValue | null;
    /** Whether the venue has shown `latest` */
    arrived: boolean;
    /** The pack's layers, items and modes as edited */
    contents: PackContents;
    /** Item images added in this draft, by file */
    images: Record<string, ItemImage>;
    /**
     * Layer images added in this draft (a mode's overlay), by file: the page PNG the pack stores,
     * already checked in the uniform pack worker
     */
    layerImages: Record<string, Uint8Array>;
    revision: number;
    /** The revision the 3D View draws (a moment behind while typing) */
    shown: number;
    /** The revision `latest` holds */
    saved: number;
}

interface ItemDraftState {
    draft: ItemDraft | null;
    saving: boolean;
    /** The last save failed */
    failed: boolean;
}

export const useItemDrafts = create<ItemDraftState>(() => ({
    draft: null,
    saving: false,
    failed: false,
}));

/** How long after the last change the 3D View redraws, ms */
const SHOW_DELAY_MS = 120;
/** How long after the last change a draft is saved, ms */
const SAVE_DELAY_MS = 700;

/** Edits closer together than this are one burst: one undo step, two versions, ms */
export const BURST_IDLE_MS = 4000;

/** The editing burst: the pack its last save made, and the token to amend its undo step */
let burst: { value: string; token: string } | null = null;
let lastEditAt = 0;

let showTimer: ReturnType<typeof setTimeout> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Drawn drafts by key, for the atlas composer; the last few are kept */
const drawn = new Map<
    string,
    {
        /** The saved pack its layers and older item images are read from: the newest one */
        origin: UniformPackValue;
        contents: PackContents;
        images: Record<string, ItemImage>;
        layerImages: Record<string, Uint8Array>;
    }
>();
const DRAWN_KEPT = 6;

/** The 3D View key of a draft revision */
export const draftKey = (origin: UniformPackValue, revision: number) =>
    `${origin}~${revision}` as UniformPackValue;

/** What a draft key draws, or null for a pack's own value */
export function drawnDraft(key: string) {
    return key.includes("~") ? (drawn.get(key) ?? null) : null;
}

/**
 * The saved pack a draft key is drawn over: its layers and older item images. Resolved when a
 * composition starts, not when the revision was drawn: a burst's save removes the version it
 * replaces, so a revision drawn while a save ran may name a version that is gone by then. While
 * the key's draft is live, that's the draft's newest saved pack; otherwise the newest it knew.
 */
export function draftOrigin(key: string): UniformPackValue {
    const live = useItemDrafts.getState().draft;
    if (live && key.startsWith(`${live.origin}~`)) return live.latest;
    return (drawn.get(key)?.origin ?? key.split("~")[0]) as UniformPackValue;
}

function remember(draft: ItemDraft) {
    const key = draftKey(draft.origin, draft.shown);
    drawn.set(key, {
        // a burst's earlier versions are removed as it saves, so read the newest
        origin: draft.latest,
        contents: draft.contents,
        images: draft.images,
        layerImages: draft.layerImages,
    });
    while (drawn.size > DRAWN_KEPT) drawn.delete(drawn.keys().next().value!);
}

/** Whether `draft` is the edit of `worn`, the pack the band wears */
export const draftApplies = (
    draft: ItemDraft | null,
    worn: UniformPackValue | null,
): draft is ItemDraft =>
    !!draft &&
    !!worn &&
    (worn === draft.latest || (!draft.arrived && worn === draft.previous));

/**
 * The key the 3D View draws for the band's `worn` pack: the draft's while it applies to it and
 * has a drawn revision, otherwise `worn` itself.
 */
export function wornKey(
    draft: ItemDraft | null,
    worn: UniformPackValue,
): UniformPackValue {
    return draftApplies(draft, worn) && draft.shown > 0
        ? draftKey(draft.origin, draft.shown)
        : worn;
}

/** The layers, items and modes the lists show for the band's `worn` pack, whose own are `stored` */
export function contentsFor(
    draft: ItemDraft | null,
    worn: UniformPackValue,
    stored: PackContents,
): PackContents {
    return draftApplies(draft, worn) ? draft.contents : stored;
}

/** The items the list shows for the band's `worn` pack, whose own contents are `stored` */
export const itemsFor = (
    draft: ItemDraft | null,
    worn: UniformPackValue,
    stored: PackContents,
): UniformPackItem[] => contentsFor(draft, worn, stored).items;

function end() {
    if (showTimer) clearTimeout(showTimer);
    if (saveTimer) clearTimeout(saveTimer);
    showTimer = saveTimer = null;
    useItemDrafts.setState({ draft: null });
}

/**
 * Tells the drafts what the venue's band wears now. Ends the draft once the venue shows its
 * saved pack with nothing left to save, or when the venue moves anywhere else (Undo wins).
 */
export function observeWorn(worn: UniformPackValue | null) {
    const { draft, saving } = useItemDrafts.getState();
    if (!draft) return;
    if (worn === draft.latest) {
        if (!draft.arrived)
            useItemDrafts.setState({ draft: { ...draft, arrived: true } });
        if (draft.saved === draft.revision && !saving) end();
        return;
    }
    if (!draft.arrived && worn === draft.previous) return;
    end();
}

export interface PackEditOptions {
    /** The images of any new item, by file */
    images?: Record<string, ItemImage>;
    /** The page PNGs of any new layer, by file */
    layerImages?: Record<string, Uint8Array>;
    /** Save at once (adding and removing), not a moment later */
    now?: boolean;
}

/**
 * Applies an edit to the items of `worn`, the pack the band wears, whose own contents are
 * `stored`: `edit` returns the whole new list. A new item shows in every mode, and a removed one
 * leaves them.
 */
export const editItems = (
    worn: UniformPackValue,
    stored: PackContents,
    edit: (items: UniformPackItem[]) => UniformPackItem[],
    options?: PackEditOptions,
) =>
    editPack(
        worn,
        stored,
        (contents) => ({
            ...contents,
            items: edit(contents.items).slice(0, UNIFORM_PACK_MAX_ITEMS),
        }),
        options,
    );

/**
 * Applies an edit to the layers, items and modes of `worn`, the pack the band wears, whose own
 * contents are `stored`; the result is kept valid ({@link tidyContents}). Saves a moment later, or
 * at once with `now`.
 */
export function editPack(
    worn: UniformPackValue,
    stored: PackContents,
    edit: (contents: PackContents) => PackContents,
    { images = {}, layerImages = {}, now = false }: PackEditOptions = {},
) {
    const at = Date.now();
    if (at - lastEditAt > BURST_IDLE_MS) burst = null;
    lastEditAt = at;
    const current = useItemDrafts.getState().draft;
    const live = draftApplies(current, worn) ? current : null;
    const base: ItemDraft = live ?? {
        origin: worn,
        latest: worn,
        previous: null,
        arrived: true,
        contents: stored,
        images: {},
        layerImages: {},
        revision: 0,
        shown: 0,
        saved: 0,
    };
    const contents = tidyContents(edit(base.contents), base.contents);
    const draft: ItemDraft = {
        ...base,
        contents,
        images: { ...base.images, ...images },
        layerImages: { ...base.layerImages, ...layerImages },
        revision: base.revision + 1,
    };
    useItemDrafts.setState({ draft, failed: false });
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(() => {
        showTimer = null;
        const d = useItemDrafts.getState().draft;
        if (!d) return;
        const next = { ...d, shown: d.revision };
        remember(next);
        useItemDrafts.setState({ draft: next });
    }, SHOW_DELAY_MS);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(
        () => {
            saveTimer = null;
            void save();
        },
        now ? 0 : SAVE_DELAY_MS,
    );
}

/** Saves the draft's contents as a new pack, then any changes made meanwhile */
async function save(): Promise<void> {
    const state = useItemDrafts.getState();
    if (state.saving || !state.draft) return;
    const draft = state.draft;
    if (draft.saved === draft.revision) return;
    useItemDrafts.setState({ saving: true });
    const revision = draft.revision;
    try {
        const stored = await readStoredUniformPackBytes(draft.latest);
        if (!stored) throw new Error("the show no longer has this uniform");
        const files: Record<string, Uint8Array> = {};
        // copies: the draft keeps its own
        for (const item of draft.contents.items) {
            const image = draft.images[item.file];
            if (image) files[item.file] = image.png.slice();
        }
        for (const layer of draft.contents.layers) {
            const png = draft.layerImages[layer.file];
            if (png) files[layer.file] = png.slice();
        }
        const result = await runUniformPackJob({
            type: "withContents",
            // a copy: the stored bytes are shared through the blob cache
            bytes: stored.bytes.slice(),
            contents: draft.contents,
            files,
        });
        if (result.type !== "packFile")
            throw new Error("the uniform wasn't written");
        // a burst that went idle before this save ends here
        if (Date.now() - lastEditAt > BURST_IDLE_MS) burst = null;
        const amend =
            burst && burst.value === draft.latest ? burst.token : undefined;
        const saved = await storeUniformItemsPack(result.bytes, {
            versionOf: parseShowAssetRef(draft.latest)?.id,
            expect: draft.latest,
            amend,
        });
        const value = saved.value as UniformPackValue;
        burst = saved.token ? { value, token: saved.token } : null;
        const now = useItemDrafts.getState().draft;
        // the draft ended meanwhile (Undo, another uniform): the save stands, the draft doesn't
        if (now && now.origin === draft.origin && now.latest === draft.latest) {
            const next: ItemDraft =
                value === now.latest
                    ? { ...now, saved: revision }
                    : {
                          ...now,
                          previous: now.latest,
                          latest: value,
                          arrived: false,
                          saved: revision,
                      };
            remember(next);
            useItemDrafts.setState({ draft: next });
        }
    } catch (error) {
        burst = null;
        if (
            error instanceof UniformPackStoreError &&
            error.reason === "superseded"
        ) {
            // the venue moved on (Undo, another uniform): the edit is dropped, as Undo wins
            end();
        } else {
            console.warn("3D View: couldn't save the uniform's edit", error);
            useItemDrafts.setState({ failed: true });
            end();
        }
    } finally {
        useItemDrafts.setState({ saving: false });
    }
    const after = useItemDrafts.getState().draft;
    if (after && after.saved < after.revision && !saveTimer) await save();
}

/** A new item id, and its image's file, unused by `items` and `taken` files */
export function newItemId(
    items: readonly UniformPackItem[],
    taken: Iterable<string> = [],
): { id: string; file: string } {
    const ids = new Set(items.map((i) => i.id));
    const files = new Set([...items.map((i) => i.file), ...taken]);
    for (let n = 1; ; n++) {
        const id = `item-${n}`;
        const file = `items/${id}.png`;
        if (!ids.has(id) && !files.has(file)) return { id, file };
    }
}
