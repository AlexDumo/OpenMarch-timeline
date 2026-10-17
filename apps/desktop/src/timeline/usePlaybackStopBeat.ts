import { useMemo } from "react";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { pageEndBeat } from "./pageEndBeat";
import { playbackStopBeat } from "./endlessTimeline";
import { musicEndSeconds } from "./showLength";
import { useAudioEnvelopeStore, WAVEFORM_FLOOR_DB } from "./timelineWaveform";

/** Where the music ends on the show's clock (`musicEndSeconds`), or null without music */
export function useMusicEndSeconds(): number | null {
    const envelope = useAudioEnvelopeStore((s) => s.envelope);
    return useMemo(
        () => (envelope ? musicEndSeconds(envelope, WAVEFORM_FLOOR_DB) : null),
        [envelope],
    );
}

/**
 * Where playing on stops, and what Fit fits (docs/tempo/endless-counts.md rules 6 and 7): the
 * latest of the show's end (the last page's flag), the music's end and the last move's end, as a
 * spec beat.
 */
export function usePlaybackStopBeat(): number {
    const { pages, countGrid } = useTimingObjects();
    const musicEnd = useMusicEndSeconds();
    const lastMoveEnd = useTimelineSelectionStore((s) =>
        (s.storedTimelines ?? []).reduce(
            (end, timeline) => Math.max(end, timeline.end),
            0,
        ),
    );
    const lastPage = pages[pages.length - 1];
    return playbackStopBeat({
        grid: countGrid,
        showEndBeat: lastPage ? pageEndBeat(lastPage) : 0,
        musicEndSeconds: musicEnd,
        lastMoveEndBeat: lastMoveEnd,
    });
}
