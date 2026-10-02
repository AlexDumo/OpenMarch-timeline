import { act, renderHook } from "@testing-library/react";
import {
    SELECTED_PAGE_IN_TIMELINE_MODE_WARNING,
    useCurrentPage,
    usePageNavigation,
    useSelectedPage,
    SelectedPageProvider,
} from "@/context/SelectedPageContext";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { ElectronApi } from "electron/preload";
import { mockPages } from "@/__mocks__/globalMocks";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the electron api
window.electron = {
    sendSelectedPage: vi.fn(),
} as Partial<ElectronApi> as ElectronApi;

const mode = vi.hoisted(() => ({
    timeline: false,
    pages: null as unknown[] | null,
}));
vi.mock("@/hooks/queries/useWorkspaceSettings", () => ({
    useTimelineMode: () => mode.timeline,
}));

// Mock the useTimingObjects hook
vi.mock("@/hooks", () => ({
    useTimingObjects: vi.fn(() => ({
        pages: mode.pages ?? mockPages,
        measures: [],
        beats: [],
        fetchTimingObjects: vi.fn(),
        isLoading: false,
        hasError: false,
    })),
}));

describe("SelectedPageContext", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mode.timeline = false;
        mode.pages = null;
        useTimelineSelectionStore.getState().reset();
    });

    it("set selected page", async () => {
        const { result } = renderHook(() => useSelectedPage(), {
            wrapper: SelectedPageProvider,
        });
        const pages = mockPages;

        // copy the first marcher to avoid reference equality issues
        const expectedPage = pages[0];
        void act(() => result.current?.setSelectedPage(expectedPage));
        expect(result.current?.selectedPage).toEqual({ ...expectedPage });
    });

    it("set selected page - multiple changes", async () => {
        const { result } = renderHook(() => useSelectedPage(), {
            wrapper: SelectedPageProvider,
        });
        const pages = mockPages;

        // copy the page to avoid reference equality issues
        let expectedPage = pages[0];
        void act(() => result.current?.setSelectedPage(expectedPage));
        expect(result.current?.selectedPage).toEqual({ ...expectedPage });

        // copy the page to avoid reference equality issues
        expectedPage = pages[2];
        void act(() => result.current?.setSelectedPage(expectedPage));
        expect(result.current?.selectedPage).toEqual({ ...expectedPage });

        // copy the page to avoid reference equality issues
        expectedPage = pages[1];
        void act(() => result.current?.setSelectedPage(expectedPage));
        expect(result.current?.selectedPage).toEqual({ ...expectedPage });
    });

    it("page mode: the current page is the selected page, and going to a page selects it", () => {
        const { result } = renderHook(
            () => ({
                current: useCurrentPage(),
                navigation: usePageNavigation(),
            }),
            { wrapper: SelectedPageProvider },
        );
        void act(() => result.current.navigation.goToPage(mockPages[2]!));
        expect(result.current.current).toEqual({ ...mockPages[2] });
        expect(useTimelineSelectionStore.getState().selection).toEqual({
            kind: "home",
        });
    });
});

describe("SelectedPageContext in timeline mode (UI-9, P8.12)", () => {
    // Page 0 holds beat 0 (flag 0); page 1 is beats 1-4 (flag 5); page 2 is beats 5-8 (flag 9)
    const pages = [[0], [1, 2, 3, 4], [5, 6, 7, 8]].map((indexes, i) => ({
        ...mockPages[i]!,
        beats: indexes.map((index) => ({ index })),
    }));

    beforeEach(() => {
        mode.timeline = true;
        mode.pages = pages;
        useTimelineSelectionStore.getState().reset();
    });

    it("the current page is the page at the playhead, not a selected page", () => {
        const { result } = renderHook(() => useCurrentPage(), {
            wrapper: SelectedPageProvider,
        });
        expect(result.current?.id).toBe(pages[0]!.id);
        void act(() => useTimelineSelectionStore.getState().seek(9));
        expect(result.current?.id).toBe(pages[2]!.id);
        // Between flags: the page whose box holds the playhead
        void act(() => useTimelineSelectionStore.getState().seek(3));
        expect(result.current?.id).toBe(pages[1]!.id);
    });

    it("going to a page moves the playhead to its flag and selects its timeline", () => {
        const { result } = renderHook(() => usePageNavigation(), {
            wrapper: SelectedPageProvider,
        });
        void act(() => result.current.goToPage(pages[2]!));
        expect(useTimelineSelectionStore.getState()).toMatchObject({
            selection: { kind: "range", start: 5, end: 9 },
            playheadBeat: 9,
        });
        void act(() => result.current.goToPage(pages[0]!));
        expect(useTimelineSelectionStore.getState()).toMatchObject({
            selection: { kind: "home" },
            playheadBeat: 0,
        });
    });

    it("warns in development when useSelectedPage is read", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        renderHook(() => useSelectedPage(), { wrapper: SelectedPageProvider });
        expect(warn).toHaveBeenCalledWith(
            SELECTED_PAGE_IN_TIMELINE_MODE_WARNING,
        );
        warn.mockRestore();
    });

    it("doesn't warn for useCurrentPage or usePageNavigation", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        renderHook(
            () => ({ page: useCurrentPage(), nav: usePageNavigation() }),
            { wrapper: SelectedPageProvider },
        );
        expect(warn).not.toHaveBeenCalledWith(
            SELECTED_PAGE_IN_TIMELINE_MODE_WARNING,
        );
        warn.mockRestore();
    });
});
