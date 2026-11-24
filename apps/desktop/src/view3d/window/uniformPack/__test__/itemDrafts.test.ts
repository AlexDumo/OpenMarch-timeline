/**
 * Which saved pack a drawn item draft reads its layers from (fork #1258): the draft's newest,
 * resolved when composing, since a burst's save removes the version a revision was drawn over.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UniformPackValue } from "@/view3d/core/marchers/uniformArtwork";
import { addMode, contentsOf } from "@/view3d/core/uniformPack/modeEdits";
import { sampleManifest } from "@/view3d/core/uniformPack/__test__/fixtures";
import {
    draftKey,
    draftOrigin,
    editItems,
    editPack,
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
    contents: { layers: [], items: [], modes: [] },
    images: {},
    layerImages: {},
    revision: 3,
    shown: 3,
    saved: 2,
});

describe("item drafts", () => {
    afterEach(() => useItemDrafts.setState({ draft: null }));

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

describe("one draft for items and modes (#1257 step 5)", () => {
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        useItemDrafts.setState({ draft: null, saving: false });
    });

    it("keeps mode and item edits in one draft, a new item showing in every mode", () => {
        vi.useFakeTimers();
        const stored = contentsOf(sampleManifest("Cadets 2019"));
        editPack(
            v(1),
            stored,
            (c) =>
                addMode(c, { name: "Sash out", defaultName: "Plain" }).contents,
            { now: true },
        );
        editItems(v(1), stored, (items) => [
            ...items,
            {
                id: "crest",
                file: "items/crest.png",
                panel: "front",
                at: [17, 25.32],
                width: 6,
            },
        ]);
        const d = useItemDrafts.getState().draft!;
        expect(d.revision).toBe(2);
        expect(d.contents.modes.map((m) => m.name)).toEqual([
            "Plain",
            "Sash out",
        ]);
        expect(d.contents.modes.every((m) => m.items.includes("crest"))).toBe(
            true,
        );
        // removing the item takes it out of every mode
        editItems(v(1), stored, () => []);
        expect(
            useItemDrafts
                .getState()
                .draft!.contents.modes.every((m) => m.items.length === 0),
        ).toBe(true);
    });
});
