/**
 * The uniform picker's notes when the band's custom uniform doesn't draw, through the real read
 * (`uniformPackQueryOptions`, `uniformPackIsNewer`): only the worker and the show's stored assets
 * are stood in for. A pack refused as made by a newer OpenMarch says to update; a read that still
 * fails after its retries (a worker that ran out of time) says it couldn't be loaded, apart from
 * a damaged file, with Try again, whatever the setting; and so does a failed list of the show's
 * uniforms.
 */
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
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
import {
    UNIFORM_ASSET_KIND,
    UNIFORM_PACK_PART,
} from "@/view3d/core/uniformPack/format";
import { useCustomUniformsStore } from "@/view3d/window/uniformArtworkPreview";
import { UniformPicker } from "../VenueControls";

const ASSET = "8a6f2c1e-4b3d-4e5f-9a0b-1c2d3e4f5a6b";
const VERSION = "cd".repeat(32);
const PACK = `library:${ASSET}@${VERSION}` as const;
const NAME = "Colleague's uniform";

const venue = { current: defaultVenueForKit("hs") as object };
/** What the worker does with a read, and whether listing the show's assets fails */
const show = vi.hoisted(() => ({
    job: "ok" as "ok" | "newer" | "timedOut" | "held",
    /** While `job` is "held", a read waits for this, then reads fine */
    release: null as null | (() => void),
    listFails: false,
    jobs: 0,
}));

vi.mock("@/hooks/queries/useVenueSettings", () => ({
    useVenueSettings: () => ({
        data: venue.current,
        isDefault: false,
        isLoading: false,
        hasError: false,
    }),
}));

vi.mock("@/hooks/queries/useShowAssets", async (importOriginal) => {
    const original =
        await importOriginal<typeof import("@/hooks/queries/useShowAssets")>();
    return {
        ...original,
        showAssetsQueryOptions: () =>
            queryOptions({
                queryKey: original.showAssetKeys.all(),
                queryFn: async () => {
                    if (show.listFails)
                        throw new Error("the assets couldn't be read");
                    return [
                        {
                            id: ASSET,
                            versionHash: VERSION,
                            kind: UNIFORM_ASSET_KIND,
                            name: NAME,
                            parts: { [UNIFORM_PACK_PART]: "pack-hash" },
                            sidecar: {},
                            credits: {},
                            createdAt: "",
                        },
                    ];
                },
                retry: false,
            }),
        showAssetBlobCache: { get: async () => new Uint8Array([1, 2, 3]) },
    };
});

vi.mock("@/db-functions/view3dUniformPack", async (importOriginal) => ({
    ...(await importOriginal<
        typeof import("@/db-functions/view3dUniformPack")
    >()),
    resolveStoredUniformPack: async ({ value }: { value: string }) =>
        value === PACK ? { value: PACK, name: NAME, hash: "pack-hash" } : null,
}));

vi.mock("@/view3d/uniformPack/runUniformPackJob", async () => {
    const { UniformPackJobError } =
        await import("@/view3d/uniformPack/protocol");
    const { sampleManifest } =
        await import("@/view3d/core/uniformPack/__test__/fixtures");
    return {
        runUniformPackJob: async () => {
            show.jobs++;
            if (show.job === "held")
                await new Promise<void>((resolve) => (show.release = resolve));
            if (show.job === "newer")
                throw new UniformPackJobError("newer", "a later format");
            if (show.job === "timedOut")
                throw new UniformPackJobError("timedOut", "out of time");
            return {
                type: "pack",
                manifest: sampleManifest(NAME),
                notes: [],
                itemSizes: {},
                decoded: [],
            };
        },
    };
});

const wrapper = ({ children }: { children: ReactNode }) => (
    <TolgeeProvider tolgee={tolgee}>
        {/* retries at once, so a read that keeps failing ends quickly */}
        <QueryClientProvider
            client={
                new QueryClient({
                    defaultOptions: { queries: { retryDelay: 0 } },
                })
            }
        >
            {children}
        </QueryClientProvider>
    </TolgeeProvider>
);

const setPreview = (on: boolean) => {
    void act(() => useCustomUniformsStore.getState().setEnabled(on));
};
const wearing = () => {
    venue.current = { ...defaultVenueForKit("hs"), uniformArtwork: PACK };
};

beforeAll(async () => {
    await tolgee.run();
});
afterEach(() => {
    cleanup();
    localStorage.clear();
    venue.current = defaultVenueForKit("hs");
    show.job = "ok";
    show.listFails = false;
    show.jobs = 0;
    show.release = null;
});

