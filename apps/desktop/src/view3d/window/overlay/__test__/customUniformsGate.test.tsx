/**
 * Custom uniforms (preview) in the 3D View settings (step 7 of the uniform artwork build): with
 * it off, no custom-uniform control shows, but a show whose band wears a custom uniform still
 * draws it and the picker lists it with a note; with it on, the controls show with the Preview
 * badge and the warning, and the warning shows once more as a note after the first save. A
 * release build has none of it, and nothing offers to turn it on.
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
    _resetPreviewWarning,
    useCustomUniformsStore,
} from "@/view3d/window/uniformArtworkPreview";
import { useFlatsWear } from "@/view3d/window/uniformPack/useFlatsWear";
import { UniformPicker } from "../VenueControls";
import { UniformTemplateControls } from "../UniformTemplateControls";
import { UniformImportControls } from "../UniformImportControls";
import { UniformItemsControls } from "../UniformItemsControls";
import { UniformModesControls } from "../UniformModesControls";
import { CustomUniformsRow } from "../UniformPreview";

const ASSET = "8a6f2c1e-4b3d-4e5f-9a0b-1c2d3e4f5a6b";
const PACK = `library:${ASSET}@${"ab".repeat(32)}` as const;

const venue = { current: defaultVenueForKit("hs") as object };
/**
 * What the show holds: whether it has the uniform, and whether its file reads. A pack made by a
 * newer OpenMarch, and one that couldn't be loaded, go through the real read in
 * `uniformPickerReads.test.tsx`.
 */
const stored = {
    inShow: true,
    read: "ok" as "ok" | "unreadable",
};

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
                queryFn: async () =>
                    stored.inShow
                        ? [
                              {
                                  id: ASSET,
                                  value: PACK,
                                  name: "Colleague's uniform",
                                  versions: [PACK],
                              },
                          ]
                        : [],
            }),
        uniformPackQueryOptions: (value: string | null | undefined) =>
            queryOptions({
                queryKey: ["test", "pack", value ?? ""],
                queryFn: async () =>
                    value === PACK && stored.inShow && stored.read === "ok"
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
    useCustomUniformsStore.setState({ available: true });
    localStorage.clear();
    saved.mockReset();
    venue.current = defaultVenueForKit("hs");
    stored.inShow = true;
    stored.read = "ok";
    _resetPreviewWarning();
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
        expect(note.textContent).toContain(
            "This show's band wears a custom uniform, a preview feature.",
        );
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

describe("a custom uniform the band can't wear", () => {
    const wearing = () => {
        venue.current = { ...defaultVenueForKit("hs"), uniformArtwork: PACK };
    };

    it("says with the setting off that its file can't be read, and offers to turn the preview on", async () => {
        setPreview(false);
        stored.read = "unreadable";
        wearing();
        openPanel();
        const note = await screen.findByTestId("view3d-uniform-unreadable");
        expect(note.textContent).toBe(
            "The band's custom uniform is in this show, but its file can't be read, so the band wears its preset. Pick another uniform, or turn on custom uniforms to import one.",
        );
        expect(
            screen.getByTestId("view3d-uniform-preview-turn-on"),
        ).toBeTruthy();
        expect(
            screen.getByTestId("view3d-uniform-preview-worn").textContent,
        ).not.toContain("wears a custom uniform");
        for (const id of GATED) expect(screen.queryByTestId(id)).toBeNull();
    });

    it("says with the setting off that it isn't in the show anymore", async () => {
        setPreview(false);
        stored.inShow = false;
        wearing();
        openPanel();
        const note = await screen.findByTestId("view3d-uniform-missing");
        expect(note.textContent).toContain("isn't in this show anymore");
        expect(note.textContent).toContain(
            "turn on custom uniforms and import it again",
        );
        expect(
            screen.getByTestId("view3d-uniform-preview-turn-on"),
        ).toBeTruthy();
    });

    it("keeps the setting-on wording, once, under the picker", async () => {
        setPreview(true);
        stored.read = "unreadable";
        wearing();
        openPanel();
        await screen.findByTestId("view3d-uniform-import");
        const notes = await screen.findAllByTestId("view3d-uniform-unreadable");
        expect(notes).toHaveLength(1);
        expect(notes[0].textContent).toContain(
            "Pick another uniform, or import one.",
        );
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

describe("a build without custom uniforms (a release, until the format is final)", () => {
    // as if this computer had turned the setting on in a build that had it
    const release = () =>
        void act(() =>
            useCustomUniformsStore.setState({
                available: false,
                enabled: true,
            }),
        );

    it("has no Custom uniforms switch in Preferences, and the setting can't be turned on", () => {
        release();
        const { container } = render(<CustomUniformsRow />, { wrapper });
        expect(container.textContent).toBe("");
        expect(
            screen.queryByTestId("view3d-custom-uniforms-toggle"),
        ).toBeNull();
        useCustomUniformsStore.getState().setEnabled(true);
        expect(localStorage.getItem("view3d.uniformArtwork")).toBeNull();
    });

    it("offers the built-in uniforms only, with no custom-uniform control", async () => {
        release();
        openPanel();
        const picker = await screen.findByTestId("view3d-uniform-picker");
        for (const id of GATED) expect(screen.queryByTestId(id)).toBeNull();
        expect(picker.textContent).not.toContain("Sample flats");
        expect(picker.textContent).not.toContain("Colleague's uniform");
        expect(picker.querySelectorAll("button").length).toBeGreaterThan(2);
    });

    it("still lists a show's custom uniform, picked, without offering to turn anything on", async () => {
        release();
        venue.current = { ...defaultVenueForKit("hs"), uniformArtwork: PACK };
        openPanel();
        const note = await screen.findByTestId("view3d-uniform-preview-worn");
        expect(note.textContent).toBe(
            "This show's band wears a custom uniform. Making custom uniforms isn't in this version of OpenMarch yet.",
        );
        await waitFor(() =>
            expect(
                screen.getByTestId("view3d-uniform-picker").textContent,
            ).toContain("Colleague's uniform"),
        );
        expect(
            screen.queryByTestId("view3d-uniform-preview-turn-on"),
        ).toBeNull();
        for (const id of GATED) expect(screen.queryByTestId(id)).toBeNull();
    });

    it("words the notes for a uniform the band can't wear without saying to turn anything on", async () => {
        release();
        stored.read = "unreadable";
        venue.current = { ...defaultVenueForKit("hs"), uniformArtwork: PACK };
        openPanel();
        expect(
            (await screen.findByTestId("view3d-uniform-unreadable"))
                .textContent,
        ).toBe(
            "The band's custom uniform is in this show, but its file can't be read, so the band wears its preset. Pick another uniform.",
        );
        expect(screen.queryByTestId("view3d-uniform-preview-worn")).toBeNull();

        cleanup();
        stored.read = "ok";
        stored.inShow = false;
        openPanel();
        expect(
            (await screen.findByTestId("view3d-uniform-missing")).textContent,
        ).toBe(
            "The band's custom uniform isn't in this show anymore, so the band wears its preset.",
        );
        expect(screen.queryByTestId("view3d-uniform-preview-worn")).toBeNull();
    });
});
