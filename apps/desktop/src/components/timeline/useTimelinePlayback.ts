import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsPlaying } from "@/context/IsPlayingContext";
import type Beat from "@/global/classes/Beat";
import type Page from "@/global/classes/Page";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { beatAtTime, beatIndexAtTime } from "@/timeline/timeMap";
import {
    navigateTimeline,
    pauseTimelinePlayback,
    playLoops as playLoopsOf,
    playTimeline,
    seekTimeline,
    stopTimelinePlayback,
} from "@/timeline/timelineTransport";
import { spacePlayKey } from "@/shortcuts/playKeys";
import { useShortcutOverridesStore } from "@/stores/ShortcutOverridesStore";
import {
    getLivePlaybackPosition,
    playbackStartInfoRef,
} from "./audio/AudioPlayer";
import type { TimelinePlayback } from "./Timeline";

interface PlaybackState {
    readonly beats: readonly Beat[];
    readonly pages: readonly Page[];
    readonly isPlaying: boolean;
    readonly setIsPlaying: (isPlaying: boolean) => void;
}

/** The playback commands, reading the latest state, so they keep their identity across beats */
const playbackCommands = (latest: {
    readonly current: PlaybackState;
}): Pick<
    TimelinePlayback,
    "onSeek" | "onNavigate" | "onPlayingChange" | "onStop"
> => ({
    // UI-12: while playing, a click or page button jumps playback there, and a scrub suspends it
    // until it ends (`seekTimeline`), which says where a scrub's seek landed
    onSeek: (beatIndex, options) => {
        const { beats, isPlaying, setIsPlaying } = latest.current;
        return seekTimeline(beats, beatIndex, options?.gesture, {
            isPlaying,
            setIsPlaying,
            line: options?.line,
        });
    },
    onNavigate: (direction) => {
        const { beats, pages, isPlaying } = latest.current;
        navigateTimeline(beats, pages, isPlaying, direction);
    },
    // UI-22: the Play button plays from the start flag; playing, it is Pause
    onPlayingChange: (next) => {
        const { isPlaying, setIsPlaying } = latest.current;
        if (next === isPlaying) return;
        if (next) playTimeline(setIsPlaying);
        else pauseTimelinePlayback(setIsPlaying);
    },
    onStop: () => {
        const { isPlaying, setIsPlaying } = latest.current;
        stopTimelinePlayback(isPlaying, setIsPlaying);
    },
});

const SPACE = "Space";
const SHIFT_SPACE = "Shift + Space";

/**
 * Feeds the timeline from the timeline-mode playhead (docs/timeline/ui.md UI-9, P8.11):
 * `useTimelineSelectionStore`'s paused playhead, `IsPlayingContext`, and the audio player's
 * `getLivePlaybackPosition`.
 *
 * - While playing, the cursor is `beatIndexAtTime(beats, seconds)`, updated once per animation
 *   frame and re-rendered only when the beat changes. With no beats it returns -1, which is never
 *   used as a position. The playhead line itself follows the fractional `liveBeat` every frame,
 *   without re-rendering the timeline.
 * - While paused, the cursor is the playhead, which rests on any whole beat, the end of the show
 *   included (UI-11).
 * - Seeking moves only the playhead; the selection stays. Page navigation moves the playhead to a
 *   flag and selects that page (`navigateTimelinePages`). While playing, both jump playback
 *   instead and leave the playhead alone (UI-12, `jumpTimelinePlayback`); a scrub suspends
 *   playback until it ends, then plays on from there once (`seekTimeline`, UI-12 review).
 * - Play (`playTimeline`, UI-22) plays from the start flag to the end flag, and loops there while
 *   looping is on. Pause freezes on the nearest beat; Stop goes to the end flag.
 */
export function useTimelinePlayback({
    beats,
    pages,
}: {
    beats: readonly Beat[];
    pages: readonly Page[];
}): TimelinePlayback {
    const { isPlaying, setIsPlaying } = useIsPlaying()!;
    const playheadBeat = useTimelineSelectionStore(displayedBeat);
    // UI-22: with looping on (or a move isolated), Play loops at the end flag
    const playLoops = useTimelineSelectionStore(playLoopsOf);
    // Which play key stops and which pauses (Settings)
    const space = useShortcutOverridesStore((s) => spacePlayKey(s.overrides));
    const playKeys = useMemo(
        () =>
            space === "stop"
                ? { stop: SPACE, pause: SHIFT_SPACE }
                : { stop: SHIFT_SPACE, pause: SPACE },
        [space],
    );
    const [liveIndex, setLiveIndex] = useState<number | null>(null);

    useEffect(() => {
        if (!isPlaying) {
            setLiveIndex(null);
            return;
        }
        let frame = 0;
        const update = () => {
            const index = beatIndexAtTime(beats, getLivePlaybackPosition());
            if (index >= 0) setLiveIndex(index);
            frame = requestAnimationFrame(update);
        };
        update();
        return () => cancelAnimationFrame(frame);
    }, [beats, isPlaying]);

    // The playhead line reads this every frame; nothing re-renders for it
    const liveBeat = useCallback(
        () =>
            playbackStartInfoRef.current
                ? beatAtTime(beats, getLivePlaybackPosition())
                : null,
        [beats],
    );

    const state: PlaybackState = {
        beats,
        pages,
        isPlaying,
        setIsPlaying,
    };
    const latest = useRef(state);
    latest.current = state;
    const commands = useMemo(() => playbackCommands(latest), []);

    return useMemo<TimelinePlayback>(
        () => ({
            liveBeat,
            positionBeat:
                isPlaying && liveIndex != null ? liveIndex : playheadBeat,
            isPlaying,
            playLoops,
            playKeys,
            ...commands,
        }),
        [
            commands,
            isPlaying,
            liveBeat,
            liveIndex,
            playheadBeat,
            playLoops,
            playKeys,
        ],
    );
}