describe("the uniform picker's notes, through the real read", () => {
    it("tells the person to update OpenMarch when the worker says it was made by a newer one, with the setting off or on", async () => {
        show.job = "newer";
        wearing();
        for (const on of [false, true]) {
            setPreview(on);
            render(<UniformPicker />, { wrapper });
            const note = await screen.findByTestId("view3d-uniform-newer");
            expect(note.textContent).toBe(
                "The band's uniform was made with a newer version of OpenMarch, so the band wears its preset. Update OpenMarch to see it.",
            );
            expect(
                screen.queryByTestId("view3d-uniform-preview-turn-on"),
            ).toBeNull();
            expect(
                screen.queryByTestId("view3d-uniform-loadFailed"),
            ).toBeNull();
            cleanup();
        }
    });

    it("says the uniform couldn't be loaded, not that it's damaged, when reads keep running out of time, and Try again loads it", async () => {
        show.job = "timedOut";
        wearing();
        for (const on of [false, true]) {
            setPreview(on);
            render(<UniformPicker />, { wrapper });
            const note = await screen.findByTestId("view3d-uniform-loadFailed");
            expect(note.textContent).toContain(
                "The band's uniform couldn't be loaded just now, so the band wears its preset for now. Its file may be fine.",
            );
            // tried, and tried again, before saying so
            expect(show.jobs).toBeGreaterThan(1);
            expect(
                screen.queryByTestId("view3d-uniform-unreadable"),
            ).toBeNull();
            // trying again is the fix, not the preview
            expect(
                screen.queryByTestId("view3d-uniform-preview-turn-on"),
            ).toBeNull();
            cleanup();
        }

        setPreview(false);
        render(<UniformPicker />, { wrapper });
        await screen.findByTestId("view3d-uniform-loadFailed");
        show.job = "ok";
        fireEvent.click(screen.getByTestId("view3d-uniform-try-again"));
        // it reads now: the band wears it, and the picker lists it, picked
        await screen.findByTestId("view3d-uniform-preview-worn");
        expect(screen.queryByTestId("view3d-uniform-loadFailed")).toBeNull();
        expect(
            screen.getByTestId("view3d-uniform-picker").textContent,
        ).toContain(NAME);
    });

    it("says only the list failed when the band's uniform still reads, and keeps it picked, with the setting off", async () => {
        show.listFails = true;
        wearing();
        setPreview(false);
        render(<UniformPicker />, { wrapper });
        const note = await screen.findByTestId("view3d-uniform-list-failed");
        expect(note.textContent).toContain(
            "The list of the show's custom uniforms couldn't be loaded just now",
        );
        // the band wears it: no load failure, and the picker shows it, picked
        expect(screen.queryByTestId("view3d-uniform-loadFailed")).toBeNull();
        await screen.findByTestId("view3d-uniform-preview-worn");
        const picker = screen.getByTestId("view3d-uniform-picker");
        expect(
            picker
                .querySelector(`[data-value="${PACK}"]`)
                ?.getAttribute("aria-checked"),
        ).toBe("true");
        show.listFails = false;
        fireEvent.click(screen.getByTestId("view3d-uniform-try-again"));
        await vi.waitFor(() =>
            expect(
                screen.queryByTestId("view3d-uniform-list-failed"),
            ).toBeNull(),
        );
    });

    it("shows Loading…, disabled, while Try again runs, and a second click doesn't start it over", async () => {
        show.job = "timedOut";
        wearing();
        setPreview(false);
        render(<UniformPicker />, { wrapper });
        await screen.findByTestId("view3d-uniform-loadFailed");
        show.job = "held";
        const button = screen.getByTestId("view3d-uniform-try-again");
        fireEvent.click(button);
        await vi.waitFor(() => expect(show.release).not.toBeNull());
        expect(button.textContent).toBe("Loading…");
        expect((button as HTMLButtonElement).disabled).toBe(true);
        const jobs = show.jobs;
        fireEvent.click(button);
        await act(async () => {});
        expect(show.jobs).toBe(jobs);
        // the read finishes: the band wears it
        show.job = "ok";
        act(() => show.release!());
        await screen.findByTestId("view3d-uniform-preview-worn");
        // the note goes once Try again settles, which can be a tick after the worn note shows
        await vi.waitFor(() =>
            expect(
                screen.queryByTestId("view3d-uniform-loadFailed"),
            ).toBeNull(),
        );
    });

    it("says the show's uniforms couldn't be listed, with the setting on and the band in a preset", async () => {
        show.listFails = true;
        setPreview(true);
        render(<UniformPicker />, { wrapper });
        const note = await screen.findByTestId("view3d-uniform-list-failed");
        expect(note.textContent).toContain(
            "The list of the show's custom uniforms couldn't be loaded just now",
        );
        show.listFails = false;
        fireEvent.click(screen.getByTestId("view3d-uniform-try-again"));
        const picker = screen.getByTestId("view3d-uniform-picker");
        await vi.waitFor(() => expect(picker.textContent).toContain(NAME));
        expect(screen.queryByTestId("view3d-uniform-list-failed")).toBeNull();
    });

    it("says nothing with the setting off and the band in a preset, even if the list fails", async () => {
        show.listFails = true;
        setPreview(false);
        render(<UniformPicker />, { wrapper });
        await screen.findByTestId("view3d-uniform-picker");
        await act(async () => {});
        expect(screen.queryByTestId("view3d-uniform-list-failed")).toBeNull();
        expect(screen.queryByTestId("view3d-uniform-loadFailed")).toBeNull();
    });
});
