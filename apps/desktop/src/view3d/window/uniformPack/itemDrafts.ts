/**
 * Editing the placed items of the band's imported uniform (fork #1258; docs/3d/uniform-artwork.md,
 * "Placing items"). Items live in the uniform pack, so every change is a new pack file stored
 * by the editor with undo, like any venue change. Writing and storing a pack takes a second or
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
    items: UniformPackItem[];
    /** Images added in this draft, by file */
    images: Record<string, ItemImage>;
    revision: number;
    /** The revision the 3D View draws (a moment behind while typing) */
    shown: number;
    /** The revision `latest` holds */
    saved: number;
    /**
     * A save of this draft is running. Its result can reach the venue before its answer reaches
     * the window, so meanwhile a version of the same uniform the draft doesn't know yet is taken
     * as that result, not as an Undo (fork #1287: that ended the draft and lost the edits made
     * since, and the fields showed the older stored values)
     */
    inFlight?: boolean;
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
        items: UniformPackItem[];
        images: Record<string, ItemImage>;
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
        items: draft.items,
        images: draft.images,
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
    (worn === draft.latest ||
        (!draft.arrived && worn === draft.previous) ||
        (!!draft.inFlight && sameUniform(worn, draft.latest)));

/** Whether two values name versions of the same uniform asset */
const sameUniform = (a: string, b: string) => {
    const id = parseShowAssetRef(a)?.id;
    return id !== undefined && id === parseShowAssetRef(b)?.id;
};

/** What the venue last named, and whether its pack had loaded, for a save to reconcile with */
let lastWorn: UniformPackValue | null = null;
let lastLoaded = false;
/** What the venue named while the running save ran */
const seenInFlight = new Set<string>();
/** How long a saved version has to reach the venue before the draft takes it as gone, ms */
const ARRIVE_MS = 4000;
let arriveTimer: ReturnType<typeof setTimeout> | null = null;

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

/** The items the list shows for the band's `worn` pack whose own items are `stored` */
export function itemsFor(
    draft: ItemDraft | null,
    worn: UniformPackValue,
    stored: UniformPackItem[],
): UniformPackItem[] {
    return draftApplies(draft, worn) ? draft.items : stored;
}

function end() {
    if (showTimer) clearTimeout(showTimer);
    if (saveTimer) clearTimeout(saveTimer);
    if (arriveTimer) clearTimeout(arriveTimer);
    showTimer = saveTimer = arriveTimer = null;
    useItemDrafts.setState({ draft: null });
}

/**
 * Tells the drafts what the venue's band wears now. Ends the draft once the venue shows its
 * saved pack with nothing left to save and that pack has loaded, or when the venue moves
 * anywhere else (Undo wins).
 */
export function observeWorn(
    worn: UniformPackValue | null,
    /**
     * Whether `worn`'s own pack has loaded (not a placeholder from the version before): until it
     * has, the stored items on screen are the old version's, so the draft keeps showing its own
     */
    loaded: boolean,
) {
    lastWorn = worn;
    lastLoaded = loaded;
    const { draft, saving } = useItemDrafts.getState();
    if (!draft) return;
    if (draft.inFlight && worn) seenInFlight.add(worn);
    // possibly the running save's result: wait for its answer (`save` reconciles)
    if (
        worn !== draft.latest &&
        worn !== draft.previous &&
        draft.inFlight &&
        worn !== null &&
        sameUniform(worn, draft.latest)
    )
        return;
    if (worn === draft.latest) {
        if (!draft.arrived)
            useItemDrafts.setState({ draft: { ...draft, arrived: true } });
        if (draft.saved === draft.revision && !saving && loaded) end();
        return;
    }
    if (!draft.arrived && worn === draft.previous) return;
    end();
}

/**
 * Applies an edit to the items of `worn`, the pack the band wears: `items` is the whole new
 * list, and `images` holds the files of any new item. Saves a moment later, or at once with
 * `now` (adding and removing).
 */
