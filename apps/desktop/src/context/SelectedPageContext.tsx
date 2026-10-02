import {
    ReactNode,
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import Page from "@/global/classes/Page";
import { useTimingObjects } from "@/hooks";
import { useTimelineMode } from "@/hooks/queries/useWorkspaceSettings";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { pageAtPlayhead } from "@/timeline/timelinePlayhead";
import { selectTimelinePage } from "@/timeline/timelineTransport";

/**
 * The page the app is on.
 *
 * - **Page mode:** the selected page, set by clicking a page, page navigation and playback.
 * - **Timeline mode** (docs/timeline/ui.md UI-9 No selected page, C-12; P8.12): there is no
 *   selected page. Editing reads the selected timeline and rendering, playback and the inspector
 *   read the playhead (`useTimelineSelectionStore`). Data that still belongs to a page (notes,
 *   counts, tag appearances) reads the page containing the paused playhead or ending at it
 *   (`pageAtPlayhead`).
 *
 * Read the page with `useCurrentPage` and go to one with `usePageNavigation`; both work in either
 * mode. `useSelectedPage` is page mode's own and warns in development when it is read in timeline
 * mode (UI-9 Deprecating page selection). `SelectedPageContext` goes with page mode (Phase 10).
 */

type SelectedPageContextProps = {
    selectedPage: Page | null;
    setSelectedPage: (page: { id: number }) => void;
    /**
     * A page to select after once it exists. This is good for selecting a page right after it is created,
     * as it might not be immediately available in the pages list.
     */
    setPageToSelect: (page: { id: number }) => void;
};

/** Everything the provider holds; only this module reads the parts outside `SelectedPageContextProps`. */
type PageContextValue = SelectedPageContextProps & {
    /** The file's timeline flag */
    timelineMode: boolean;
    /** See `useCurrentPage` */
    currentPage: Page | null;
    navigation: PageNavigation;
};

/** Going to a page in either mode. See `usePageNavigation`. */
export interface PageNavigation {
    /**
     * Page mode: selects the page. Timeline mode: moves the playhead to the page's flag and selects
     * its timeline, or home for the first page (UI-9 Page-relative tools).
     */
    goToPage: (page: { id: number }) => void;
    /** `goToPage` once the page is in the page list, for a page that was just created. */
    goToPageWhenItExists: (page: { id: number }) => void;
}

const SelectedPageContext = createContext<PageContextValue | undefined>(
    undefined,
);

export function SelectedPageProvider({ children }: { children: ReactNode }) {
    const { pages } = useTimingObjects();
    const timelineMode = useTimelineMode();
    const playheadBeat = useTimelineSelectionStore((s) => s.playheadBeat);
    const [selectedPage, setSelectedPage] = useState<Page | null>(null);
    const pageToSelectRef = useRef<{ id: number } | null>(null);
    const setPageToSelect = useCallback((page: { id: number }) => {
        pageToSelectRef.current = page;
    }, []);
    const timelineModeRef = useRef(timelineMode);
    timelineModeRef.current = timelineMode;

    // Update the selected page if the pages list changes. This refreshes the information of the selected page
    useEffect(() => {
        let pageWasSet = false;
        const pageToSelect = pageToSelectRef.current;
        if (pageToSelect) {
            const page = pages.find((p) => p.id === pageToSelect.id);
            if (page) {
                pageToSelectRef.current = null;
                if (timelineModeRef.current) {
                    selectTimelinePage(pages, page.id);
                } else {
                    setSelectedPage(page);
                    pageWasSet = true;
                }
            }
        }
        if (!pageWasSet && selectedPage)
            setSelectedPage(
                pages.find((page) => page.id === selectedPage.id) || null,
            );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pages]);

    const setSelectedPageFromId = useCallback(
        (newPage: { id: number }) => {
            const page = pages.find((p) => p.id === newPage.id);
            if (page) setSelectedPage(page);
            else
                console.warn(
                    `Page with id ${newPage.id} not found. Not setting selected page.`,
                );
        },
        [pages],
    );

    const goToPage = useCallback(
        (page: { id: number }) => {
            if (timelineModeRef.current) {
                if (!selectTimelinePage(pages, page.id))
                    console.warn(
                        `Page with id ${page.id} not found. Not going to it.`,
                    );
            } else setSelectedPageFromId(page);
        },
        [pages, setSelectedPageFromId],
    );

    const playheadPage = useMemo(
        () => (timelineMode ? pageAtPlayhead(pages, playheadBeat) : null),
        [timelineMode, pages, playheadBeat],
    );
    const currentPage = timelineMode ? playheadPage : selectedPage;

    const navigation = useMemo<PageNavigation>(
        () => ({ goToPage, goToPageWhenItExists: setPageToSelect }),
        [goToPage, setPageToSelect],
    );

    const contextValue = useMemo<PageContextValue>(
        () => ({
            selectedPage,
            setSelectedPage: setSelectedPageFromId,
            setPageToSelect,
            timelineMode,
            currentPage,
            navigation,
        }),
        [
            selectedPage,
            setSelectedPageFromId,
            setPageToSelect,
            timelineMode,
            currentPage,
            navigation,
        ],
    );

    return (
        <SelectedPageContext.Provider value={contextValue}>
            {children}
        </SelectedPageContext.Provider>
    );
}

/** The warning `useSelectedPage` logs in development when it is read in timeline mode. */
export const SELECTED_PAGE_IN_TIMELINE_MODE_WARNING =
    "useSelectedPage was read in timeline mode, which has no selected page (docs/timeline/ui.md UI-9). Read useCurrentPage or the timeline selection instead.";

/**
 * Page mode's selected page. Timeline mode has none (see the module comment): use
 * `useCurrentPage`, `usePageNavigation` or `useTimelineSelectionStore` instead. In development, a
 * component that reads this in timeline mode logs `SELECTED_PAGE_IN_TIMELINE_MODE_WARNING` once.
 */
export function useSelectedPage(): SelectedPageContextProps | undefined {
    const context = useContext(SelectedPageContext);
    const readInTimelineMode = context?.timelineMode === true;
    useEffect(() => {
        if (readInTimelineMode && import.meta.env.DEV)
            console.warn(SELECTED_PAGE_IN_TIMELINE_MODE_WARNING);
    }, [readInTimelineMode]);
    return context;
}

/**
 * The page the app is on: the selected page in page mode; in timeline mode, the page containing
 * the paused playhead or ending at it (`pageAtPlayhead`). `null` before pages load.
 */
export function useCurrentPage(): Page | null {
    return useContext(SelectedPageContext)?.currentPage ?? null;
}

const NO_NAVIGATION: PageNavigation = {
    goToPage: () => undefined,
    goToPageWhenItExists: () => undefined,
};

/** Going to a page in either mode (see `PageNavigation`). */
export function usePageNavigation(): PageNavigation {
    return useContext(SelectedPageContext)?.navigation ?? NO_NAVIGATION;
}
