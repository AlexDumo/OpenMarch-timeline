import { useIsPlaying } from "@/context/IsPlayingContext";
import { ClockIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { getLivePlaybackPosition } from "@/components/timeline/audio/AudioPlayer";
import { useCurrentPage } from "@/context/SelectedPageContext";
import { useTimingObjects } from "@/hooks";
import { useTimelineMode } from "@/hooks/queries/useWorkspaceSettings";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { timeAtBeat } from "@/timeline/timeMap";

/**
 * Live clock component that displays the current playback position
 */
export function AudioClock() {
    const { isPlaying } = useIsPlaying()!;
    const currentPage = useCurrentPage();
    const { beats } = useTimingObjects()!;
    // Timeline mode (UI-9): paused, the clock shows the playhead's time
    const timelineMode = useTimelineMode();
    const playheadBeat = useTimelineSelectionStore((s) => s.playheadBeat);
    const pausedTime = timelineMode
        ? timeAtBeat(beats, playheadBeat)
        : (currentPage?.timestamp ?? 0) + (currentPage?.duration ?? 0);
    const [displayTime, setDisplayTime] = useState<number>(0);

    // Animation frame loop to update the displayed time
    useEffect(() => {
        let rafId: number;

        const update = () => {
            setDisplayTime(getLivePlaybackPosition());
            rafId = requestAnimationFrame(update);
        };

        if (isPlaying) {
            update();
        } else {
            setDisplayTime(pausedTime);
        }

        return () => {
            cancelAnimationFrame(rafId);
        };
    }, [isPlaying, pausedTime]);

    // Helper function to format time in MM:SS.mmm format
    const formatTime = (seconds: number) => {
        const ms = Math.floor((seconds % 1) * 1000);
        const totalSeconds = Math.floor(seconds);
        const minutes = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
    };

    return (
        <div className="text-text flex items-center gap-6">
            <ClockIcon size={14} />
            <span className="font-mono text-xs">{formatTime(displayTime)}</span>
        </div>
    );
}
