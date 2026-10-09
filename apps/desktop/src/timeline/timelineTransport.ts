import type {
    TimelineNavigation,
    TimelineSeekGesture,
} from "@/components/timeline/TimelineViewModel";
import {
    displayedBeat,
    useTimelineSelectionStore,
    type TimelinePlaybackRun,
} from "@/stores/TimelineSelectionStore";
import {
    canPlayOn,
    navigationTarget,
    previewBounds,
    type FlagPage,
} from "./timelinePlayhead";
import { timeAtBeat, type BeatTiming } from "./timeMap";
import { restartLivePlaybackAt } from "@/components/timeline/audio/AudioPlayer";

/**
 * The timeline-mode transport (docs/timeline/ui.md UI-9; P8.11), shared by the timeline's
 * transport buttons and the registered actions (shortcuts, menus). These drive
 * `useTimelineSelectionStore`; page mode keeps its own page-based transport.
 */

/** Set by `suspendTimelinePlayback`, so the pause that follows leaves the cursor and playhead alone. */
let suspendRequested = false;

/**
 * The scrub in progress (UI-12 review): the last whole beat it sent, so a move within the same
 * beat sends nothing, and whether it is over playback, with the run it suspended once it moved.
 */
let scrub: {
    beat: number | null;
    playing: boolean;
    suspended: TimelinePlaybackRun | null;
} | null = null;

/**
 * Page navigation (UI-9 Page-relative tools): moves the playhead to the target flag and selects
 * that page's timeline, or home for the first page. A pinned start flag stays (UI-17: it is a
 * locator, set with C, and only the pin, a page box or home unpin it, UI-12), so the window runs
 * from it to the flag. Returns false when there is nowhere to go. Callers don't navigate while
 * playing.
 */
export function navigateTimelinePages(
    pages: readonly FlagPage[],
    direction: TimelineNavigation,
): boolean {
    const state = useTimelineSelectionStore.getState();
    // From the beat the timeline shows: a held preview frame, or the playhead (UI-11)
    const target = navigationTarget(pages, displayedBeat(state), direction);
    if (!target) return false;
    if (target.range && state.startPinned && !state.isolation)
        state.seek(target.flag);
    else if (target.range)
        state.selectRange(target.range.start, target.range.end);
    else state.selectHome();
    return true;
}

/**
 * A click, scrub or page navigation while playing (UI-12): playback jumps to `beat` and goes on,
 * as in a DAW, and the playhead stays put. A preview plays on from there, so stopping no longer
 * returns to the playhead (UI-17); isolation keeps the jump inside the isolated range. Returns
 * false when not playing.
 */
export function jumpTimelinePlayback(
    beats: readonly BeatTiming[],
    beat: number,
): boolean {
    const state = useTimelineSelectionStore.getState();
    if (!state.playback || !Number.isFinite(beat)) return false;
    const target = playbackTarget(beats, beat);
    const run = runAfterJump(state.playback);
    if (run !== state.playback) state.setPlayback(run);
    restartLivePlaybackAt(timeAtBeat(beats, target));
    state.cue(target);
    return true;
}

/** Where playback jumped to `beat` goes: inside an isolated range, else inside the show. */
const playbackTarget = (beats: readonly BeatTiming[], beat: number) => {
    const { isolation } = useTimelineSelectionStore.getState();
    return isolation
        ? Math.min(Math.max(beat, isolation.start), isolation.end - 1)
        : Math.min(Math.max(beat, 0), beats.length);
};

/**
 * A jump or scrub says "I'm here now" (UI-17): a preview plays on from there, so its stop stays
 * instead of returning to the playhead. Isolation keeps its run, which loops the isolated range.
 */
const runAfterJump = (run: TimelinePlaybackRun): TimelinePlaybackRun =>
    run.kind === "preview" && !useTimelineSelectionStore.getState().isolation
        ? { kind: "on" }
        : run;

/**
 * A scrub over playback has moved (UI-12 review): playback pauses without writing the playhead or
 * the cursor, so the scrub can show each beat it passes (`cue`) with the audio silent. Returns the
 * run to resume, or `null` when nothing is playing.
 */
