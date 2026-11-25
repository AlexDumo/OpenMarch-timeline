/**
 * Custom uniforms (preview) in the 3D View settings (step 7 of the uniform artwork build): with
 * it off, no custom-uniform control shows, but a show whose band wears a custom uniform still
 * draws it and the picker lists it with a note; with it on, the controls show with the Preview
 * badge and the warning, and the warning shows once more as a note after the first save.
 */
import {
    act,
    cleanup,
    fireEvent,
    render,
    renderHook,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TolgeeProvider } from "@tolgee/react";
import {
    QueryClient,
    QueryClientProvider,
    queryOptions,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import tolgee from "@/global/singletons/Tolgee";
import { defaultVenueForKit } from "@/view3d/core/venueSettings";
import { sampleManifest } from "@/view3d/core/uniformPack/__test__/fixtures";
import {
    UNIFORM_PREVIEW_WARNED_STORAGE_KEY,
    useCustomUniformsStore,
} from "@/view3d/window/uniformArtworkPreview";
import { useFlatsWear } from "@/view3d/window/uniformPack/useFlatsWear";
import { UniformPicker } from "../VenueControls";
import { UniformTemplateControls } from "../UniformTemplateControls";
import { UniformImportControls } from "../UniformImportControls";
import { UniformItemsControls } from "../UniformItemsControls";
import { UniformModesControls } from "../UniformModesControls";

const ASSET = "8a6f2c1e-4b3d-4e5f-9a0b-1c2d3e4f5a6b";
const PACK = `library:${ASSET}@${"ab".repeat(32)}` as const;

const venue = { current: defaultVenueForKit("hs") as object };

vi.mock("@/hooks/queries/useVenueSettings", () => ({
    useVenueSettings: () => ({
        data: venue.current,
        isDefault: false,
        isLoading: false,
        hasError: false,
    }),
}));

vi.mock("@/view3d/window/performers/marchers/flatsAtlas", () => ({
    // never resolves: the item presets aren't needed here
    loadFlatsGeometry: () => new Promise(() => {}),
}));

const saved = vi.fn();
vi.mock("../saveFile", () => ({
    saveFile: (...args: unknown[]) => saved(...args),
}));

vi.mock("@/hooks/queries/useUniformPack", async (importOriginal) => {
    const original =
        await importOriginal<typeof import("@/hooks/queries/useUniformPack")>();
    return {
        ...original,
        uniformPacksQueryOptions: () =>
            queryOptions({
                queryKey: ["test", "packs"],
                queryFn: async () => [
                    {
                        id: ASSET,
                        value: PACK,
                        name: "Colleague's uniform",
                        versions: [PACK],
                    },
                ],
            }),
        uniformPackQueryOptions: (value: string | null | undefined) =>
            queryOptions({
                queryKey: ["test", "pack", value ?? ""],
                queryFn: async () =>
                    value === PACK
                        ? {
                              value: PACK,
                              name: "Colleague's uniform",
                              bytes: new Uint8Array([1, 2, 3]),
                              manifest: sampleManifest("Colleague's uniform"),
                              itemSizes: {},
                          }
                        : null,
                enabled: !!value,
            }),
    };
});

const wrapper = ({ children }: { children: ReactNode }) => (
    <TolgeeProvider tolgee={tolgee}>
        <QueryClientProvider client={new QueryClient()}>
            {children}
        </QueryClientProvider>
    </TolgeeProvider>
);

/** The Performers tab's uniform part */
const openPanel = () =>
    render(
        <>
            <UniformPicker />
            <UniformTemplateControls />
            <UniformImportControls />
            <UniformModesControls />
            <UniformItemsControls />
        </>,
        { wrapper },
    );

const setPreview = (on: boolean) => {
    void act(() => useCustomUniformsStore.getState().setEnabled(on));
};

const GATED = [
    "view3d-uniform-template",
    "view3d-uniform-import",
    "view3d-uniform-save",
    "view3d-uniform-items",
    "view3d-uniform-modes",
    "view3d-uniform-preview-warning",
    "view3d-uniform-preview-badge",
];

beforeAll(async () => {
    await tolgee.run();
});
afterEach(() => {
    cleanup();
    localStorage.clear();
    saved.mockReset();
    venue.current = defaultVenueForKit("hs");
});

describe("Custom uniforms (preview) off", () => {
    it("shows no custom-uniform control and no sample for a show in a preset", async () => {
        setPreview(false);
        openPanel();
        const picker = await screen.findByTestId("view3d-uniform-picker");
        for (const id of GATED) expect(screen.queryByTestId(id)).toBeNull();
        expect(picker.textContent).not.toContain("Sample flats");
        expect(picker.textContent).not.toContain("Colleague's uniform");
        expect(screen.queryByTestId("view3d-uniform-preview-worn")).toBeNull();
    });

    it("lists a colleague's custom uniform, picked, says the show uses a preview uniform and can turn it on", async () => {
        setPreview(false);
        venue.current = {
            ...defaultVenueForKit("hs"),
            uniformArtwork: PACK,
        };
        openPanel();
        const note = await screen.findByTestId("view3d-uniform-preview-worn");
        expect(note.textContent).toContain("This show uses a preview uniform.");
        const picker = screen.getByTestId("view3d-uniform-picker");
        await waitFor(() =>
            expect(picker.textContent).toContain("Colleague's uniform"),
        );
        // only the worn one: no sample and no editing controls
        expect(picker.textContent).not.toContain("Sample flats");
        for (const id of GATED) expect(screen.queryByTestId(id)).toBeNull();
        // presets are still there to pick
        expect(picker.querySelectorAll("button").length).toBeGreaterThan(2);

        fireEvent.click(screen.getByTestId("view3d-uniform-preview-turn-on"));
        expect(useCustomUniformsStore.getState().enabled).toBe(true);
        await screen.findByTestId("view3d-uniform-import");
        expect(screen.queryByTestId("view3d-uniform-preview-worn")).toBeNull();
    });

    it("still dresses the band in the show's custom uniform or the sample", async () => {
        setPreview(false);
        const { result } = renderHook(() => useFlatsWear(PACK), { wrapper });
        await waitFor(() => expect(result.current?.key).toBe(PACK));
        const sample = renderHook(() => useFlatsWear("sample"), { wrapper });
        expect(sample.result.current?.key).toBe("sample");
    });
});

describe("Custom uniforms (preview) on", () => {
    it("shows the template, import and save, items and modes, with the Preview badge and the warning", async () => {
        setPreview(true);
        venue.current = {
            ...defaultVenueForKit("hs"),
            uniformArtwork: PACK,
        };
        openPanel();
        await screen.findByTestId("view3d-uniform-items");
        for (const id of GATED.filter(
            (id) => id !== "view3d-uniform-preview-badge",
        ))
            expect(screen.getByTestId(id)).toBeTruthy();
        expect(
            screen.getAllByTestId("view3d-uniform-preview-badge").length,
        ).toBe(2);
        expect(
            screen.getByTestId("view3d-uniform-preview-warning").textContent,
        ).toBe(
            "Preview: uniform files may change in a later version of OpenMarch, and uniforms you make now may need to be imported again. Keep your original artwork.",
        );
        expect(
            screen.getByTestId("view3d-uniform-picker").textContent,
        ).toContain("Sample flats");
        expect(screen.queryByTestId("view3d-uniform-preview-worn")).toBeNull();
    });

    it("shows the warning as a note once, after the first save on this computer", async () => {
        setPreview(true);
        venue.current = {
            ...defaultVenueForKit("hs"),
            uniformArtwork: PACK,
        };
        openPanel();
        await screen.findByTestId("view3d-uniform-items");
        expect(screen.queryByTestId("view3d-uniform-preview-note")).toBeNull();

        fireEvent.click(screen.getByTestId("view3d-uniform-save"));
        expect(saved).toHaveBeenCalledTimes(1);
        expect(
            screen.getByTestId("view3d-uniform-preview-note").textContent,
        ).toContain("uniform files may change");
        expect(localStorage.getItem(UNIFORM_PREVIEW_WARNED_STORAGE_KEY)).toBe(
            "1",
        );
        fireEvent.click(
            screen.getByTestId("view3d-uniform-preview-note-dismiss"),
        );
        expect(screen.queryByTestId("view3d-uniform-preview-note")).toBeNull();

        fireEvent.click(screen.getByTestId("view3d-uniform-save"));
        expect(saved).toHaveBeenCalledTimes(2);
        expect(screen.queryByTestId("view3d-uniform-preview-note")).toBeNull();

        // and not in a new session either
        cleanup();
        openPanel();
        await screen.findByTestId("view3d-uniform-items");
        fireEvent.click(screen.getByTestId("view3d-uniform-save"));
        expect(screen.queryByTestId("view3d-uniform-preview-note")).toBeNull();
    });
});
