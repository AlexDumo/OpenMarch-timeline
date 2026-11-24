/**
 * Which saved pack a drawn item draft reads its layers from (fork #1258): the draft's newest,
 * resolved when composing, since a burst's save removes the version a revision was drawn over.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { UniformPackValue } from "@/view3d/core/marchers/uniformArtwork";
import {
    draftKey,
    draftOrigin,
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