export function suspendTimelinePlayback(
    setIsPlaying: (isPlaying: boolean) => void,
): TimelinePlaybackRun | null {
    const run = useTimelineSelectionStore.getState().playback;
    if (!run) return null;
    suspendRequested = true;
    setIsPlaying(false);
    return run;
}

/**
 * The scrub that suspended `run` ended at `beat`: playback starts once from there, a preview as
 * playing on (as `jumpTimelinePlayback` does).
 */
export function resumeTimelinePlayback(
    beats: readonly BeatTiming[],
    beat: number,
    run: TimelinePlaybackRun,
    setIsPlaying: (isPlaying: boolean) => void,
): void {
    const state = useTimelineSelectionStore.getState();
    const target = playbackTarget(beats, beat);
    // A suspension whose pause never landed mustn't turn the next ordinary pause into one
    suspendRequested = false;
    state.cue(target);
    state.setPlayback(runAfterJump(run));
    setIsPlaying(true);
}

/** Whether the pause in progress is a scrub's suspension; clears the request. */
export function consumeSuspendRequest(): boolean {
    const requested = suspendRequested;
    suspendRequested = false;
    return requested;
}

/**
 * A seek from the timeline (UI-12 and its review). `gesture` is where it sits in a scrub
 * (`TimelineSeekGesture`); without one it is a single action.
 *
 * - Paused, it moves the playhead (`seek`). A scrub sends one seek per whole beat it passes, and
 *   an unpinned start flag stays put until it ends, then follows once (`beginScrub`, `endScrub`).
 * - Playing, a click (a press that ends without moving off its beat), or a seek without a gesture,
 *   jumps playback there and plays on (`jumpTimelinePlayback`). A drag suspends playback
 *   (`suspendTimelinePlayback`) and the canvas follows the pointer; when it ends, playback resumes
 *   once, from there (`resumeTimelinePlayback`). The playhead stays put throughout.
 *
 * During a scrub (`press`, `drag`) it returns the beat the timeline shows once the seek has landed
 * (`displayedBeat`): the beat sent, or another when the playhead can't follow it (isolation keeps
 * it inside the isolated range). `null` when the seek moved nothing the timeline shows (a press
 * over playback, which only marks where a click would jump), and for any other seek.
 */
export function seekTimeline(
    beats: readonly BeatTiming[],
    beat: number,
    gesture: TimelineSeekGesture | undefined,
    {
        isPlaying,
        setIsPlaying,
    }: {
        isPlaying: boolean;
        setIsPlaying: (isPlaying: boolean) => void;
    },
): number | null {
    if (!Number.isFinite(beat)) return null;
    const state = useTimelineSelectionStore.getState();
    if (gesture === undefined || gesture === "end") {
        const ended = scrub;
        scrub = null;
        if (ended?.suspended)
            resumeTimelinePlayback(beats, beat, ended.suspended, setIsPlaying);
        else if (ended?.playing ?? isPlaying) jumpTimelinePlayback(beats, beat);
        else {
            state.seek(beat);
            state.endScrub();
        }
        return null;
    }
    const whole = Math.round(beat);
    scrub ??= { beat: null, playing: isPlaying, suspended: null };
    if (scrub.beat !== whole) {
        scrub.beat = whole;
        if (!scrub.playing) {
            state.beginScrub();
            state.seek(beat);
        }
        // A press over playback only marks where a click would jump to
        else if (gesture === "drag") {
            scrub.suspended ??= suspendTimelinePlayback(setIsPlaying);
            if (scrub.suspended) state.cue(playbackTarget(beats, beat));
        }
    }
    return !scrub.playing || scrub.suspended
        ? displayedBeat(useTimelineSelectionStore.getState())
        : null;
}

/**
 * Page navigation while playing (UI-12): playback jumps to the target flag, from the beat playing
 * now. Returns false when there is nowhere to go.
 */
