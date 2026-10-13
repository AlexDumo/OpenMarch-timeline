import { createContext, type ReactNode, useContext } from "react";
import { useSelectedPage } from "@/context/SelectedPageContext";
import type Page from "@/global/classes/Page";
import { usePlayingPage } from "@/timeline/usePlayingPage";

/** The page being played in timeline mode, or `null` (see `usePlayingPage`) */
const PlayingPageContext = createContext<Page | null>(null);

/**
 * Runs the inspector's one playback-page loop (`usePlayingPage`) for every section under it, so
 * the page title, the marcher's coordinates and step sizes, and the notes all show the same page.
 */
export function InspectorPageProvider({ children }: { children: ReactNode }) {
    const playingPage = usePlayingPage();
    return (
        <PlayingPageContext.Provider value={playingPage}>
            {children}
        </PlayingPageContext.Provider>
    );
}

/**
 * The page the inspector shows: while timeline playback runs, the page being played (the selected
 * page waits for the stop); otherwise the selected page. `playing` is true while it is the page
 * being played, when the page's own edits wait for a pause (a click near a page line could land
 * on the next page).
 */
export function useInspectorPage(): {
    page: Page | null;
    playing: boolean;
} {
    const selectedPage = useSelectedPage()?.selectedPage ?? null;
    const playingPage = useContext(PlayingPageContext);
    return playingPage
        ? { page: playingPage, playing: true }
        : { page: selectedPage, playing: false };
}
