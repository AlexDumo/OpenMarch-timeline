import { useEffect, useRef, useState } from "react";
import {
    getLivePlaybackPosition,
    playbackStartInfoRef,
} from "@/components/timeline/audio/AudioPlayer";
import { useIsPlaying } from "@/context/IsPlayingContext";
import type Page from "@/global/classes/Page";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { useTimelineMode } from "@/hooks/queries/useWorkspaceSettings";
import { beatAtTime } from "./timeMap";
import { pageAtPlayhead } from "./timelinePlayhead";

/**
 * While timeline-mode playback runs, the page being played: the page box holding the live beat
 * (`pageAtPlayhead`, the rule the readout and Basic's edits use). `null` while paused, in page
 * mode, and before the audio starts.
 *
 * The selected page doesn't follow playback in timeline mode (`useTimelinePageBridge` waits until
 * it stops, as selecting a page re-renders everything that reads it), so the inspector reads this
 * instead while playing. It polls the audio position once per frame and re-renders its caller
 * only when the page changes.
 */
export function usePlayingPage(): Page | null {
    const timelineMode = useTimelineMode();
    const isPlaying = useIsPlaying()?.isPlaying ?? false;
    const { pages, beats } = useTimingObjects();
    const [pageId, setPageId] = useState<number | null>(null);
    const lastPageId = useRef<number | null>(null);

    useEffect(() => {
        const set = (id: number | null) => {
            if (id === lastPageId.current) return;
            lastPageId.current = id;
            setPageId(id);
        };
        if (!timelineMode || !isPlaying) {
            set(null);
            return;
        }
        let frame = 0;
        const update = () => {
            // No live position until the audio player has started
            if (playbackStartInfoRef.current)
                set(
                    pageAtPlayhead(
                        pages,
                        beatAtTime(beats, getLivePlaybackPosition()),
                    )?.id ?? null,
                );
            frame = requestAnimationFrame(update);
        };
        update();
        return () => cancelAnimationFrame(frame);
    }, [timelineMode, isPlaying, pages, beats]);

    if (pageId === null) return null;
    return pages.find((p) => p.id === pageId) ?? null;
}