export function jumpTimelinePages(
    beats: readonly BeatTiming[],
    pages: readonly FlagPage[],
    liveBeat: number,
    direction: TimelineNavigation,
): boolean {
    const target = navigationTarget(pages, liveBeat, direction);
    return target ? jumpTimelinePlayback(beats, target.flag) : false;
}

/**
 * Where **Play from start flag** plays (UI-17): the window from the start flag to the playhead
 * (`previewBounds`). With no window (home, or a flag on the playhead), the show from its start.
 * `null` when the show is empty.
 */
const flagPreviewBounds = (showEndBeat: number) => {
    const state = useTimelineSelectionStore.getState();
    const bounds = previewBounds(state);
    if (bounds) return bounds;
    return showEndBeat > 0 ? { from: 0, to: showEndBeat } : null;
};

/**
 * **Play from start flag** (UI-17, Shift+Space): previews the window from the start flag to the
 * playhead, looping when the loop is on. Any stop puts the cursor back on the playhead, the page
 * you were on. While a preview runs it stops it; while playing from here it restarts from the
 * flag, and the stop still returns to the playhead, which playing never moved.
 *
 * @param beats the show's beats, to restart the audio when it is already playing
 */
export function playTimelineFromFlag(
    beats: readonly BeatTiming[],
    {
        isPlaying,
        setIsPlaying,
    }: {
        isPlaying: boolean;
        setIsPlaying: (isPlaying: boolean) => void;
    },
): boolean {
    const state = useTimelineSelectionStore.getState();
    if (isPlaying && state.playback?.kind === "preview") {
        setIsPlaying(false);
        return true;
    }
    const bounds = flagPreviewBounds(beats.length);
    if (!bounds) return false;
    state.cue(bounds.from);
    state.setPlayback({ kind: "preview", ...bounds });
    if (isPlaying) restartLivePlaybackAt(timeAtBeat(beats, bounds.from));
    else setIsPlaying(true);
    return true;
}

/**
 * Playing on (UI-17, Play from here): plays from the playhead to the end of the show, as UI-10's
 * Play did. Returns false when there's nothing after it.
 */
export function startTimelinePlayOn(
    showEndBeat: number,
    setIsPlaying: (isPlaying: boolean) => void,
): boolean {
    const state = useTimelineSelectionStore.getState();
    const start = state.cursorBeat ?? state.playheadBeat;
    if (!canPlayOn(start, showEndBeat)) return false;
    state.cue(start);
    state.setPlayback({ kind: "on" });
    setIsPlaying(true);
    return true;
}

/**
 * **Play from here** (UI-17, Space): plays on from the playhead. Playing, it stops: playing on
 * stops in place, moving the playhead there, and a preview returns to the playhead (the playback
 * driver does both once the pause lands).
 */
export function playTimelineFromHere({
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

/**
 * The Play from here button while a preview runs (UI-17): playback goes on from where it is, as
 * playing on, so stopping stays there instead of returning to the playhead.
 */
export function continueTimelinePlayback(): void {
    const state = useTimelineSelectionStore.getState();
    if (state.playback?.kind === "preview") state.setPlayback({ kind: "on" });
}

/**
 * **Stop here** (UI-17 follow-up, K, as video editors' K): stops wherever playback is and stays,
 * a preview included, so the playhead moves to the last whole beat played. Nothing when paused.
 */
export function stopTimelinePlaybackHere({
    isPlaying,
    setIsPlaying,
}: {
    isPlaying: boolean;
    setIsPlaying: (isPlaying: boolean) => void;
}): void {
    if (!isPlaying) return;
    continueTimelinePlayback();
    setIsPlaying(false);
}

/**
 * **C** (UI-17): puts the start flag on the beat the timeline shows and pins it, so Play from start
 * flag plays from there once the playhead moves on. Does nothing in isolation, whose flag is the
 * isolated move's start.
 */
export function setTimelineStartFlagHere(): void {
    const state = useTimelineSelectionStore.getState();
    if (state.isolation) return;
    state.pinStartAt(displayedBeat(state));
}
