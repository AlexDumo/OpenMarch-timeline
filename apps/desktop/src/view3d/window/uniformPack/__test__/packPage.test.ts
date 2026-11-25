/**
 * What the 3D View composes for a pack key (fork #1257 step 5): a saved pack's mode is flattened
 * from the pack itself, a draft's from its own mode's layers with any unsaved overlay; and the
 * mode picker waits until an edit is back in the venue.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    withMode,
    type UniformPackValue,
} from "@/view3d/core/marchers/uniformArtwork";
import { addMode, contentsOf } from "@/view3d/core/uniformPack/modeEdits";
import {
    fakePng,
    sampleManifest,
} from "@/view3d/core/uniformPack/__test__/fixtures";
import {
    draftKey,
    editPack,
    editUnsettled,
    useItemDrafts,
    type ItemDraft,
} from "../itemDrafts";
import { composeFromNewest, packPageKey, packPagePlan } from "../packPage";

const v = (n: number) =>
    `library:pack@${String(n).repeat(64)}` as UniformPackValue;

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    useItemDrafts.setState({ draft: null, saving: false, failed: false });
});

describe("the page a pack key draws", () => {
    it("flattens a saved pack's mode from the pack itself", () => {
        const plan = packPagePlan(withMode(v(1), "sash-out-0001"));
        expect(plan).toEqual({
            pack: v(1),
            draft: null,
            which: { mode: "sash-out-0001" },
            items: null,
        });
        expect(packPageKey(v(1), 32, plan.which)).toBe(
            `${v(1)}|32|#sash-out-0001`,
        );
        expect(packPagePlan(v(1)).which).toEqual({ mode: null });
    });

    it("draws a draft's mode from its own layers, with the overlay it hasn't saved", () => {
        vi.useFakeTimers();
        const stored = contentsOf(sampleManifest("Cadets 2019"));
        const overlay = fakePng(3360, 2816, 7);
        let sash = "";
        editPack(
            v(1),
            stored,
            (c) => {
                const added = addMode(c, {
                    name: "Sash out",
                    defaultName: "Plain",
                    layer: {
                        id: "sash",
                        name: "Sash",
                        file: "layers/sash.png",
                        covers: "page",
                    },
                });
                sash = added.id;
                return added.contents;
            },
            { layerImages: { "layers/sash.png": overlay } },
        );
        // the 3D View draws the draft a moment after the edit
        vi.advanceTimersByTime(200);
        const draft = useItemDrafts.getState().draft!;
        const key = draftKey(v(1), draft.shown);
        const plain = draft.contents.modes[0].id;

        const sashPlan = packPagePlan(withMode(key, sash));
        expect(sashPlan.draft).not.toBeNull();
        expect(sashPlan.which).toEqual({
            files: ["layers/base.png", "layers/sash.png"],
            extra: { "layers/sash.png": overlay },
        });
        expect(sashPlan.items).toEqual([]);

        const plainPlan = packPagePlan(withMode(key, plain));
        expect(plainPlan.which).toEqual({
            files: ["layers/base.png"],
            extra: {},
        });
        // the two modes are two pages
        expect(packPageKey(v(1), 32, sashPlan.which)).not.toBe(
            packPageKey(v(1), 32, plainPlan.which),
        );
    });
});

describe("whether an edit has settled in the venue", () => {
    const draft = (over: Partial<ItemDraft>): ItemDraft => ({
        origin: v(1),
        latest: v(2),
        previous: v(1),
        arrived: true,
        contents: contentsOf(sampleManifest()),
        images: {},
        layerImages: {},
        revision: 2,
        shown: 2,
        saved: 2,
        ...over,
    });

    it("waits while saving, while edits wait to save, and until the venue shows the save", () => {
        expect(editUnsettled(null, false)).toBe(false);
        expect(editUnsettled(null, true)).toBe(true);
        expect(editUnsettled(draft({ saved: 1 }), false)).toBe(true);
        // saved, but the venue still names the version before: a venue change sent now would
        // put that version back (and a burst's save may already have removed it)
        expect(editUnsettled(draft({ arrived: false }), false)).toBe(true);
        expect(editUnsettled(draft({}), false)).toBe(false);
    });
});

describe("composing from a draft's newest version", () => {
    it("composes again from each newer version while saves keep removing the one it read", async () => {
        // two saves land while it composes: each removes the version the last try read
        let newest = v(1);
        const tried: UniformPackValue[] = [];
        const art = await composeFromNewest(
            () => newest,
            true,
            async (from) => {
                tried.push(from);
                if (from === v(1)) {
                    newest = v(2);
                    throw new Error("v1 removed");
                }
                if (from === v(2)) {
                    newest = v(3);
                    throw new Error("v2 removed");
                }
                return `art of ${from}`;
            },
        );
        expect(tried).toEqual([v(1), v(2), v(3)]);
        expect(art).toBe(`art of ${v(3)}`);
    });

    it("fails when the version didn't move, or for a saved pack", async () => {
        const fail = async () => {
            throw new Error("damaged");
        };
        await expect(composeFromNewest(() => v(1), true, fail)).rejects.toThrow(
            "damaged",
        );
        let newest = v(1);
        const compose = vi.fn(async () => {
            newest = v(2);
            throw new Error("damaged");
        });
        await expect(
            composeFromNewest(() => newest, false, compose),
        ).rejects.toThrow("damaged");
        expect(compose).toHaveBeenCalledTimes(1);
    });
});
