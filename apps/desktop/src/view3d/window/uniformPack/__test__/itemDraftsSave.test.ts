/**
 * An edit typed while a save runs is never lost (fork #1287 hands-on re-test). The editor stores
 * a save, and the 3D View's venue can name the new version before the save's answer reaches the
 * window. The draft used to read that unknown version as an Undo and end, dropping the edits made
 * since and showing the older stored values in the fields.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UniformPackItem } from "@/view3d/core/uniformPack/format";
import type { UniformPackValue } from "@/view3d/core/marchers/uniformArtwork";

const answers: ((value: { value: string; token: string }) => void)[] = [];
const expects: string[] = [];
vi.mock("@/hooks/queries/useUniformPack", () => ({
    readStoredUniformPackBytes: async (value: string) => ({
        value,
        name: "fjm-page",
        bytes: new Uint8Array([1]),
    }),
}));
vi.mock("@/view3d/uniformPack/runUniformPackJob", () => ({
    runUniformPackJob: async () => ({
        type: "packFile",
        bytes: new Uint8Array([2]),
    }),
}));
vi.mock("../storeUniformPack", () => ({
    UniformPackStoreError: class extends Error {},
    storeUniformItemsPack: (
        _bytes: Uint8Array,
        { expect }: { expect: string },
    ) => {
        expects.push(expect);
        return new Promise((resolve) => answers.push(resolve));
    },
}));

const { editItems, itemListState, observeWorn, useItemDrafts } =
    await import("../itemDrafts");

const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const v = (n: number) =>
    `library:${ID}@${String(n).repeat(64)}` as UniformPackValue;
const crest = (x: number): UniformPackItem => ({
    id: "crest",
    file: "items/crest.png",
    panel: "front",
    at: [x, 25.32],
    width: 6,
});
const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};
const xOf = (items: readonly UniformPackItem[]) => items[0].at[0];

describe("an edit typed while a save runs", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        answers.length = 0;
        expects.length = 0;
    });
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        useItemDrafts.setState({ draft: null, saving: false, failed: false });
    });

    it("keeps it when the venue shows the running save's result before its answer", async () => {
        const stored = [crest(17)];
        observeWorn(v(1), true);
        // Across 14, saved after a pause
        editItems(v(1), stored, () => [crest(14)]);
        await vi.advanceTimersByTimeAsync(800);
        await flush();
        expect(answers).toHaveLength(1);
        expect(expects).toEqual([v(1)]);
        // Across 12, typed while that save runs
        editItems(v(1), stored, () => [crest(12)]);
        // the editor stored v2; the window's venue shows it before the answer arrives, its pack
        // still loading (the list's stored items are v1's, a placeholder)
        observeWorn(v(2), false);
        const draft = useItemDrafts.getState().draft;
        expect(
            draft,
            "the draft must not end on the save's own result",
        ).not.toBeNull();
        const shown = itemListState(draft, v(2), stored, true);
        expect(shown.editable).toBe(true);
        expect(xOf(shown.items)).toBe(12);
        // the answer arrives: v2. The draft goes on, and saves Across 12 from v2
        answers[0]({ value: v(2), token: "t" });
        await flush();
        await vi.advanceTimersByTimeAsync(800);
        await flush();
        expect(useItemDrafts.getState().draft).not.toBeNull();
        expect(xOf(useItemDrafts.getState().draft!.items)).toBe(12);
        expect(expects).toEqual([v(1), v(2)]);
        // and once that's saved and shown, the draft ends with nothing lost
        answers[1]({ value: v(3), token: "t" });
        await flush();
        observeWorn(v(3), true);
        expect(useItemDrafts.getState().draft).toBeNull();
    });

    it("lets an Undo after the save win, once the answer comes", async () => {
        observeWorn(v(1), true);
        editItems(v(1), [crest(17)], () => [crest(14)]);
        await vi.advanceTimersByTimeAsync(800);
        await flush();
        // the save lands (v2) and the venue shows it, then Undo puts it back to v1
        observeWorn(v(2), false);
        observeWorn(v(1), true);
        answers[0]({ value: v(2), token: "t" });
        await flush();
        expect(useItemDrafts.getState().draft).toBeNull();
    });

    it("ends the draft if the saved version never reaches the venue", async () => {
        observeWorn(v(1), true);
        editItems(v(1), [crest(17)], () => [crest(14)]);
        await vi.advanceTimersByTimeAsync(800);
        await flush();
        answers[0]({ value: v(2), token: "t" });
        await flush();
        // not yet: the venue may only be slow
        expect(useItemDrafts.getState().draft).not.toBeNull();
        await vi.advanceTimersByTimeAsync(4100);
        expect(useItemDrafts.getState().draft).toBeNull();
    });
});
