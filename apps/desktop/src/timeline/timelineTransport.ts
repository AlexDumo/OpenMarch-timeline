import type { TimelineNavigation } from "@/components/timeline/TimelineViewModel";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import {
    canPlayOn,
    navigationTarget,
    previewBounds,
    type FlagPage,
} from "./timelinePlayhead";

/**
 * The timeline-mode transport (docs/timeline/ui.md UI-9; P8.11), shared by the timeline's
 * transport buttons and the registered actions (shortcuts, menus). These drive
 * `useTimelineSelectionStore`; page mode keeps its own page-based transport.
 */

/** Set by `stopTimelinePlayback` while playing, so the pause that follows returns to the playhead. */
let stopRequested = false;

/**
 * Page navigation (UI-9 Page-relative tools): moves the playhead to the target flag and selects
 * that page's timeline, or home for the first page. Returns false when there is nowhere to go.
 * Callers don't navigate while playing.
 */
export function navigateTimelinePages(
    pages: readonly FlagPage[],
    direction: TimelineNavigation,
): boolean {
    const state = useTimelineSelectionStore.getState();
    const target = navigationTarget(pages, state.playheadBeat, direction);
    if (!target) return false;
    if (target.range) state.selectRange(target.range.start, target.range.end);
    else state.selectHome();
    return true;
}

/**
 * **Play** (UI-11): previews the window, from a little before the start flag to a little after
 * the playhead (`previewBounds`), looping when the loop is on. A paused preview holding a frame
 * inside those bounds resumes from it. With no window to preview (home), it plays on instead.
 * Returns false, and doesn't start, when there's nothing to play.
 *
 * @param showEndBeat the end of the show, `beats.length`
 */
export function startTimelinePlayback(
    showEndBeat: number,
    setIsPlaying: (isPlaying: boolean) => void,
): boolean {
    const state = useTimelineSelectionStore.getState();
    const bounds = previewBounds(state, showEndBeat);
    if (!bounds) return startTimelinePlayOn(showEndBeat, setIsPlaying);
    // A Stop whose pause never landed (pressed with a stale isPlaying) mustn't turn the next
    // ordinary pause into a return
    stopRequested = false;
    const held = state.cursorBeat;
    const resume = held !== null && held >= bounds.from && held < bounds.to;
    state.cue(resume ? held : bounds.from);
    state.setPlayback({ kind: "preview", ...bounds });
    setIsPlaying(true);
    return true;
}

/**
 * **Play on** (UI-11, the P key): plays from the playhead, or from the frame a paused preview
 * holds, to the end of the show, as UI-10's Play did. Returns false when there's nothing after it.
 */
export function startTimelinePlayOn(
    showEndBeat: number,
    setIsPlaying: (isPlaying: boolean) => void,
): boolean {
    const state = useTimelineSelectionStore.getState();
    const start = state.cursorBeat ?? state.playheadBeat;
    if (!canPlayOn(start, showEndBeat)) return false;
    stopRequested = false;
    state.cue(start);
    state.setPlayback({ kind: "on" });
    setIsPlaying(true);
    return true;
}

/**
 * Play/pause from the transport or the shortcut (Space): pausing keeps the selection; playing
 * previews the window (`startTimelinePlayback`).
 */
export function toggleTimelinePlayback({
    isPlaying,
    showEndBeat,
    setIsPlaying,
}: {
    isPlaying: boolean;
    showEndBeat: number;
    setIsPlaying: (isPlaying: boolean) => void;
}): void {
    if (isPlaying) setIsPlaying(false);
    else startTimelinePlayback(showEndBeat, setIsPlaying);
}

/** Play on or pause (the P key and the transport's Play on button). */
export function toggleTimelinePlayOn({
    isPlaying,
    showEndBeat,
    setIsPlaying,
}: {
    isPlaying: boolean;
    showEndBeat: number;
    setIsPlaying: (isPlaying: boolean) => void;
}): void {
    if (isPlaying) setIsPlaying(false);
    else startTimelinePlayOn(showEndBeat, setIsPlaying);
}

/** Whether the pause in progress came from **Stop**; clears the request. */
export function consumeStopRequest(): boolean {
    const requested = stopRequested;
    stopRequested = false;
    return requested;
}

/**
 * **Stop** (UI-11): stops playback and puts the cursor back on the playhead, so the edit window is
 * as it was before Play. While playing, the playback driver does this once the pause lands, so its
 * pause handling doesn't overwrite it. Paused with a held frame, it drops the frame. Paused on the
 * playhead, it returns the playhead to the start flag (UI-10).
 */
export function stopTimelinePlayback({
    isPlaying,
    setIsPlaying,
}: {
    isPlaying: boolean;
    setIsPlaying: (isPlaying: boolean) => void;
}): void {
    if (isPlaying) {
        stopRequested = true;
        setIsPlaying(false);
        return;
    }
    const state = useTimelineSelectionStore.getState();
    if (state.cursorBeat !== null) state.clearCursor();
    else state.returnToStart();
}
