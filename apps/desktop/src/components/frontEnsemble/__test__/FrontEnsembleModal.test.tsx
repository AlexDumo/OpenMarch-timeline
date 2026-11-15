import {
    act,
    cleanup,
    fireEvent,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { afterEach, beforeAll, expect, vi } from "vitest";
import { useEffect } from "react";
import { describeDbTests, schema, type DbConnection } from "@/test/base";
import {
    harnessQueryClient,
    selectTimeline,
    setUpFeature,
} from "@/test/featureHarness";
import tolgee from "@/global/singletons/Tolgee";
import { stopTimelineResolver } from "@/timeline/timelineStore";
import { createItems, getItemGeometry, getItems } from "@/db-functions/items";
import { performUndo } from "@/db-functions/history";
import { moveMarchersInTarget } from "@/db-functions/timelineMoves";
import { createResolver } from "@openmarch/core";
import { readTimelineTables } from "@/timeline/timelineRows";
import { useItemDrawingStore } from "@/stores/ItemDrawingStore";
import { usePropDrawn } from "@/field/fieldPropTool";
import { pitVariant } from "@/view3d/core/pit/catalog";
import type { DrawnOutline } from "@/items/itemOutlines";
import {
    PropEditContents,
    PropListContents,
} from "@/components/items/PropsModal";
import MarcherEditor from "@/components/inspector/MarcherEditor";
import {
    FrontEnsembleContents,
    FrontEnsembleEditContents,
} from "../FrontEnsembleModal";
import { MarcherListContents } from "@/components/marcher/MarchersModal";
import SidebarModal from "@/components/sidebar/SidebarModal";
import { useSidebarModalStore } from "@/stores/SidebarModalStore";

/**
 * The Front ensemble panel (instruments.md §6): equipment is picked as a family, then a variant,
 * placed with a click as a locked item with its model's footprint, and edited as props are, with
 * its variant and lock. Equipment and podiums are listed there, apart, and never in the Props
 * panel.
 */

const app = vi.hoisted(() => ({ client: (): unknown => null }));
vi.mock("@/App", () => ({
    get queryClient() {
        return app.client();
    },
}));
app.client = harnessQueryClient;

beforeAll(async () => {
    await tolgee.run();
    // jsdom has no layout: Radix Select scrolls its chosen option into view
    Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
    cleanup();
    stopTimelineResolver();
    useItemDrawingStore.getState().resetDrawingState();
    vi.restoreAllMocks();
});

const PAGE = 1;

/** The field's `propDrawn` port, as `ThreeField` gets it */
const port: { drawn: ((outline: DrawnOutline) => void) | null } = {
    drawn: null,
};
function FieldPort() {
    const drawn = usePropDrawn();
    useEffect(() => {
        port.drawn = drawn;
    }, [drawn]);
    return null;
}

const marimba = (beatId: number) => ({
    kind: "equipment" as const,
    name: "Marimba 1",
    model: "pit/marimba-5.0",
    home: [40, 40] as [number, number],
    beatId,
    geometry: {
        outlineType: "rectangle" as const,
        ...pitVariant("pit/marimba-5.0")!.footprint,
    },
});

/** The first beat: on field from the start */
const firstBeatId = async (db: DbConnection) =>
    (await db
        .select({ id: schema.beats.id })
        .from(schema.beats)
        .orderBy(schema.beats.position)
        .get())!.id;

const riser = (beatId: number) => ({
    kind: "prop" as const,
    name: "Riser",
    surfaceType: "platform" as const,
    home: [40, 40] as [number, number],
    beatId,
    geometry: {
        outlineType: "rectangle" as const,
        width: 2,
        depth: 1,
        height: 0.4,
    },
});

describeDbTests("Front ensemble panel", (it) => {
    it("opens from its row in the Marchers panel, and goes back there", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        useSidebarModalStore.setState({ isOpen: true });
        useSidebarModalStore
            .getState()
            .setContent(<MarcherListContents />, "marchers");
        await setUpFeature(<SidebarModal />, PAGE, []);
        const row = await screen.findByTestId("front-ensemble-summary");
        expect(within(row).getByText("No pit yet")).toBeTruthy();
        fireEvent.click(within(row).getByRole("button", { name: "Set up" }));
        await screen.findByRole("region", { name: "Add equipment" });
        // The Marchers button stays lit: the view is part of that panel
        expect(useSidebarModalStore.getState().contentId).toBe("marchers");

        const beatId = await firstBeatId(db);
        await act(() => createItems({ db, newItems: [marimba(beatId)] }));
        await act(() => harnessQueryClient().invalidateQueries());
        fireEvent.click(screen.getByRole("button", { name: "Back" }));
        const back = await screen.findByTestId("front-ensemble-summary");
        await waitFor(() =>
            expect(within(back).getByText("1 piece of equipment")).toBeTruthy(),
        );
        expect(within(back).getByRole("button", { name: "Edit" })).toBeTruthy();
    });

    it("picks a family, then a variant, and places it as a locked, numbered item with the model's footprint", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        await setUpFeature(
            <>
                <FrontEnsembleContents />
                <FieldPort />
            </>,
            PAGE,
            [],
        );
        const ensemble = screen.getByRole("region", {
            name: "Add equipment",
        });
        fireEvent.click(
            within(ensemble).getByRole("button", { name: /Marimba/ }),
        );
        // The default is marked; the variants show their footprints
        const rosewood43 = within(ensemble).getByRole("button", {
            name: /4\.3 octaves · Rosewood.*Default/,
        });
        expect(rosewood43).toHaveTextContent("2.13 × 0.9 m");
        fireEvent.click(
            within(ensemble).getByRole("button", {
                name: /4\.3 octaves · Black synthetic/,
            }),
        );
        const { placing, drawingMode } = useItemDrawingStore.getState();
        expect(drawingMode).toBe("rectangle");
        expect(placing).toMatchObject({
            baseName: "Marimba",
            variant: { modelId: "pit/marimba-4.3-synthetic-black" },
        });

        // A click on the field
        act(() =>
            port.drawn!({
                outlineType: "rectangle",
                centerX: 300,
                centerY: 200,
                widthPixels: 1,
                depthPixels: 1,
            }),
        );
        expect(useItemDrawingStore.getState().placing).toBeNull();
        await waitFor(async () =>
            expect(await getItems({ db })).toHaveLength(1),
        );
        const [item] = await getItems({ db });
        expect(item).toMatchObject({
            kind: "equipment",
            model: "pit/marimba-4.3-synthetic-black",
            locked: true,
            marcher: { name: "Marimba 1" },
        });
        const [geometry] = await getItemGeometry({ db });
        expect(geometry).toMatchObject({
            outline_type: "rectangle",
            ...pitVariant("pit/marimba-4.3-synthetic-black")!.footprint,
        });
        // The list shows it, locked
        expect(
            await screen.findByRole("img", { name: "Locked" }),
        ).toBeInTheDocument();
        expect(screen.getByText("Marimba 1")).toBeInTheDocument();
    });

    it("places a family with one model straight from the list, numbered after the others", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        await createItems({
            db,
            newItems: [
                {
                    ...marimba(await firstBeatId(db)),
                    name: "Chimes 4",
                    model: "pit/chimes",
                },
            ],
        });
        await setUpFeature(
            <>
                <FrontEnsembleContents />
                <FieldPort />
            </>,
            PAGE,
            [],
        );
        await screen.findByText("Chimes 4");
        const ensemble = screen.getByRole("region", {
            name: "Add equipment",
        });
        // Open even with equipment in the show, so adding more stays in reach
        fireEvent.click(
            within(ensemble).getByRole("button", { name: "Chimes" }),
        );
        expect(useItemDrawingStore.getState().placing?.variant.modelId).toBe(
            "pit/chimes",
        );
        act(() =>
            port.drawn!({
                outlineType: "rectangle",
                centerX: 0,
                centerY: 0,
                widthPixels: 1,
                depthPixels: 1,
            }),
        );
        await waitFor(async () =>
            expect((await getItems({ db })).map((i) => i.marcher.name)).toEqual(
                ["Chimes 4", "Chimes 5"],
            ),
        );
    });

    it("changes the variant within the family, resizing it, in one undo step", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const [item] = await createItems({
            db,
            newItems: [marimba(await firstBeatId(db))],
        });
        await setUpFeature(
            <FrontEnsembleEditContents itemId={item.id} />,
            PAGE,
            [],
        );
        // The compact select is named by its value
        expect(await screen.findByText("Marimba model")).toBeInTheDocument();
        const trigger = screen.getByRole("combobox", {
            name: "5.0 octaves · Rosewood",
        });
        fireEvent.click(trigger);
        const options = await screen.findAllByRole("option");
        // Only marimbas
        expect(options).toHaveLength(6);
        expect(options.map((o) => o.textContent)).toContain(
            "4.6 octaves · Rosewood",
        );
        fireEvent.click(
            options.find((o) => o.textContent === "4.6 octaves · Rosewood")!,
        );

        const smaller = pitVariant("pit/marimba-4.6")!.footprint;
        await waitFor(async () =>
            expect((await getItems({ db }))[0].model).toBe("pit/marimba-4.6"),
        );
        expect((await getItemGeometry({ db }))[0]).toMatchObject(smaller);

        await performUndo(db);
        expect((await getItems({ db }))[0].model).toBe("pit/marimba-5.0");
        expect((await getItemGeometry({ db }))[0]).toMatchObject(
            pitVariant("pit/marimba-5.0")!.footprint,
        );
    });

    it("locks and unlocks any item, each in one undo step", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const beatId = await firstBeatId(db);
        const [prop] = await createItems({
            db,
            newItems: [
                {
                    kind: "prop",
                    name: "Riser",
                    surfaceType: "platform",
                    home: [40, 40],
                    beatId,
                    geometry: {
                        outlineType: "rectangle",
                        width: 2,
                        depth: 1,
                        height: 0.4,
                    },
                },
            ],
        });
        await setUpFeature(<PropEditContents itemId={prop.id} />, PAGE, []);
        const lock = await screen.findByRole("switch", { name: "Locked" });
        expect(lock).not.toBeChecked();
        // A prop has no model to pick
        expect(screen.queryByText(/model/)).toBeNull();

        fireEvent.click(lock);
        await waitFor(async () =>
            expect((await getItems({ db }))[0].locked).toBe(true),
        );
        await waitFor(() =>
            expect(
                screen.getByRole("switch", { name: "Locked" }),
            ).toBeChecked(),
        );
        fireEvent.click(screen.getByRole("switch", { name: "Locked" }));
        await waitFor(async () =>
            expect((await getItems({ db }))[0].locked).toBe(false),
        );
        await performUndo(db);
        expect((await getItems({ db }))[0].locked).toBe(true);
    });

    it("locks an item with moves where it is at the playhead, not at its home", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const [prop] = await createItems({
            db,
            newItems: [
                {
                    kind: "prop",
                    name: "Riser",
                    surfaceType: "obstacle",
                    home: [100, 100],
                    beatId: await firstBeatId(db),
                    geometry: {
                        outlineType: "rectangle",
                        width: 2,
                        depth: 1,
                    },
                },
            ],
        });
        // Moves over pages 1 and 2 (beats 1 to 17)
        await moveMarchersInTarget({
            db,
            target: { kind: "range", start: 1, end: 17 },
            moves: [{ marcherId: prop.marcher_id, x: 300, y: 200 }],
        });
        const resolverOf = async () =>
            createResolver((await readTimelineTables(db)).snapshot);
        const at9 = (await resolverOf()).positionAt(prop.marcher_id, 9);
        expect(at9).not.toEqual([100, 100]);

        await setUpFeature(<PropEditContents itemId={prop.id} />, PAGE, []);
        // The playhead on beat 9
        await selectTimeline({ start: 1, end: 9 });
        fireEvent.click(await screen.findByRole("switch", { name: "Locked" }));
        await waitFor(async () =>
            expect((await getItems({ db }))[0].locked).toBe(true),
        );
        const resolver = await resolverOf();
        for (const beat of [0, 1, 9, 17, 30])
            expect(resolver.positionAt(prop.marcher_id, beat)).toEqual(at9);
    });

    it("places a podium with the turn the tool gave it", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        await setUpFeature(
            <>
                <FrontEnsembleContents />
                <FieldPort />
            </>,
            PAGE,
            [],
        );
        const ensemble = screen.getByRole("region", {
            name: "Add equipment",
        });
        // The conductor's podium, among the podiums' own group
        const podiums = within(ensemble).getByRole("group", {
            name: "Podiums",
        });
        fireEvent.click(
            within(podiums).getByRole("button", { name: "Podium" }),
        );
        fireEvent.click(within(ensemble).getByRole("button", { name: /^Low/ }));
        // Behind the back sideline, turned to face the field
        act(() =>
            port.drawn!({
                outlineType: "rectangle",
                centerX: 300,
                centerY: -40,
                widthPixels: 1,
                depthPixels: 1,
                rotation: 180,
            }),
        );
        await waitFor(async () =>
            expect(await getItemGeometry({ db })).toHaveLength(1),
        );
        expect((await getItemGeometry({ db }))[0].rotation).toBe(180);
        expect((await getItems({ db }))[0]).toMatchObject({
            model: "pit/conductor-podium",
            marcher: { name: "Podium 1", home_y: -40 },
        });
    });

    it("places a drum major's tower from the podiums, turned to face the field from behind it", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        await setUpFeature(
            <>
                <FrontEnsembleContents />
                <FieldPort />
            </>,
            PAGE,
            [],
        );
        const podiums = screen.getByRole("group", { name: "Podiums" });
        expect(
            within(podiums)
                .getAllByRole("button")
                .map((b) => b.textContent),
        ).toEqual([
            "Podium",
            "Podium stand",
            "Tower",
            "Rolling podium",
            "Stepladder",
            "Scaffold tower",
        ]);
        fireEvent.click(within(podiums).getByRole("button", { name: "Tower" }));
        fireEvent.click(screen.getByRole("button", { name: /^6 ft · Black/ }));
        act(() =>
            port.drawn!({
                outlineType: "rectangle",
                centerX: 300,
                centerY: -40,
                widthPixels: 1,
                depthPixels: 1,
                rotation: 180,
            }),
        );
        await waitFor(async () =>
            expect(await getItems({ db })).toHaveLength(1),
        );
        expect((await getItems({ db }))[0]).toMatchObject({
            kind: "equipment",
            model: "pit/podium-tower-6ft-black",
            locked: true,
            marcher: { name: "Tower 1" },
        });
        expect((await getItemGeometry({ db }))[0]).toMatchObject({
            rotation: 180,
            ...pitVariant("pit/podium-tower-6ft-black")!.footprint,
        });
    });

    it("lists the equipment and the podiums apart, as equipment, and no props", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const beatId = await firstBeatId(db);
        const [, podium] = await createItems({
            db,
            newItems: [
                marimba(beatId),
                {
                    ...marimba(beatId),
                    name: "Podium 1",
                    model: "pit/conductor-podium",
                },
                riser(beatId),
            ],
        });
        const { result } = await setUpFeature(
            <FrontEnsembleContents />,
            PAGE,
            [],
        );
        await screen.findByText("Marimba 1");
        expect(screen.queryByText("Riser")).toBeNull();
        const equipment = screen.getByRole("region", { name: "Equipment" });
        const podiums = screen.getByRole("region", { name: "Podiums" });
        expect(within(equipment).getByText("Marimba 1")).toBeInTheDocument();
        expect(within(equipment).queryByText("Podium 1")).toBeNull();
        expect(within(podiums).getByText("Podium 1")).toBeInTheDocument();
        expect(
            screen
                .getAllByRole("button", { name: /^(Edit|Delete) / })
                .map((b) => b.getAttribute("aria-label")),
        ).toEqual([
            "Edit equipment",
            "Delete equipment",
            "Edit podium",
            "Delete podium",
        ]);
        result.unmount();
        await setUpFeature(
            <FrontEnsembleEditContents itemId={podium.id} />,
            PAGE,
            [],
        );
        expect(
            await screen.findByRole("heading", { name: "Edit Podium" }),
        ).toBeInTheDocument();
    });

    it("keeps equipment out of the Props panel: no Front ensemble section and only props listed", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const beatId = await firstBeatId(db);
        await createItems({
            db,
            newItems: [
                marimba(beatId),
                {
                    ...marimba(beatId),
                    name: "Podium 1",
                    model: "pit/conductor-podium",
                },
                riser(beatId),
            ],
        });
        await setUpFeature(<PropListContents />, PAGE, []);
        await screen.findByText("Riser");
        expect(screen.queryByText("Marimba 1")).toBeNull();
        expect(screen.queryByText("Podium 1")).toBeNull();
        expect(screen.queryByText(/Front ensemble/)).toBeNull();
        expect(screen.queryByTestId("pit-preset-medium")).toBeNull();
        expect(
            screen
                .getAllByRole("button", { name: /^(Edit|Delete) / })
                .map((b) => b.getAttribute("aria-label")),
        ).toEqual(["Edit prop", "Delete prop"]);
    });

    it("says the Props panel has no props when the show only has equipment", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        await createItems({
            db,
            newItems: [marimba(await firstBeatId(db))],
        });
        await setUpFeature(<PropListContents />, PAGE, []);
        expect(await screen.findByText(/No props yet/)).toBeInTheDocument();
    });

    it("tells the inspector's reader selected equipment is edited in the Front ensemble panel", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const beatId = await firstBeatId(db);
        const [equipment, prop] = await createItems({
            db,
            newItems: [marimba(beatId), riser(beatId)],
        });
        await setUpFeature(<MarcherEditor />, PAGE, [
            equipment.marcher_id,
            prop.marcher_id,
        ]);
        expect(
            await screen.findByTestId("inspector-equipment-selected"),
        ).toHaveTextContent(
            "1 piece of equipment selected. Edit it in the Front ensemble panel.",
        );
        expect(
            screen.getByTestId("inspector-items-selected"),
        ).toHaveTextContent("1 prop selected. Edit it in the Props panel.");
    });
});
