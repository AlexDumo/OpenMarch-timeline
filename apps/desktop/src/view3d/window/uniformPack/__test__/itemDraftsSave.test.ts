/**
 * Edits made while the band's uniform saves are never lost, and an Undo still wins (fork #1287
 * hands-on re-test and re-reviews). The editor stores a save, and the 3D View's venue can name
 * the new version before the save's answer reaches the window; the venue can also skip a version
 * altogether, and a save can reproduce an older version's bytes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UniformPackItem } from "@/view3d/core/uniformPack/format";
import type { UniformPackValue } from "@/view3d/core/marchers/uniformArtwork";

interface Pending {
    expect: string;
    resolve: (value: { value: string; token: string }) => void;
    reject: (error: Error) => void;
}
const saves: Pending[] = [];
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
vi.mock("../storeUniformPack", () => {
    class UniformPackStoreError extends Error {
        constructor(readonly reason: string) {
            super(reason);
        }
    }
    return {
        UniformPackStoreError,
        storeUniformItemsPack: (
            _bytes: Uint8Array,
            { expect }: { expect: string },
        ) =>
            new Promise((resolve, reject) =>
                saves.push({ expect, resolve, reject }),
            ),
    };
});

const {
    editItems,
    itemListState,
    observeWorn,
    resetItemDraftsForTests,
    useItemDrafts,
} = await import("../itemDrafts");
const { UniformPackStoreError } = await import("../storeUniformPack");

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
const draft = () => useItemDrafts.getState().draft;
const xOf = () => draft()!.items[0].at[0];
/** Types Across `x`, then lets the save's pause pass */
const type = async (worn: UniformPackValue, x: number, wait = true) => {
    editItems(worn, [crest(17)], () => [crest(x)]);
    if (wait) {
        await vi.advanceTimersByTimeAsync(800);
        await flush();
    }
};
const answer = async (i: number, value: UniformPackValue) => {
    saves[i].resolve({ value, token: "t" });
    await flush();
};

describe("edits while the band's uniform saves", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        saves.length = 0;
        resetItemDraftsForTests();
    });
    afterEach(() => {
        resetItemDraftsForTests();
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it("keeps an edit typed while a save runs when the venue shows that save before its answer", async () => {
        observeWorn(v(1), true);
        await type(v(1), 14);
        expect(saves.map((s) => s.expect)).toEqual([v(1)]);
        // Across 12, typed while that save runs
        await type(v(1), 12, false);
        // the editor stored v2, and the venue shows it before the answer (its pack loading)
        observeWorn(v(2), false);
        expect(
            draft(),
            "the draft must not end on its own save",
        ).not.toBeNull();
        const shown = itemListState(draft(), v(2), [crest(17)], true);
        expect(shown.editable).toBe(true);
        expect(shown.items[0].at[0]).toBe(12);
        await answer(0, v(2));
        await vi.advanceTimersByTimeAsync(800);
        await flush();
        expect(xOf()).toBe(12);
        expect(saves.map((s) => s.expect)).toEqual([v(1), v(2)]);
        await answer(1, v(3));
        observeWorn(v(3), true);
        expect(draft()).toBeNull();
    });

    it("lets an Undo made after the save landed win, once the answer comes", async () => {
        observeWorn(v(1), true);
        await type(v(1), 14);
        observeWorn(v(2), false);
        observeWorn(v(1), true);
        await answer(0, v(2));
        expect(draft()).toBeNull();
    });

    it("drops the edit when Undo or another uniform comes before the save is stored", async () => {
        observeWorn(v(1), true);
        await type(v(1), 14);
        // the editor refuses: the venue no longer names v1
        saves[0].reject(new UniformPackStoreError("superseded"));
        await flush();
        expect(draft()).toBeNull();
        expect(useItemDrafts.getState().failed).toBe(false);
    });

    it("follows Undo then Redo after a save: the draft ends, and the next edit starts from the redone version", async () => {
        observeWorn(v(1), true);
        await type(v(1), 14);
        observeWorn(v(2), false);
        await answer(0, v(2));
        observeWorn(v(2), true);
        expect(draft(), "saved and shown: done").toBeNull();
        // Undo, then Redo
        observeWorn(v(1), true);
        observeWorn(v(2), true);
        expect(draft()).toBeNull();
        await type(v(2), 10);
        expect(saves.at(-1)!.expect).toBe(v(2));
    });

    it("keeps edits typed during a second save that takes over 4 s while the venue skips the first save's version", async () => {
        observeWorn(v(1), true);
        await type(v(1), 14);
        // typed during save 1
        await type(v(1), 13, false);
        // save 1 answers v2; the venue still names v1, so the 4 s wait for v2 starts
        await answer(0, v(2));
        // save 2 starts (for Across 13), from v2
        await vi.advanceTimersByTimeAsync(800);
        await flush();
        expect(saves.map((s) => s.expect)).toEqual([v(1), v(2)]);
        // typed after save 2 started
        await type(v(1), 11, false);
        // the venue jumps from v1 to v3 (save 2's result), skipping v2
        observeWorn(v(3), false);
        // save 2 takes more than 4 s
        await vi.advanceTimersByTimeAsync(4500);
        await flush();
        expect(
            draft(),
            "the 4 s wait mustn't end a draft with a save running",
        ).not.toBeNull();
        expect(xOf()).toBe(11);
        await answer(1, v(3));
        await vi.advanceTimersByTimeAsync(800);
        await flush();
        // Across 11 is saved from v3
        expect(saves.map((s) => s.expect)).toEqual([v(1), v(2), v(3)]);
        expect(xOf()).toBe(11);
    });

    it("doesn't take a save that reproduces an older version for an Undo", async () => {
        observeWorn(v(1), true);
        await type(v(1), 14);
        // save 1 answers v2 before the venue shows it
        await answer(0, v(2));
        // the crest goes back to 17: its pack is v1's bytes again
        await type(v(1), 17);
        expect(saves.at(-1)!.expect).toBe(v(2));
        // typed while that save runs
        await type(v(1), 16, false);
        // the venue catches up with save 1 meanwhile
        observeWorn(v(2), true);
        // save 2 answers v1, an older version, reproduced
        await answer(1, v(1));
        expect(
            draft(),
            "an older version reproduced isn't an Undo",
        ).not.toBeNull();
        expect(xOf()).toBe(16);
        await vi.advanceTimersByTimeAsync(800);
        await flush();
        expect(saves.at(-1)!.expect).toBe(v(1));
    });

    it("ends the draft if the saved version never reaches the venue and nothing is left to save", async () => {
        observeWorn(v(1), true);
        await type(v(1), 14);
        await answer(0, v(2));
        expect(draft()).not.toBeNull();
        await vi.advanceTimersByTimeAsync(4100);
        expect(draft()).toBeNull();
    });
});
