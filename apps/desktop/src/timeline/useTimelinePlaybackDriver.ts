import { useEffect, useRef } from "react";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import {
    getLivePlaybackPosition,
    playbackStartInfoRef,
    restartLivePlaybackAt,
} from "@/components/timeline/audio/AudioPlayer";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { beatAtTime, timeAtBeat } from "./timeMap";
import { playbackStep } from "./timelinePlayhead";
import { consumeStopRequest, consumeSuspendRequest } from "./timelineTransport";

/**
 * Timeline mode's playback rules while playing (docs/timeline/ui.md UI-9 Play, UI-11, UI-22; P8.11),
 * once per animation frame, independent of the canvas. Playing never writes the playhead P; it
 * moves the store's cursor instead (`cue`).
 *
 * - **Play** (a preview, UI-22) runs from the start flag to the end flag, and loops there while
 *   looping is on. Run out at the end flag, or stopped (`stopTimelinePlayback`), the playhead goes
 *   to the end flag (`stopAtEnd`). Paused (`pauseTimelinePlayback`), it freezes on the nearest
 *   beat (`pauseAt`), and the flags stay.
 * - **Playing on** (playback started outside the transport, or Play's run jumped past its flags)
 *   stops at the end of the show; an isolated timeline loops over its range instead. Stop and
 *   pause end it as they end Play; stopped from anywhere else, P moves to the last whole beat
 *   played (`seek`).
 * - Navigation while playing (`haltTimelinePlayback`) stops it and moves the flags and P itself.
 * - A scrub's suspension (`suspendTimelinePlayback`, UI-12 review) pauses without writing P or the
 *   cursor: the scrub moves the cursor, and resumes playback when it ends.
 *
 * Nothing follows playback while `enabled` is false.
 */
export function useTimelinePlaybackDriver(enabled: boolean): void {
    const { beats } = useTimingObjects();
    const isPlayingContext = useIsPlaying();
    const isPlaying = isPlayingContext?.isPlaying ?? false;
    const setIsPlaying = isPlayingContext?.setIsPlaying;
    const lastLiveBeat = useRef<number | null>(null);

    // The furthest the playhead can go
    useEffect(() => {
        const store = useTimelineSelectionStore.getState();
        // Unknown (no clamp) until the beats load
        store.setShowEndBeat(enabled && beats.length > 0 ? beats.length : null);
    }, [enabled, beats.length]);

    // Pausing
    useEffect(() => {
        if (!enabled) return;
        if (isPlaying) {
            lastLiveBeat.current = null;
            // Started outside the transport: it plays on from where the audio starts
            const store = useTimelineSelectionStore.getState();
            if (store.playback === null) store.setPlayback({ kind: "on" });
            return;
        }
        const store = useTimelineSelectionStore.getState();
        const run = store.playback;
        const suspended = consumeSuspendRequest();
        const request = consumeStopRequest();
        const live = lastLiveBeat.current;
        lastLiveBeat.current = null;
        if (run === null) return;
        store.setPlayback(null);
        // A halt leaves the playhead to the navigation that stopped playback (UI-22)
        if (suspended || request === "halt") return;
        // UI-22: a pause freezes on the nearest beat played (after Play's start flag, so the
        // window stays on the move), and the flags stay
        if (request === "pause" && live !== null) {
            store.pauseAt(
                Math.round(live),
                run.kind === "preview" ? run.from : undefined,
            );
            return;
        }
        // Stop, Play's run ending, or a pause before the audio started: to the end flag
        if (request !== null || run.kind === "preview") {
            store.stopAtEnd();
            return;
        }
        // Playing on, stopped from outside the transport, stops where it is
        if (live === null) {
            store.clearCursor();
            return;
        }
        store.seek(Math.min(Math.floor(live), beats.length));
    }, [enabled, isPlaying, beats.length]);

    useEffect(() => {
        if (!enabled || !isPlaying || !setIsPlaying) return;
        let frame = 0;
        const tick = () => {
            const store = useTimelineSelectionStore.getState();
            // No live position until the audio player has started
            if (playbackStartInfoRef.current && store.playback) {
                const live = beatAtTime(beats, getLivePlaybackPosition());
                lastLiveBeat.current = live;
                const step = playbackStep(
                    store.playback,
                    live,
                    beats.length,
                    store.isolation,
                );
                if (step === "stop") {
                    lastLiveBeat.current = beats.length;
                    setIsPlaying(false);
                    return;
                }
                if (step) {
                    restartLivePlaybackAt(timeAtBeat(beats, step.loopTo));
                    lastLiveBeat.current = step.loopTo;
                    store.cue(step.loopTo);
                }
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [enabled, isPlaying, beats, setIsPlaying]);
}