export function editItems(
    worn: UniformPackValue,
    stored: UniformPackItem[],
    edit: (items: UniformPackItem[]) => UniformPackItem[],
    {
        images = {},
        now = false,
    }: { images?: Record<string, ItemImage>; now?: boolean } = {},
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
        items: stored,
        images: {},
        revision: 0,
        shown: 0,
        saved: 0,
    };
    const items = edit(base.items).slice(0, UNIFORM_PACK_MAX_ITEMS);
    const draft: ItemDraft = {
        ...base,
        items,
        images: { ...base.images, ...images },
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

/** Saves the draft's items as a new pack, then any changes made meanwhile */
async function save(): Promise<void> {
    const state = useItemDrafts.getState();
    if (state.saving || !state.draft) return;
    const draft = state.draft;
    if (draft.saved === draft.revision) return;
    // only what the venue names while this runs: a save can reproduce an older version's bytes
    // (an item put back where it was), so a version named before it started proves nothing
    seenInFlight.clear();
    useItemDrafts.setState({
        saving: true,
        draft: { ...draft, inFlight: true },
    });
    const revision = draft.revision;
    try {
        const stored = await readStoredUniformPackBytes(draft.latest);
        if (!stored) throw new Error("the show no longer has this uniform");
        const files: Record<string, Uint8Array> = {};
        for (const item of draft.items) {
            const image = draft.images[item.file];
            // a copy: the draft keeps its own
            if (image) files[item.file] = image.png.slice();
        }
        const result = await runUniformPackJob({
            type: "withItems",
            // a copy: the stored bytes are shared through the blob cache
            bytes: stored.bytes.slice(),
            items: draft.items,
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
        // the draft ended meanwhile (another uniform): the save stands, the draft doesn't
        if (now && now.origin === draft.origin && now.latest === draft.latest) {
            const next: ItemDraft =
                value === now.latest
                    ? { ...now, saved: revision, inFlight: false }
                    : {
                          ...now,
                          previous: now.latest,
                          latest: value,
                          // the venue may have shown it already, before this answer
                          arrived: lastWorn === value,
                          saved: revision,
                          inFlight: false,
                      };
            remember(next);
            useItemDrafts.setState({ draft: next, saving: false });
            if (lastWorn !== value && seenInFlight.has(value)) {
                // the venue showed this save, then moved on: an Undo after it, which wins
                end();
            } else {
                // what the venue names now: this save's result, or not yet
                observeWorn(lastWorn, lastLoaded);
                const d = useItemDrafts.getState().draft;
                if (d && !d.arrived) {
                    // a venue that never shows it went elsewhere (an Undo the window saw
                    // only as no change): end the draft then
                    if (arriveTimer) clearTimeout(arriveTimer);
                    const waiting = d.latest;
                    arriveTimer = setTimeout(() => {
                        arriveTimer = null;
                        const { draft: now, saving } = useItemDrafts.getState();
                        // only with nothing saving or left to save: a pending save's `expect`
                        // decides instead (the editor refuses it if the venue moved on)
                        if (
                            now &&
                            !now.arrived &&
                            now.latest === waiting &&
                            now.saved === now.revision &&
                            !saving
                        )
                            end();
                    }, ARRIVE_MS);
                }
            }
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
            console.warn("3D View: couldn't save the uniform's items", error);
            useItemDrafts.setState({ failed: true });
            end();
        }
    } finally {
        const d = useItemDrafts.getState().draft;
        useItemDrafts.setState({
            saving: false,
            ...(d?.inFlight ? { draft: { ...d, inFlight: false } } : {}),
        });
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

/**
 * What the item list shows for the band's `worn` pack: the draft's items while it applies,
 * otherwise the stored ones. The list can be edited unless the stored items on screen are a
 * placeholder (the version before, while `worn`'s own pack loads): an edit made on those would
 * save the old version's items over the new one, undoing a save or an Undo.
 */
export function itemListState(
    draft: ItemDraft | null,
    worn: UniformPackValue,
    stored: UniformPackItem[],
    placeholder: boolean,
): { items: UniformPackItem[]; editable: boolean } {
    if (draftApplies(draft, worn))
        return { items: draft.items, editable: true };
    return { items: stored, editable: !placeholder };
}

/** Puts the module back as it starts, for tests that mustn't depend on each other's order */
export function resetItemDraftsForTests() {
    end();
    burst = null;
    lastEditAt = 0;
    lastWorn = null;
    lastLoaded = false;
    seenInFlight.clear();
    useItemDrafts.setState({ draft: null, saving: false, failed: false });
}
