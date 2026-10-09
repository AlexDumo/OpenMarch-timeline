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
    /** The pointer moved off the beat it pressed: a scrub, not a click */
    moved: boolean;
} | null = null;

/**
 * Page navigation (UI-9 Page-relative tools): moves the playhead to the target flag and selects
 * that page's timeline, or home for the first page. With the start flag pinned it seeks instead:
 * a pin set with C follows the page (UI-17, the store's `seek`), and one drawn by hand stays
 * (UI-12). Returns false when there is nowhere to go. Callers don't navigate while playing.
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
 * A loop jumped outside its window plays on from there (UI-11), so its stop stays; inside the
 * window it keeps looping. Isolation keeps its run.
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
        else if (ended && !ended.moved && clickSelectsPage(beat))
            state.endScrub();
        else {
            state.seek(beat);
            state.endScrub();
        }
        return null;
    }
    const whole = Math.round(beat);
    scrub ??= { beat: null, playing: isPlaying, suspended: null, moved: false };
    if (scrub.beat !== whole) {
        if (scrub.beat !== null) scrub.moved = true;
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
 * A paused click on the timeline (UI-17 follow-up): selects the page box under it, as a click on
 * its box does, rather than seeking to that count (simulated users clicked low in a page and got a
 * partial window). A drag still scrubs to any count. A start flag pinned by hand keeps UI-12's
 * click-to-seek; a following pin follows the page. Returns false when it didn't handle the click.
 */
function clickSelectsPage(beat: number): boolean {
    const state = useTimelineSelectionStore.getState();
    if (state.isolation || (state.startPinned && !state.pinFollows))
        return false;
    const whole = Math.round(beat);
    const box = state.pageBoxes.find((b) => whole > b.start && whole <= b.end);
    if (!box) {
        if (whole > (state.pageBoxes[0]?.start ?? 0)) return false;
        state.selectHome();
        return true;
    }
    if (state.startPinned) state.seek(box.end);
    else state.selectRange(box.start, box.end);
    return true;
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
 * What **Play** loops (UI-17): with the start flag pinned, or a move isolated, the window from the
 * flag to the playhead (`previewBounds`), or a loop over several pages the playhead is inside
 * (`loopEnd`); otherwise `null`, and Play plays on.
 */
export const pinnedLoopBounds = (
    state: Pick<
        ReturnType<typeof useTimelineSelectionStore.getState>,
        | "startPinned"
        | "isolation"
        | "selection"
        | "startBeat"
        | "playheadBeat"
        | "loopEnd"
    >,
) => {
    if (!state.startPinned && !state.isolation) return null;
    if (
        !state.isolation &&
        state.loopEnd !== null &&
        state.startBeat < state.playheadBeat &&
        state.playheadBeat <= state.loopEnd
    )
        return { from: state.startBeat, to: state.loopEnd };
    return previewBounds(state);
};

/**
 * Playing on (UI-17, Play with no pin): plays from the playhead to the end of the show, as UI-10's
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
 * The page box a selected page fills (UI-17): the playhead on its end flag, the window exactly
 * its box, nothing pinned and no held frame. `null` for home, a partial window or a pin.
 */
export const selectedPageBox = (
    state: Pick<
        ReturnType<typeof useTimelineSelectionStore.getState>,
        | "selection"
        | "playheadBeat"
        | "cursorBeat"
        | "pageBoxes"
        | "startPinned"
        | "isolation"
    >,
): { readonly from: number; readonly to: number } | null => {
    const { selection } = state;
    if (
        state.startPinned ||
        state.isolation ||
        state.cursorBeat !== null ||
        selection.kind !== "range" ||
        selection.end !== state.playheadBeat
    )
        return null;
    const box = state.pageBoxes.find(
        (b) => b.end === selection.end && b.start === selection.start,
    );
    return box ? { from: box.start, to: box.end } : null;
};

/** Cleared by the next pointer press or key other than Space (`armContinue`) */
let disarmListeners: (() => void) | null = null;

/**
 * A selected page's move played to its end (UI-17): the next Space plays on from there. The very
 * next thing only: a pointer press or any other key clears it first, so Space after an edit
 * replays the page (two simulated users were caught re-checking a fix).
 */
export function armContinue(): void {
    disarmContinue();
    useTimelineSelectionStore.getState().setContinueArmed(true);
    // The Play button is the mouse's Space
    const onPointer = (event: PointerEvent) => {
        if (
            !(event.target instanceof Element) ||
            !event.target.closest('[data-testid="timeline-play"]')
        )
            disarmContinue();
    };
    const onKey = (event: KeyboardEvent) => {
        if (event.key !== " ") disarmContinue();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    disarmListeners = () => {
        window.removeEventListener("pointerdown", onPointer, true);
        window.removeEventListener("keydown", onKey, true);
    };
}

/** Ends `armContinue`'s state and its listeners */
export function disarmContinue(): void {
    disarmListeners?.();
    disarmListeners = null;
    useTimelineSelectionStore.getState().setContinueArmed(false);
}

/**
 * **Play / Stop** (UI-17, Space), the one play action. With the start flag pinned (or a move
 * isolated) it loops the window from the flag to the playhead, and stopping puts the canvas back
 * on the playhead, the arrival being edited, which looping never moved. With no pin and a page
 * selected (`selectedPageBox`) it plays that page's move once and stops on its set, so an edit
 * right after lands on the page that was checked; Space straight after that plays on (simulated-user
 * A/B test round 3, 2026-10-09: playing from the page's start and on left all four testers editing
 * the next page's set). Otherwise it plays on from the playhead, and stopping stays where it
 * stopped, moving the playhead there. The playback driver does both once the pause lands.
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
    if (isPlaying) {
        setIsPlaying(false);
        return;
    }
    const state = useTimelineSelectionStore.getState();
    const continuing = state.continueArmed;
    disarmContinue();
    const bounds = pinnedLoopBounds(state);
    if (!bounds) {
        // UI-17: a selected page plays its own move once and stops on its set, unless the last
        // thing done was playing it, when Space plays on from there
        const page = continuing ? undefined : selectedPageBox(state);
        if (page) {
            state.cue(page.from);
            state.setPlayback({ kind: "preview", ...page, once: true });
            setIsPlaying(true);
            return;
        }
        startTimelinePlayOn(showEndBeat, setIsPlaying);
        return;
    }
    state.cue(bounds.from);
    state.setPlayback({ kind: "preview", ...bounds });
    setIsPlaying(true);
}

/**
 * **C** (UI-17): pins the start flag where it stands, the start of the page being edited, or
 * unpins it, as Logic's C turns Cycle on and off and editors' Mark Clip marks the clip under the
 * playhead. A pinned flag is what Play loops from, and it follows the page you move to (the
 * store's `seek`). Does nothing in isolation, whose flag is the
 * isolated move's start. (A simulated-user A/B test, 2026-10-09: all four expected the page's
 * start; on the playhead, the page's end, read as "this loops the next page".)
 */
export function toggleTimelineStartPin(): void {
    const state = useTimelineSelectionStore.getState();
    if (state.isolation) return;
    if (state.startPinned) state.unpinStart();
    else state.pinStartAt(state.startBeat);
}
