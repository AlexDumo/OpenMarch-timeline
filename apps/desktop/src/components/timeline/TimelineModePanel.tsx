import { useMemo } from "react";
import { CornersInIcon, CornersOutIcon } from "@phosphor-icons/react";
import { useTimingObjects } from "@/hooks";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { db } from "@/global/database/db";
import {
    useTimelineSelectionStore,
    type TimelineEditSelection,
} from "@/stores/TimelineSelectionStore";
import { useTimelineMode } from "@/hooks/queries/useWorkspaceSettings";
import { useTimelineTracks } from "@/timeline/useTimelineTracks";
import { useFullscreenStore } from "@/stores/FullscreenStore";
import { AudioClock } from "./Clock";
import {
    TimelineMetronomeButton,
    TimelineMuteButton,
} from "./TimelineControls";
import { Timeline, type TimelineSelection } from "./Timeline";
import { useTimelineCommands } from "./useTimelineCommands";
import { useTimelinePlayback } from "./useTimelinePlayback";

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

/** The store's selection as the timeline draws it (spec beats; `Timeline` maps them to its axis) */
export const toTimelineSelection = (
    selection: TimelineEditSelection,
): TimelineSelection =>
    selection.kind === "range"
        ? {
              kind: "range",
              range: {
                  startBeatIndex: selection.start,
                  endBeatIndex: selection.end,
              },
          }
        : selection.kind === "home"
          ? { kind: "home" }
          : null;

/**
 * The timeline (ui.md, from the 0.2 branch) for a file whose timeline dev flag is on. It takes the
 * file's real beats, pages and measures, and plays through the app's existing audio clock. Its
 * selection is `useTimelineSelectionStore`'s (UI-9): the initial page box selects home, a page box
 * or a dragged range selects that range, and each seeks (home to beat 0, a range to its end).
 */
export default function TimelineModePanel() {
    const { beats, pages, measures } = useTimingObjects()!;
    const playback = useTimelinePlayback({ beats, pages });
    const editSelection = useTimelineSelectionStore((s) => s.selection);
    const selection = useMemo(
        () => toTimelineSelection(editSelection),
        [editSelection],
    );
    const { isPlaying } = useIsPlaying()!;
    const selectedMarchers = useSelectedMarchers()?.selectedMarchers;
    const selectedIdsKey = (selectedMarchers ?? []).map((m) => m.id).join(",");
    const selectedMarcherIds = useMemo(
        () =>
            new Set(
                selectedIdsKey === ""
                    ? []
                    : selectedIdsKey.split(",").map(Number),
            ),
        [selectedIdsKey],
    );
    const timelines = useTimelineTracks({
        database: db,
        enabled: useTimelineMode(),
    });
    const commands = useTimelineCommands({
        database: db,
        timelines,
        selectedMarcherIds,
    });
    // UI-9: selecting home seeks to beat 0 and a range to its end; not while playing
    const changeSelection = (next: TimelineSelection) => {
        if (isPlaying) return;
        const store = useTimelineSelectionStore.getState();
        if (next?.kind === "home") store.selectHome();
        else if (next?.kind === "range")
            store.selectRange(
                next.range.startBeatIndex,
                next.range.endBeatIndex,
            );
        else store.selectNothing();
    };

    return (
        <Timeline
            mode="expanded"
            className="w-full"
            beats={beats}
            pages={pages}
            measures={measures}
            timelines={timelines}
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
            selectedTarget={commands.selectedTarget}
            onSelectionChange={changeSelection}
            onTimelineRangeCommit={commands.commitTimelineRange}
            onCreateTrack={commands.createTrack}
            addSelectedMarchers={commands.addSelectedMarchers}
        />
    );
}
