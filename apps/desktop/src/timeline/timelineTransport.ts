import type {
    TimelineNavigation,
    TimelineSeekGesture,
} from "@/components/timeline/TimelineViewModel";
import {
    displayedBeat,
    followingStart,
    useTimelineSelectionStore,
    type TimelineLine,
    type TimelinePlaybackRun,
    type TimelineSelectionState,
} from "@/stores/TimelineSelectionStore";
import { navigationTarget, type FlagPage } from "./timelinePlayhead";
import { beatAtTime, timeAtBeat, type BeatTiming } from "./timeMap";
import {
    getLivePlaybackPosition,
    playbackStartInfoRef,
    restartLivePlaybackAt,
} from "@/components/timeline/audio/AudioPlayer";

/**
 * The transport (docs/timeline/ui.md UI-9; P8.11), shared by the timeline's transport buttons and
 * the registered actions (shortcuts, menus). These drive `useTimelineSelectionStore`.
 */

/** Set by `suspendTimelinePlayback`, so the pause that follows leaves the cursor and playhead alone. */
let suspendRequested = false;

/**
 * How the stop in progress ends (UI-22), set by `stopTimelinePlayback` and
 * `pauseTimelinePlayback` for the playback driver: a stop puts the playhead on the end flag, a
 * pause freezes it on the nearest beat. `null` for a stop from anywhere else (the audio editor, a
 * run's end), which ends as the run does.
 */
let stopRequest: TimelineStopRequest = null;

/** How the transport asked playback to end (UI-22) */
export type TimelineStopRequest = "stop" | "pause" | null;

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
 * Navigation (UI-9 Page-relative tools): moves the playhead to the target flag and selects that
 * page's timeline, or home for the first page; a loop moves to that page (UI-17). A beat step
 * moves the playhead one beat, as a click there does. Returns false when there is nowhere to go.
 * Callers don't navigate while playing (`navigateTimeline` jumps playback instead).
 */
export function navigateTimelinePages(
    pages: readonly FlagPage[],
    direction: TimelineNavigation,
): boolean {
    const state = useTimelineSelectionStore.getState();
    // From the beat the timeline shows: a held preview frame, or the playhead (UI-11)
    const from = displayedBeat(state);
    if (direction === "previous-beat" || direction === "next-beat") {
        state.seek(beatStep(Math.round(from), direction));
        return displayedBeat(useTimelineSelectionStore.getState()) !== from;
    }
    const target = navigationTarget(pages, from, direction);
    if (!target) return false;
    if (target.range) state.selectRange(target.range.start, target.range.end);
    else state.selectHome();
    return true;
}

/**
 * A beat on or back from `beat`. Beats 0 and 1 are both show time 0, written as 0
 * (`normalizePlayheadBeat`), so a step on from the start goes to beat 2.
 */
const beatStep = (beat: number, direction: "previous-beat" | "next-beat") =>
    direction === "next-beat" ? Math.max(beat, 1) + 1 : beat - 1;

/**
 * Previous and Next, from the transport buttons and the shortcuts alike (Q and E; Shift for a
 * beat, Alt for the start and end). Paused, it moves the playhead (`navigateTimelinePages`); playing,
 * playback jumps there from the beat playing now and goes on (`jumpTimelinePages`).
 */
export function navigateTimeline(
    beats: readonly BeatTiming[],
    pages: readonly FlagPage[],
    isPlaying: boolean,
    direction: TimelineNavigation,
): boolean {
    if (!isPlaying) return navigateTimelinePages(pages, direction);
    const live = playbackStartInfoRef.current
        ? beatAtTime(beats, getLivePlaybackPosition())
        : displayedBeat(useTimelineSelectionStore.getState());
    return jumpTimelinePages(beats, pages, Math.floor(live), direction);
}

/**
 * A click, scrub or page navigation while playing (UI-12): playback jumps to `beat` and goes on,
 * as in a DAW, and the playhead stays put. A loop jumped outside its window plays on from there;
 * isolation keeps the jump inside the isolated range. Returns false when not playing.
 */
