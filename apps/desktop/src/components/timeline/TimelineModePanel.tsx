import { useState } from "react";
import { CornersInIcon, CornersOutIcon } from "@phosphor-icons/react";
import { useTimingObjects } from "@/hooks";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useSelectedPage } from "@/context/SelectedPageContext";
import { useFullscreenStore } from "@/stores/FullscreenStore";
import { AudioClock } from "./Clock";
import {
    TimelineMetronomeButton,
    TimelineMuteButton,
} from "./TimelineControls";
import {
    Timeline,
    type TimelineCreateTrackRequest,
    type TimelineInput,
    type TimelineSelection,
} from "./Timeline";
import type { TimelineRangeChange } from "./TimelineViewModel";
import { useTimelinePlayback } from "./useTimelinePlayback";

/**
 * No tracks until the view-model adapter (P8.8) builds them from the stored tables and the
 * resolver. Nothing here is fixture data.
 */
// TODO(P8.8): replace with the adapter's tracks for the open file.
const NO_TIMELINES: readonly TimelineInput[] = [];

// TODO(P8.9): move the whole spec timeline through the write path (ui.md: TimelineRangeChange).
const commitTimelineRange = (_change: TimelineRangeChange) => {};

// TODO(P8.9): create a timeline, transition and assignments in one edit, and pass the selected
// marcher or shape as `selectedTarget` so Create Track appears.
const createTrack = (_request: TimelineCreateTrackRequest) => {};

/** The page timeline's fullscreen toggle, for the timeline's transport */
function FullscreenButton() {
    const { isFullscreen, toggleFullscreen } = useFullscreenStore();
    return (
        <button
            className="text-text enabled:hover:text-accent focus-visible:ring-accent duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none"
            onClick={toggleFullscreen}
            aria-label="Toggle timeline fullscreen"
            aria-pressed={isFullscreen}
        >
            {isFullscreen ? (
                <CornersInIcon size={20} />
            ) : (
                <CornersOutIcon size={20} />
            )}
        </button>
    );
}

/**
 * The timeline (ui.md, from the 0.2 branch) for a file whose timeline dev flag is on. It takes the
 * file's real beats, pages and measures, and plays through the app's existing audio clock.
 */
export default function TimelineModePanel() {
    const { beats, pages, measures } = useTimingObjects()!;
    const playback = useTimelinePlayback({ beats, pages });
    const [selection, setSelection] = useState<TimelineSelection>(null);
    const { isPlaying } = useIsPlaying()!;
    const { setSelectedPage } = useSelectedPage()!;
    const changeSelection = (next: TimelineSelection) => {
        setSelection(next);
        // Clicking a page in the ruler also seeks to its first beat, which `pageForSeek` reads as
        // the end of the page before it. Select the clicked page itself.
        if (next?.kind === "page" && !isPlaying)
            setSelectedPage({ id: Number(next.pageId) });
    };

    return (
        <Timeline
            mode="expanded"
            className="w-full"
            beats={beats}
            pages={pages}
            measures={measures}
            timelines={NO_TIMELINES}
            playback={playback}
            transportClock={<AudioClock />}
            transportAccessories={
                <>
                    <TimelineMuteButton />
                    <TimelineMetronomeButton />
                    <FullscreenButton />
                </>
            }
            selection={selection}
            selectedTarget={null}
            onSelectionChange={changeSelection}
            onTimelineRangeCommit={commitTimelineRange}
            onCreateTrack={createTrack}
        />
    );
}
