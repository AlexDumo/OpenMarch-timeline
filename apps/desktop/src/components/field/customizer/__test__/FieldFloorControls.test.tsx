import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TolgeeProvider } from "@tolgee/react";
import { FieldProperties } from "@openmarch/core";
import tolgee from "@/global/singletons/Tolgee";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import { fieldFloorSize } from "@/view3d/core/field/floorSize";
import { useAssetsStore } from "@/components/assets/assetsStore";
import FieldFloorControls from "../FieldFloorControls";

const setFieldFloor = vi.fn(async () => {});
vi.mock("@/db-functions/fieldFloorEdits", () => ({
    setFieldFloor: (args: unknown) => setFieldFloor(args as never),
}));
vi.mock("@/global/database/db", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    db: { fake: "db" },
}));
vi.mock("@/view3d/library/importClient", () => ({
    editorImportClient: () => ({ editor: "client" }),
}));
vi.mock("@/hooks/queries/useShowLibrary", () => ({
    useShowLibrary: () => ({
        data: [
            {
                itemId: "floor-item",
                versionHash: "a".repeat(64),
                name: "Winter tarp",
            },
        ],
    }),
}));

const gym = FieldPropertiesTemplates.INDOOR_50x80_8to5;
const floor = { itemId: "floor-item", versionHash: "a".repeat(64) };

beforeAll(async () => {
    await tolgee.run();
});
afterEach(() => {
    cleanup();
    useAssetsStore.setState({ review: null });
    vi.restoreAllMocks();
    setFieldFloor.mockClear();
});

function renderControls(fieldProperties: FieldProperties) {
    const queryClient = new QueryClient();
    render(
        <QueryClientProvider client={queryClient}>
            <TolgeeProvider tolgee={tolgee} fallback="">
                <FieldFloorControls fieldProperties={fieldProperties} />
            </TolgeeProvider>
        </QueryClientProvider>,
    );
    return queryClient;
}

describe("FieldFloorControls (D-23, Q82)", () => {
    it("starts an artwork import pre-filled as a Base floor at the field's size", async () => {
        const startImport = vi.fn();
        useAssetsStore.setState({ startImport });
        renderControls(gym);

        await userEvent.click(screen.getByTestId("field-upload-floor"));

        const size = fieldFloorSize(gym);
        expect(startImport).toHaveBeenCalledWith(
            { editor: "client" },
            expect.objectContaining({
                purpose: "artwork",
                context: {
                    surface: "baseFloor",
                    size: {
                        width: { m: size.widthM },
                        height: { m: size.heightM },
                        source: "slot",
                        templateId: null,
                    },
                },
            }),
        );
    });

    it("makes the embedded import the floor and shows the field image", async () => {
        const startImport = vi.fn();
        useAssetsStore.setState({ startImport });
        const queryClient = renderControls(gym);
        const invalidate = vi.spyOn(queryClient, "invalidateQueries");

        await userEvent.click(screen.getByTestId("field-upload-floor"));
        const { onEmbedded } = startImport.mock.calls[0]![1];
        await onEmbedded([
            {
                item: { id: "new-floor", name: "Tarp" },
                versionHash: "b".repeat(64),
            },
        ]);

        expect(setFieldFloor).toHaveBeenCalledWith({
            db: { fake: "db" },
            floor: { itemId: "new-floor", versionHash: "b".repeat(64) },
            patch: { showFieldImage: true },
        });
        expect(invalidate).toHaveBeenCalled();
    });

    it("has no Remove and names no floor when the show has none", () => {
        renderControls(gym);
        expect(screen.queryByTestId("field-remove-floor")).toBeNull();
        expect(screen.getByTestId("field-floor-name")).toHaveTextContent(
            "No floor",
        );
    });

    it("names the floor and removes it", async () => {
        renderControls(new FieldProperties({ ...gym, floor }));
        expect(screen.getByTestId("field-floor-name")).toHaveTextContent(
            "Winter tarp",
        );

        await userEvent.click(screen.getByTestId("field-remove-floor"));

        expect(setFieldFloor).toHaveBeenCalledWith({
            db: { fake: "db" },
            floor: null,
        });
    });

    it("can't start a second import while one is under review", () => {
        useAssetsStore.setState({ review: {} as never });
        renderControls(gym);
        expect(screen.getByTestId("field-upload-floor")).toBeDisabled();
    });
});