export function jumpTimelinePlayback(
    beats: readonly BeatTiming[],
    beat: number,
): boolean {
    const state = useTimelineSelectionStore.getState();
    if (!state.playback || !Number.isFinite(beat)) return false;
    const target = playbackTarget(beats, beat);
    const run = runAfterJump(state.playback, target);
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
 * Play's run jumped outside its flags plays on from there (UI-11), so it doesn't loop or stop at
 * an end flag it has passed; inside them it goes on as it was. Isolation keeps its run.
 */
const runAfterJump = (
    run: TimelinePlaybackRun,
    target: number,
): TimelinePlaybackRun =>
    run.kind === "preview" &&
    !useTimelineSelectionStore.getState().isolation &&
    (target < run.from || target >= run.to)
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
 * The scrub that suspended `run` ended at `beat`: playback starts once from there, as the same
 * run, or playing on when a loop's window doesn't hold it (as `jumpTimelinePlayback` does).
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
    state.setPlayback(runAfterJump(run, target));
    setIsPlaying(true);
}

/** Whether the pause in progress is a scrub's suspension; clears the request. */
export function consumeSuspendRequest(): boolean {
    const requested = suspendRequested;
    suspendRequested = false;
    return requested;
}

/** How the transport asked the stop in progress to end (UI-22); clears the request. */
export function consumeStopRequest(): TimelineStopRequest {
    const requested = stopRequest;
    stopRequest = null;
    return requested;
}

/**
 * A paused drag of the start flag or the playhead by its line (UI-21): the store's line drag, in
 * which a line dragged past the other swaps with it. Returns the beat the playhead shows, or
 * `undefined` when this isn't a line drag after all, so the seek goes on as a plain one: a press
 * on the playhead that ends without a drag is a click, and moves only the playhead.
 */
