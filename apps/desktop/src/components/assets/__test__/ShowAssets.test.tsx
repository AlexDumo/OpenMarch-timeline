import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TolgeeProvider } from "@tolgee/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import tolgee from "@/global/singletons/Tolgee";
import type {
    LibraryItemUses,
    ShowLibraryItem,
} from "@/db-functions/showLibrary";
import type { DatabaseCue } from "@/db-functions/cues";
import type { LibraryItemSummary } from "@/view3d/library/protocol";
import {
    createFakeLibrary,
    ok,
} from "@/components/library/import/__test__/fakeLibrary";
import ShowAssets from "../ShowAssets";
import type { ShowAssetDeletion } from "../DeleteShowAssetDialog";
import { h, librarySummary, showItem } from "./showFixtures";

let show: ShowLibraryItem[] = [];
vi.mock("@/hooks/queries/useShowLibrary", () => ({
    useShowLibrary: () => ({ data: show }),
    showLibraryKeys: { all: () => ["library_items"] },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(async () => {
    await tolgee.run();
    // Radix Select needs these, which happy-dom lacks
    Element.prototype.hasPointerCapture ??= vi.fn(() => false);
    Element.prototype.scrollIntoView ??= vi.fn();
});
afterEach(() => {
    cleanup();
    show = [];
});

function setup(library: LibraryItemSummary[], deletion?: ShowAssetDeletion) {
    const lib = createFakeLibrary();
    lib.on("list", () => ok(library));
    const blobs: Record<string, Uint8Array> = {
        [h("d")]: new Uint8Array([1, 2]),
        [h("e")]: new TextEncoder().encode('{"surface":"silk"}'),
    };
    render(
        <QueryClientProvider client={new QueryClient()}>
            <TolgeeProvider tolgee={tolgee} fallback="">
                <ShowAssets
                    api={lib.api}
                    readBlob={async (hash) => blobs[hash]}
                    deletion={deletion}
                />
            </TolgeeProvider>
        </QueryClientProvider>,
    );
    return lib;
}

describe("This show", () => {
    it("lists what the show embeds and adds a missing item to the Library from the show's copy", async () => {
        const kept = showItem(1, "Kept silk");
        const missing = showItem(2, "Shared silk");
        show = [kept, missing];
        const lib = setup([librarySummary(kept)]);
        lib.on("addFromShow", () =>
            ok({ outcome: "created", item: { id: missing.itemId } }),
        );

        const silks = await screen.findByTestId("show-group-silks");
        const rows = within(silks).getAllByTestId("show-item");
        expect(rows.map((r) => r.getAttribute("title"))).toEqual([
            "Kept silk",
            "Shared silk",
        ]);
        await waitFor(() =>
            expect(within(rows[1]).getByTestId("show-item-add")).toBeVisible(),
        );
        expect(within(rows[0]).queryByTestId("show-item-add")).toBeNull();

        await userEvent.click(within(rows[1]).getByTestId("show-item-add"));
        await waitFor(() => expect(lib.calls.addFromShow).toHaveLength(1));
        expect(lib.calls.addFromShow[0]).toMatchObject({
            itemId: missing.itemId,
            versionHash: missing.versionHash,
            name: "Shared silk",
            parts: { display: new Uint8Array([1, 2]) },
            license: { license: "LicenseRef-Unknown" },
        });
    });

    it("notes a newer Version in the Library without applying it", async () => {
        const behind = showItem(1, "Behind silk");
        show = [behind];
        setup([
            librarySummary(behind, { versions: [behind.versionHash, h("f")] }),
        ]);
        expect(await screen.findByTestId("show-item-update")).toHaveTextContent(
            "A newer version is in your Library.",
        );
    });

    it("offers no Add while the Library can't be read", async () => {
        show = [showItem(1, "Silk")];
        const lib = createFakeLibrary();
        render(
            <QueryClientProvider client={new QueryClient()}>
                <TolgeeProvider tolgee={tolgee} fallback="">
                    <ShowAssets
                        api={lib.api}
                        readBlob={async () => undefined}
                    />
                </TolgeeProvider>
            </QueryClientProvider>,
        );
        await waitFor(() => expect(lib.calls.list).toHaveLength(1));
        expect(screen.queryByTestId("show-item-add")).toBeNull();
    });

    it("says when the show uses nothing yet", () => {
        setup([]);
        expect(
            screen.getByText("This show doesn't use any assets yet."),
        ).toBeVisible();
    });
});

describe("Deleting from this show", () => {
    const silkCue = (id: number, patch: Partial<DatabaseCue> = {}) => ({
        cue: {
            id,
            channel: "silk" as const,
            kind: "state" as const,
            target: { kind: "section" as const, section: "Flag" },
            beatId: id,
            value: "library:x@y",
            phraseAssetId: null,
            length: null,
            transitionLength: null,
            settings: {},
            ripple: null,
            notes: null,
            createdAt: "",
            updatedAt: "",
            ...patch,
        },
        beatIndex: id * 8,
        tagName: null,
    });
    const fakeDeletion = (
        uses: LibraryItemUses,
        outcome: "deleted" | "keptForUndo" = "deleted",
    ) => {
        const calls: string[] = [];
        const deletion: ShowAssetDeletion = {
            uses: async () => uses,
            remove: async (itemId, to) => {
                calls.push(
                    to
                        ? `remove ${itemId}, replace with ${to.itemId}@${to.versionHash}`
                        : `remove ${itemId}`,
                );
                return { outcome };
            },
        };
        return { deletion, calls };
    };
    const openDelete = async (name: string) => {
        const row = (await screen.findAllByTestId("show-item")).find(
            (r) => r.getAttribute("title") === name,
        )!;
        await userEvent.click(within(row).getByTestId("show-item-delete"));
        return await screen.findByTestId("delete-show-asset");
    };

    it("deletes an item nothing uses after asking", async () => {
        const silk = showItem(1, "Old silk");
        show = [silk];
        const { deletion, calls } = fakeDeletion({ cues: [], pinnedBy: [] });
        setup([], deletion);

        const dialog = await openDelete("Old silk");
        expect(dialog).toHaveTextContent("Delete Old silk from this show?");
        expect(dialog).toHaveTextContent("This can't be undone.");
        await userEvent.click(
            within(dialog).getByTestId("delete-show-asset-confirm"),
        );
        await waitFor(() => expect(calls).toEqual([`remove ${silk.itemId}`]));
        expect(toast.success).toHaveBeenCalledWith(
            "Deleted Old silk from this show.",
        );
    });

    it("refuses while cues use it, lists them, and replaces before deleting", async () => {
        const old = showItem(1, "Old silk");
        const fresh = showItem(2, "New silk", {
            versionHash: h("b"),
            embeddedAt: "2026-10-02T00:00:00.000Z",
        });
        const rifle = showItem(3, "Rifle", { kind: "model", sidecar: null });
        show = [old, fresh, rifle];
        const { deletion, calls } = fakeDeletion(
            {
                cues: [
                    silkCue(1),
                    silkCue(2, { target: { kind: "band" } }),
                    silkCue(3, { target: { kind: "set", marcherIds: [4, 5] } }),
                ],
                pinnedBy: [],
            },
            "keptForUndo",
        );
        setup([], deletion);

        const dialog = await openDelete("Old silk");
        expect(dialog).toHaveTextContent("Old silk is in use");
        expect(dialog).toHaveTextContent("3 cues use it.");
        const uses = within(dialog).getByTestId("delete-show-asset-uses");
        expect(
            within(uses)
                .getAllByRole("listitem")
                .map((li) => li.textContent),
        ).toEqual([
            "Silk · Flag · count 8",
            "Silk · Band · count 16",
            "Silk · 2 performers · count 24",
        ]);
        const confirm = within(dialog).getByTestId("delete-show-asset-confirm");
        expect(confirm).toBeDisabled();

        await userEvent.click(
            within(dialog).getByTestId("delete-show-asset-replacement"),
        );
        // Only items of the same kind are offered
        expect(screen.queryByRole("option", { name: "Rifle" })).toBeNull();
        await userEvent.click(screen.getByRole("option", { name: "New silk" }));
        await userEvent.click(confirm);

        await waitFor(() =>
            expect(calls).toEqual([
                `remove ${old.itemId}, replace with ${fresh.itemId}@${h("b")}`,
            ]),
        );
        expect(toast.success).toHaveBeenCalledWith(
            "Replaced Old silk with New silk. Old silk stays in this show while Undo can bring it back, and goes once nothing can.",
        );
    });

    it("can't delete an item another item pins", async () => {
        show = [showItem(1, "Crest")];
        const { deletion } = fakeDeletion({
            cues: [],
            pinnedBy: [{ itemId: "u", name: "Home uniform" }],
        });
        setup([], deletion);

        const dialog = await openDelete("Crest");
        expect(
            within(dialog).getByTestId("delete-show-asset-pinned"),
        ).toHaveTextContent(
            "It's part of Home uniform, so it can't be deleted.",
        );
        expect(
            within(dialog).queryByTestId("delete-show-asset-confirm"),
        ).toBeNull();
    });
});
