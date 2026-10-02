import { useEffect, useRef } from "react";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useSelectedPage } from "@/context/SelectedPageContext";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { pageAtPlayhead, pageFlags } from "./timelinePlayhead";

/**
 * TEMPORARY (until P8.12 removes the selected page in timeline mode): keeps the legacy selected
 * page on the page containing or ending at the paused playhead (`pageAtPlayhead`), so features
 * that still read `useSelectedPage` (the inspector, paths, page notes) follow the playhead.
 *
 * It also runs the other way: when something else selects a page (undo's page jump, a page-mode
 * code path, a test's `setSelectedPage`), the playhead moves to that page's flag. The selection
 * (home or a range) is never changed here; selecting a page doesn't select its timeline. Neither
 * direction runs while playing.
 */
export function useTimelinePageBridge(enabled: boolean): void {
    const { pages } = useTimingObjects();
    const selectedPageContext = useSelectedPage();
    const selectedPage = selectedPageContext?.selectedPage ?? null;
    const setSelectedPage = selectedPageContext?.setSelectedPage;
    const isPlaying = useIsPlaying()?.isPlaying ?? false;
    const playheadBeat = useTimelineSelectionStore((s) => s.playheadBeat);
    /** The page this bridge selected last, so its own write isn't read back as someone else's */
    const bridged = useRef<number | null>(null);
    const lastSeenPageId = useRef<number | null>(null);

    // Playhead to page
    useEffect(() => {
        if (!enabled || isPlaying || !setSelectedPage) return;
        const page = pageAtPlayhead(pages, playheadBeat);
        if (!page || page.id === selectedPage?.id) return;
        bridged.current = page.id;
        setSelectedPage(page);
        // Only the playhead and pages drive this direction
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, isPlaying, pages, playheadBeat, setSelectedPage]);

    // Page to playhead: only when the selected page changed, and not by the effect above
    useEffect(() => {
        const id = selectedPage?.id ?? null;
        const changed = id !== lastSeenPageId.current;
        lastSeenPageId.current = id;
        if (!enabled || isPlaying || !changed || id === null) return;
        if (id === bridged.current) return;
        bridged.current = id;
        const store = useTimelineSelectionStore.getState();
        if (pageAtPlayhead(pages, store.playheadBeat)?.id === id) return;
        const flag = pageFlags(pages).find((f) => f.page.id === id);
        if (flag) store.seek(flag.flag);
        // Only a change of the selected page drives this direction
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, selectedPage?.id]);
}
