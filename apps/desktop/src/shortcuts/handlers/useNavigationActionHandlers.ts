import type { TimelineNavigation } from "@/components/timeline/TimelineViewModel";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useTimingObjects } from "@/hooks";
import { useMetronomeStore } from "@/stores/MetronomeStore";
import {
    navigateTimeline,
    pressTimelinePlayKey,
    stopTimelinePlayback,
    toggleTimelineLoop,
} from "@/timeline/timelineTransport";
import { useActionHandler } from "../useActionHandler";
import { useEditorReadiness } from "./useEditorReadiness";

// eslint-disable-next-line max-lines-per-function
export function useNavigationActionHandlers() {
    const { ready } = useEditorReadiness();
    const { pages, beats } = useTimingObjects()!;
    const isPlayingContext = useIsPlaying();
    const isPlaying = isPlayingContext?.isPlaying ?? false;
    const setIsPlaying = isPlayingContext?.setIsPlaying ?? (() => {});
    const toggleMetronome = useMetronomeStore()?.toggleMetronome ?? (() => {});
    const canNavigate = ready && !!pages && pages.length > 0;

    /**
     * UI-9: navigation moves the playhead to a flag and selects that page, or a beat on with Shift.
     * Playing, it jumps playback there, as the transport's Previous and Next do.
     */
    const navigate = (target: TimelineNavigation) =>
        navigateTimeline(beats, pages, isPlaying, target);

    const goNext = () => navigate("next-page");
    const goPrevious = () => navigate("previous-page");
    // Playing, each jump restarts the audio, so a held key jumps once rather than stuttering
    const enabled = { enabled: canNavigate, ignoreRepeat: isPlaying };

    useActionHandler("nextPage", goNext, enabled);
    useActionHandler("timelineNextPage", goNext, enabled);
    useActionHandler("previousPage", goPrevious, enabled);
    useActionHandler("timelinePreviousPage", goPrevious, enabled);
    useActionHandler("firstPage", () => navigate("first-page"), enabled);
    useActionHandler("lastPage", () => navigate("last-page"), enabled);
    useActionHandler("previousBeat", () => navigate("previous-beat"), enabled);
    useActionHandler("nextBeat", () => navigate("next-beat"), enabled);
    // UI-22: both play keys play from the start flag; playing, one stops at the end flag and the
    // other pauses on the nearest beat
    const play = { enabled: canNavigate };
    useActionHandler(
        "playStop",
        () => pressTimelinePlayKey("stop", isPlaying, setIsPlaying),
        play,
    );
    useActionHandler(
        "playPause",
        () => pressTimelinePlayKey("pause", isPlaying, setIsPlaying),
        play,
    );
    useActionHandler(
        "stopPlayback",
        () => stopTimelinePlayback(isPlaying, setIsPlaying),
        play,
    );
    // UI-22: C turns looping on or off
    useActionHandler("toggleLoop", () => toggleTimelineLoop(), {
        enabled: ready,
    });
    useActionHandler("toggleMetronome", () => toggleMetronome());
}