function dragTimelineLine(
    line: TimelineLine,
    beat: number,
    gesture: TimelineSeekGesture | undefined,
): number | null | undefined {
    const state = useTimelineSelectionStore.getState();
    const dragging = state.lineDrag !== null;
    if (!dragging && line === "playhead" && gesture !== "drag")
        return undefined;
    if (gesture === "cancel") {
        if (line === "start") state.cancelLineDrag();
        else state.endLineDrag();
        return null;
    }
    if (!dragging) state.beginLineDrag(line);
    // Isolated, there is no line drag: the playhead scrubs and the start flag stays
    if (useTimelineSelectionStore.getState().lineDrag === null)
        return line === "playhead" ? undefined : null;
    state.dragLine(beat);
    if (gesture === undefined || gesture === "end") {
        state.endLineDrag();
        return null;
    }
    return displayedBeat(useTimelineSelectionStore.getState());
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
        line,
    }: {
        isPlaying: boolean;
        setIsPlaying: (isPlaying: boolean) => void;
        /** The line the gesture drags by itself (`TimelineSeekOptions.line`) */
        line?: TimelineLine;
    },
): number | null {
    if (!Number.isFinite(beat)) return null;
    const state = useTimelineSelectionStore.getState();
    if (line !== undefined && !isPlaying) {
        const shown = dragTimelineLine(line, beat, gesture);
        if (shown !== undefined) return shown;
    } else if (line === "start") return null;
    if (gesture === undefined || gesture === "end" || gesture === "cancel") {
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
 * Navigation while playing (UI-12): playback jumps to the target flag, or a beat on, from the
 * beat playing now. Returns false when there is nowhere to go.
 */
export function jumpTimelinePages(
    beats: readonly BeatTiming[],
    pages: readonly FlagPage[],
    liveBeat: number,
    direction: TimelineNavigation,
): boolean {
    if (direction === "previous-beat" || direction === "next-beat")
        return jumpTimelinePlayback(beats, beatStep(liveBeat, direction));
    const target = navigationTarget(pages, liveBeat, direction);
    return target ? jumpTimelinePlayback(beats, target.flag) : false;
}

type PlayState = Pick<
    TimelineSelectionState,
    "isolation" | "startBeat" | "endBeat" | "pageBoxes"
>;

/**
 * What **Play** plays (UI-22): an isolated move's range, else the start flag to the end flag. With
 * the end flag on or before the start flag (a pinned start flag the playhead went back past), from
 * the start of the page box the end flag is in, as the edit window falls back to. `null` at home,
 * where there is nothing between the flags.
 */
export const playRange = (
    state: PlayState,
): { readonly from: number; readonly to: number } | null => {
    if (state.isolation)
        return { from: state.isolation.start, to: state.isolation.end };
    const to = state.endBeat;
    const from =
        state.startBeat < to
            ? state.startBeat
            : followingStart(to, state.pageBoxes);
    return from < to ? { from, to } : null;
};

/** Whether Play loops (UI-22): looping is on, or a move is isolated, which always loops */
export const playLoops = (
    state: Pick<TimelineSelectionState, "isolation" | "looping">,
): boolean => state.looping || state.isolation !== null;

/**
 * **Play** (UI-22): the playhead goes to the start flag and plays to the end flag, looping there
 * while looping is on, stopping there (on the end flag) when it is off. At home, where both flags
 * are on beat 0, it goes to the first page and plays that. Does nothing while playing. Returns
 * false when there is nothing to play.
 */
export function playTimeline(
    setIsPlaying: (isPlaying: boolean) => void,
): boolean {
    let state = useTimelineSelectionStore.getState();
    if (state.playback) return false;
    const first = state.pageBoxes[0];
    if (!playRange(state) && first && state.selection.kind === "home") {
        state.selectRange(first.start, first.end);
        state = useTimelineSelectionStore.getState();
    }
    const range = playRange(state);
    if (!range) return false;
    state.cue(range.from);
    state.setPlayback({
        kind: "preview",
        ...range,
        once: !playLoops(state),
    });
    setIsPlaying(true);
    return true;
}

/**
 * **Pause** (UI-22): playback stops and the playhead freezes on the nearest beat. The flags stay,
 * so Play plays the same run again from its start. The playback driver moves the playhead once the
 * pause lands.
 */
export function pauseTimelinePlayback(
    setIsPlaying: (isPlaying: boolean) => void,
): void {
    if (!useTimelineSelectionStore.getState().playback) return;
    stopRequest = "pause";
    setIsPlaying(false);
}

/**
 * **Stop** (UI-22): the playhead goes to the end flag, playing or paused. Playing, the playback
 * driver puts it there once the stop lands.
 */
export function stopTimelinePlayback(
    isPlaying: boolean,
    setIsPlaying: (isPlaying: boolean) => void,
): void {
    if (isPlaying) {
        stopRequest = "stop";
        setIsPlaying(false);
        return;
    }
    useTimelineSelectionStore.getState().stopAtEnd();
}

/** What a play key does while playing (UI-22): stop, or pause */
export type TimelinePlayKeyStop = "stop" | "pause";

/**
 * A play key (UI-22): paused, it plays; playing, it stops or pauses. Space stops and Shift+Space
 * pauses, or the other way around (Settings, `playStop` and `playPause`).
 */
export function pressTimelinePlayKey(
    stop: TimelinePlayKeyStop,
    isPlaying: boolean,
    setIsPlaying: (isPlaying: boolean) => void,
): void {
    if (!isPlaying) playTimeline(setIsPlaying);
    else if (stop === "pause") pauseTimelinePlayback(setIsPlaying);
    else stopTimelinePlayback(true, setIsPlaying);
}

/**
 * **C** and the Loop button (UI-22): turns looping on or off. A run playing now loops or stops at
 * the end flag from then on. Does nothing in isolation, which always loops its move.
 */
export function toggleTimelineLoop(): void {
    const state = useTimelineSelectionStore.getState();
    if (state.isolation) return;
    state.setLooping(!state.looping);
}
