/**
 * Which saved pack a drawn item draft reads its layers from (fork #1258): the draft's newest,
 * resolved when composing, since a burst's save removes the version a revision was drawn over.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UniformPackItem } from "@/view3d/core/uniformPack/format";
import type { UniformPackValue } from "@/view3d/core/marchers/uniformArtwork";
import {
    draftKey,
    draftOrigin,
    editItems,
    itemListState,
    observeWorn,
    resetItemDraftsForTests,
    useItemDrafts,
    type ItemDraft,
} from "../itemDrafts";

const v = (n: number) =>
    `library:pack@${String(n).repeat(64)}` as UniformPackValue;

const draft = (latest: UniformPackValue): ItemDraft => ({
    origin: v(1),
    latest,
    previous: null,
    arrived: true,
    items: [],
    images: {},
    revision: 3,
    shown: 3,
    saved: 2,
});

describe("item drafts", () => {
    afterEach(() => resetItemDraftsForTests());

    it("reads a live draft's newest saved pack, not the one it was drawn over", () => {
        const key = draftKey(v(1), 3);
        useItemDrafts.setState({ draft: draft(v(2)) });
        expect(draftOrigin(key)).toBe(v(2));
        // a save lands and removes v(2): the same key now reads v(3)
        useItemDrafts.setState({ draft: draft(v(3)) });
        expect(draftOrigin(key)).toBe(v(3));
    });

    it("falls back to the key's own pack once the draft has ended", () => {
        expect(draftOrigin(draftKey(v(1), 3))).toBe(v(1));
        expect(draftOrigin(v(4))).toBe(v(4));
    });
});

const item = (id: string, width: number): UniformPackItem => ({
    id,
    file: `items/${id}.png`,
    panel: "front",
    at: [17, 25.32],
    width,
});

describe("an edit right after a save or an Undo (#1287 re-review)", () => {
    afterEach(() => {
        resetItemDraftsForTests();
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    // P: the version before, with a crest and a number. The draft deleted the number and was
    // saved as N, which the venue now names, but N's pack is still loading, so the list's stored
    // items are P's (a placeholder).
    const P = v(1);
    const N = v(2);
    const pItems = [item("crest", 6), item("number", 8)];
    const saved: ItemDraft = {
        origin: P,
        latest: N,
        previous: P,
        arrived: false,
        items: [item("crest", 6)],
        images: {},
        revision: 2,
        shown: 2,
        saved: 2,
    };

    it("keeps showing the draft's items while the saved version loads, and an edit keeps the earlier change", () => {
        vi.useFakeTimers();
        useItemDrafts.setState({ draft: saved, saving: false });
        // the venue reaches N; N's pack hasn't loaded
        observeWorn(N, false);
        const draft = useItemDrafts.getState().draft;
        expect(draft).not.toBeNull();
        const shown = itemListState(draft, N, pItems, true);
        // not the deleted number coming back
        expect(shown).toEqual({ items: [item("crest", 6)], editable: true });
        // resizing the crest now edits the draft's items, so the number stays deleted
        editItems(N, pItems, (list) =>
            list.map((i) => (i.id === "crest" ? { ...i, width: 7 } : i)),
        );
        expect(useItemDrafts.getState().draft?.items).toEqual([
            item("crest", 7),
        ]);
        // once N's pack has loaded and everything is saved, the draft ends
        useItemDrafts.setState({
            draft: { ...useItemDrafts.getState().draft!, saved: 3 },
        });
        observeWorn(N, true);
        expect(useItemDrafts.getState().draft).toBeNull();
    });

    it("ends the draft once the saved version's own pack has loaded", () => {
        useItemDrafts.setState({ draft: saved, saving: false });
        observeWorn(N, true);
        expect(useItemDrafts.getState().draft).toBeNull();
    });

    it("makes the list read only after an Undo until the version undone to has loaded", () => {
        useItemDrafts.setState({ draft: { ...saved, arrived: true } });
        // Undo: the venue goes back to P, whose pack isn't loaded; the list's stored items are
        // N's as a placeholder
        observeWorn(P, false);
        expect(useItemDrafts.getState().draft).toBeNull();
        const nItems = [item("crest", 6)];
        expect(itemListState(null, P, nItems, true)).toEqual({
            items: nItems,
            editable: false,
        });
        // P's own pack loads: its items, editable
        expect(itemListState(null, P, pItems, false)).toEqual({
            items: pItems,
            editable: true,
        });
    });
});
