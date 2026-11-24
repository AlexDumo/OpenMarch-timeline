// cspell:words Khronos
import {
    act,
    cleanup,
    fireEvent,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { Blob as NodeBlob } from "node:buffer";
import { afterAll, afterEach, beforeAll, expect, vi } from "vitest";
import { describeDbTests, schema, type DbConnection } from "@/test/base";
import { harnessQueryClient, setUpFeature } from "@/test/featureHarness";
import tolgee from "@/global/singletons/Tolgee";
import { stopTimelineResolver } from "@/timeline/timelineStore";
import { createItems, getItems, updateItems } from "@/db-functions/items";
import {
    addShowAssetInTransaction,
    getShowAssets,
} from "@/db-functions/showAssets";
import { useItemDrawingStore } from "@/stores/ItemDrawingStore";
import { performUndo } from "@/db-functions/history";
import SidebarModal from "@/components/sidebar/SidebarModal";
import { importModel as runImport } from "@/showAssets/modelImport/pipeline";
import { saveImportedModel } from "@/showAssets/modelImport/saveImportedModel";
import { env, picked } from "@/showAssets/modelImport/__test__/fixtures";
import { openItemEditor } from "@/components/items/openItemEditor";
import { showAssetsView } from "../openAssets";
import { sql } from "drizzle-orm";
import {
    saveUniformItemsPack,
    setUniformPack,
} from "@/db-functions/view3dUniformPack";
import { parseShowAssetRef } from "@/showAssets/ref";
import {
    getStoredVenueSettings,
    updateVenueSettings,
} from "@/db-functions/view3dVenue";
import { tableNamesToQueryKeys } from "@/hooks/queries/utils";
import {
    readUniformPack,
    writeUniformPack,
} from "@/view3d/core/uniformPack/format";
import {
    fakePng,
    sampleManifest,
} from "@/view3d/core/uniformPack/__test__/fixtures";
import FootballTemplates from "@/global/classes/fieldTemplates/Football";

const fieldPropertiesOf = async (_db: DbConnection) =>
    FootballTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_WITH_END_ZONES;

/**
 * The Assets view (fork #1001): the show's imported assets with their size, use and credits,
 * the unused note and Remove unused…, and a prop whose model an undo brought back after it was
 * removed. The models come from the real import pipeline, in Node.
 */

const app = vi.hoisted(() => ({ client: (): unknown => null }));
vi.mock("@/App", () => ({
    get queryClient() {
        return app.client();
    },
}));
app.client = harnessQueryClient;

// The uniform pack worker doesn't run in jsdom: read packs here, with the same reader
vi.mock("@/view3d/uniformPack/runUniformPackJob", async () => {
    const { readUniformPack } =
        await import("@/view3d/core/uniformPack/format");
    return {
        runUniformPackJob: async (request: {
            type: string;
            bytes: Uint8Array;
        }) => {
            if (request.type !== "pack")
                throw new Error(`no ${request.type} jobs in this test`);
            return {
                type: "pack",
                manifest: readUniformPack(request.bytes).manifest,
            };
        },
    };
});

const JsdomBlob = globalThis.Blob;
afterAll(() => {
    globalThis.Blob = JsdomBlob;
});
beforeAll(async () => {
    await tolgee.run();
    Element.prototype.scrollIntoView ??= () => {};
    globalThis.Blob = NodeBlob as unknown as typeof Blob;
    URL.createObjectURL ??= () => "blob:test";
    URL.revokeObjectURL ??= () => {};
});
afterEach(() => {
    cleanup();
    stopTimelineResolver();
    vi.restoreAllMocks();
});

/** Imports a fixture as the review's Add would, with no license */
async function store(db: DbConnection, file: string, name: string) {
    const result = await runImport([picked(file)], {}, env);
    if (!result.ok) throw new Error(`${file} should import`);
    const { modelValue } = await saveImportedModel({
        db,
        model: { ...result.model, name, credits: {} },
    });
    return modelValue;
}

const refresh = () =>
    act(async () => harnessQueryClient()!.invalidateQueries());

describeDbTests("Assets view", (it) => {
    it("lists the show's assets, says which nothing uses, and removes only those", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const chair = await store(db, "SheenChair.glb", "Chair");
        await store(db, "TextureCoordinateTest.glb", "Test pattern");
        const beats = await db
            .select({ id: schema.beats.id })
            .from(schema.beats)
            .all();
        const [prop] = await createItems({
            db,
            newItems: [
                {
                    kind: "prop",
                    surfaceType: "obstacle",
                    home: [100, 100],
                    beatId: beats[0]!.id,
                    model: chair,
                    geometry: { outlineType: "rectangle", width: 1, depth: 1 },
                },
            ],
        });
        await setUpFeature(<SidebarModal />, 1, []);
        await act(async () => showAssetsView());

        const view = await screen.findByTestId("assets-view");
        await waitFor(() =>
            expect(within(view).getAllByTestId("asset-row")).toHaveLength(2),
        );
        const [chairRow, patternRow] = within(view).getAllByTestId("asset-row");
        expect(chairRow).toHaveTextContent("Chair");
        expect(chairRow).toHaveTextContent("Used once");
        expect(patternRow).toHaveTextContent("Not used");
        // No license given: the share note, never "infringing"
        expect(patternRow).toHaveTextContent("may not have the right to share");
        expect(screen.getByTestId("assets-unused-note")).toHaveTextContent(
            /^1 asset isn't used anywhere in the show · [\d.]+ (KB|MB)/,
        );

        // Remove unused… lists what it removes, and removes only that
        fireEvent.click(screen.getByTestId("assets-remove-unused"));
        const list = await screen.findByTestId("assets-remove-list");
        expect(within(list).getAllByRole("listitem")).toHaveLength(1);
        expect(list).toHaveTextContent("Test pattern");
        fireEvent.click(screen.getByTestId("assets-remove-confirm"));
        await waitFor(async () =>
            expect((await getShowAssets({ db })).map((a) => a.name)).toEqual([
                "Chair",
            ]),
        );
        await waitFor(() =>
            expect(screen.queryByTestId("assets-unused-note")).toBeNull(),
        );

        // The prop lets go of its model, the model is removed, and an undo brings the prop's
        // reference back: it draws as a block, and the show says so
        await updateItems({
            db,
            modifiedItems: [{ itemId: prop!.id, model: null }],
        });
        await refresh();
        fireEvent.click(await screen.findByTestId("assets-remove-unused"));
        fireEvent.click(await screen.findByTestId("assets-remove-confirm"));
        await waitFor(async () =>
            expect(await getShowAssets({ db })).toHaveLength(0),
        );
        await performUndo(db);
        await refresh();
        expect(
            await screen.findByTestId("assets-missing-note"),
        ).toHaveTextContent("1 prop names a model this show doesn't have");
        const [item] = await getItems({ db });
        await act(async () => openItemEditor(item!));
        expect(await screen.findByTestId("item-model-missing")).toBeTruthy();
    });

    it("saves credits without making a new Version", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        await store(db, "TextureCoordinateTest.glb", "Test pattern");
        const [before] = await getShowAssets({ db });
        await setUpFeature(<SidebarModal />, 1, []);
        await act(async () => showAssetsView());
        const row = await screen.findByTestId("asset-row");
        // One tap opens the row onto its credits
        const toggle = within(row).getByRole("button", { expanded: false });
        fireEvent.click(toggle);
        fireEvent.change(await screen.findByTestId("asset-author"), {
            target: { value: "Khronos" },
        });
        // Closing the row at once still saves the edit
        fireEvent.click(toggle);
        await waitFor(
            async () => {
                const [after] = await getShowAssets({ db });
                expect(after!.credits).toEqual({ author: "Khronos" });
                expect(after!.versionHash).toBe(before!.versionHash);
            },
            { timeout: 3000 },
        );
    });

    it("keeps what's named while it asks, an armed model, and kinds it can't see the uses of", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const pattern = await store(
            db,
            "TextureCoordinateTest.glb",
            "Test pattern",
        );
        const chair = await store(db, "SheenChair.glb", "Chair");
        await db.transaction((tx) =>
            addShowAssetInTransaction({
                tx,
                asset: {
                    kind: "flag",
                    name: "Flag",
                    parts: { silk: new Uint8Array([1, 2]) },
                },
            }),
        );
        await setUpFeature(<SidebarModal />, 1, []);
        // The chair is armed to place with the next click on the field
        await act(async () =>
            useItemDrawingStore.getState().placeModel({
                modelValue: chair,
                footprint: { width: 1, depth: 1, height: 1 },
                baseName: "Chair",
            }),
        );
        await act(async () => showAssetsView({ openRemove: true }));
        const list = await screen.findByTestId("assets-remove-list");
        expect(list).toHaveTextContent("Test pattern");
        expect(list).not.toHaveTextContent("Chair");
        expect(list).not.toHaveTextContent("Flag");
        // A prop starts using the pattern while the list is up: it's kept
        const beats = await db
            .select({ id: schema.beats.id })
            .from(schema.beats)
            .all();
        await createItems({
            db,
            newItems: [
                {
                    kind: "prop",
                    surfaceType: "floor",
                    home: [100, 100],
                    beatId: beats[0]!.id,
                    model: pattern,
                    geometry: { outlineType: "rectangle", width: 1, depth: 1 },
                },
            ],
        });
        fireEvent.click(screen.getByTestId("assets-remove-confirm"));
        await waitFor(() =>
            expect(screen.queryByTestId("assets-remove-dialog")).toBeNull(),
        );
        expect((await getShowAssets({ db })).map((a) => a.name).sort()).toEqual(
            ["Chair", "Flag", "Test pattern"],
        );
        await act(async () =>
            useItemDrawingStore.getState().resetDrawingState(),
        );
    });

    it("opens Remove unused… from its command, listing nothing when everything is used", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        await setUpFeature(<SidebarModal />, 1, []);
        await act(async () => showAssetsView({ openRemove: true }));
        expect(
            await screen.findByTestId("assets-remove-dialog"),
        ).toHaveTextContent("nothing to remove");
        expect(screen.queryByTestId("assets-remove-confirm")).toBeNull();
        // Cancel, then ask again: it asks again
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        await waitFor(() =>
            expect(screen.queryByTestId("assets-remove-dialog")).toBeNull(),
        );
        await act(async () => showAssetsView({ openRemove: true }));
        expect(await screen.findByTestId("assets-remove-dialog")).toBeTruthy();
        void db;
    });

    it("refreshes which uniforms undo names when the venue changes, undo runs, or Remove unused… opens", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const field = await fieldPropertiesOf(db);
        const wear = async (name: string, tag: number) => {
            const pack = writeUniformPack(sampleManifest(name), {
                "layers/base.png": fakePng(3360, 2816, tag),
            });
            return await setUniformPack({
                db,
                pack,
                manifest: readUniformPack(pack).manifest,
                field,
            });
        };
        // what the app's venue write and undo refresh: the venue's key, by table name
        const venueChanged = () =>
            act(async () => {
                for (const queryKey of tableNamesToQueryKeys(
                    new Set(["view3d_venue"]),
                ))
                    await harnessQueryClient()!.invalidateQueries({ queryKey });
            });
        const assetsChanged = () =>
            act(async () =>
                harnessQueryClient()!.invalidateQueries({
                    queryKey: ["show_assets"],
                }),
            );

        // the band wears A, and the Assets view is open
        await wear("Uniform A", 1);
        await setUpFeature(<SidebarModal />, 1, []);
        await act(async () => showAssetsView());
        const view = await screen.findByTestId("assets-view");
        await waitFor(() =>
            expect(within(view).getAllByTestId("asset-row")).toHaveLength(1),
        );
        expect(screen.queryByTestId("assets-unused-note")).toBeNull();

        // The band switches to a preset in the 3D View: undo would dress it in A again, so A
        // isn't called unused
        const venue = (await getStoredVenueSettings({ db }))!;
        const { uniformArtwork: _a, ...preset } = venue;
        await updateVenueSettings({ db, settings: preset });
        await venueChanged();
        await waitFor(() =>
            expect(within(view).getByTestId("asset-row")).toHaveTextContent(
                "Not used",
            ),
        );
        expect(screen.queryByTestId("assets-unused-note")).toBeNull();

        // Import B, then undo: only redo names B now, so B isn't called unused either
        await wear("Uniform B", 2);
        await assetsChanged();
        await venueChanged();
        await waitFor(() =>
            expect(within(view).getAllByTestId("asset-row")).toHaveLength(2),
        );
        await performUndo(db);
        await venueChanged();
        await waitFor(() =>
            expect(
                within(view)
                    .getAllByTestId("asset-row")
                    .map((row) => row.textContent?.includes("Not used")),
            ).toEqual([true, true]),
        );
        expect(screen.queryByTestId("assets-unused-note")).toBeNull();

        // An edit elsewhere clears history without touching the venue: Remove unused… reads
        // again as it opens, and lists both
        await db.run(sql`DELETE FROM history_undo`);
        await db.run(sql`DELETE FROM history_redo`);
        await act(async () => showAssetsView({ openRemove: true }));
        const list = await screen.findByTestId("assets-remove-list");
        expect(
            within(list)
                .getAllByRole("listitem")
                .map((row) => row.textContent),
        ).toEqual([
            expect.stringContaining("Uniform A"),
            expect.stringContaining("Uniform B"),
        ]);
    });

    /** Stores a uniform pack and dresses the band in it, as the editor does */
    const wearUniform = async (db: DbConnection, name: string, tag: number) => {
        const pack = writeUniformPack(sampleManifest(name), {
            "layers/base.png": fakePng(3360, 2816, tag),
        });
        return await setUniformPack({
            db,
            pack,
            manifest: readUniformPack(pack).manifest,
            field: await fieldPropertiesOf(db),
        });
    };

    it("says when the band's uniform is in the show but doesn't read, and when it isn't in the show", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const value = await wearUniform(db, "Readable", 11);
        await setUpFeature(<SidebarModal />, 1, []);
        await act(async () => showAssetsView());
        const view = await screen.findByTestId("assets-view");
        await waitFor(() =>
            expect(within(view).getAllByTestId("asset-row")).toHaveLength(1),
        );
        // it reads: no note
        await act(async () => {
            await harnessQueryClient()!.refetchQueries();
        });
        expect(
            screen.queryByTestId("assets-unreadable-uniform-note"),
        ).toBeNull();
        expect(screen.queryByTestId("assets-missing-uniform-note")).toBeNull();

        // the band wears one whose stored file is damaged
        const broken = await wearUniform(db, "Damaged", 12);
        const [asset] = (await getShowAssets({ db })).filter(
            (a) => a.name === "Damaged",
        );
        await db.run(
            sql`UPDATE show_asset_blobs SET data = x'00' WHERE hash = ${asset.parts.pack}`,
        );
        expect(broken).not.toBe(value);
        await refresh();
        await waitFor(() =>
            expect(
                screen.getByTestId("assets-unreadable-uniform-note"),
            ).toHaveTextContent("can't be read"),
        );
        expect(screen.queryByTestId("assets-missing-uniform-note")).toBeNull();

        // the venue names one the show doesn't have
        const venue = (await getStoredVenueSettings({ db }))!;
        await updateVenueSettings({
            db,
            settings: {
                ...venue,
                uniformArtwork: `library:gone@${"c".repeat(64)}`,
            },
        });
        await refresh();
        await waitFor(() =>
            expect(
                screen.getByTestId("assets-missing-uniform-note"),
            ).toHaveTextContent("isn't in this show anymore"),
        );
        expect(
            screen.queryByTestId("assets-unreadable-uniform-note"),
        ).toBeNull();
    });

    it("counts the version the band wears in place of a removed one as in use (#1287)", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const origin = await wearUniform(db, "fjm-page", 21);
        const id = parseShowAssetRef(origin)!.id;
        // an item edit: a second version, Y, which the band wears
        const withCrest = writeUniformPack(
            {
                ...sampleManifest("fjm-page"),
                items: [
                    {
                        id: "crest",
                        file: "items/crest.png",
                        panel: "front",
                        at: [17, 25.32],
                        width: 6,
                    },
                ],
            },
            {
                "layers/base.png": fakePng(3360, 2816, 21),
                "items/crest.png": fakePng(64, 64, 1),
            },
        );
        const y = await saveUniformItemsPack({
            db,
            pack: withCrest,
            manifest: readUniformPack(withCrest).manifest,
            field: await fieldPropertiesOf(db),
            versionOf: id,
            expect: origin,
        });
        // the venue names a version of the same uniform that a burst removed: the band wears Y
        const venue = (await getStoredVenueSettings({ db }))!;
        await updateVenueSettings({
            db,
            settings: {
                ...venue,
                uniformArtwork: `library:${id}@${"d".repeat(64)}`,
            },
        });
        // nothing in history keeps either version
        await db.run(sql`DELETE FROM history_undo`);
        await db.run(sql`DELETE FROM history_redo`);
        await setUpFeature(<SidebarModal />, 1, []);
        await act(async () => showAssetsView());
        const view = await screen.findByTestId("assets-view");
        await refresh();
        // one row for the uniform, showing Y, in use; its older version is counted
        await waitFor(() => {
            const rows = within(view).getAllByTestId("asset-row");
            expect(rows).toHaveLength(1);
            expect(rows[0]).not.toHaveTextContent("Not used");
            expect(
                within(rows[0]).getByTestId("asset-other-versions"),
            ).toHaveTextContent("1 older version");
        });
        expect(y.value).not.toBe(origin);
        // Remove unused… offers only the older version, never the one worn
        await act(async () => showAssetsView({ openRemove: true }));
        const list = await screen.findByTestId("assets-remove-list");
        expect(within(list).getAllByRole("listitem")).toHaveLength(1);
        expect(screen.queryByTestId("assets-missing-uniform-note")).toBeNull();
    });

    it("lists the assets when the undo history can't be read, keeps every uniform, and says so", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        // the band wore this uniform, then a preset: only history names it now
        await wearUniform(db, "Old uniform", 13);
        const venue = (await getStoredVenueSettings({ db }))!;
        const { uniformArtwork: _worn, ...preset } = venue;
        await updateVenueSettings({ db, settings: preset });
        // the history scan fails
        await db.run(sql`ALTER TABLE history_redo RENAME TO history_redo_gone`);

        await setUpFeature(<SidebarModal />, 1, []);
        await act(async () => showAssetsView());
        const view = await screen.findByTestId("assets-view");
        await waitFor(() =>
            expect(within(view).getAllByTestId("asset-row")).toHaveLength(1),
        );
        await waitFor(
            () =>
                expect(
                    screen.getByTestId("assets-history-failed-note"),
                ).toBeInTheDocument(),
            // the query tries a few times first, as every query does
            { timeout: 15_000 },
        );
        // not offered for removal: an undo may still need it
        expect(screen.queryByTestId("assets-unused-note")).toBeNull();
        await db.run(sql`ALTER TABLE history_redo_gone RENAME TO history_redo`);
    });
});
