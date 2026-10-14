import { create } from "zustand";

/**
 * The timeline-mode flags, edit window and paused playhead (docs/timeline/ui.md UI-9, UI-10,
 * UI-22, C-12; P8.11, P8.17).
 *
 * In timeline mode there is no selected page. Two flags mark the move being worked on: the
 * **start flag** S and the **end flag** E (UI-22). Only page navigation (a page box, Q/E, home,
 * Shift+click on pages, a dragged range, `selectRange`) and the flags' own drags move them; the
 * playhead never does. What the designer edits is the **edit window**, from S to the paused
 * **playhead** P (UI-10): movers leave S and arrive at P. Nothing is edited outside the flags, so
 * P rests inside them, `S < P <= E`:
 *
 * - A drag of the playhead (`beginScrub`) may go anywhere; released outside the flags, P goes back
 *   to E (`endScrub("drag")`).
 * - A click, a go-to, a beat step or a pause that lands outside the flags (`seek`, `pauseAt`, or
 *   `endScrub("click")`) brings the flags to it: they move to the page box holding that beat.
 *
 * The window is stored as `selection`, derived from S, P and the page boxes on every change:
 *
 * - **home**: P at beat 0. No timeline is selected; nothing is dimmed and moves edit homes.
 * - **range**: `[S, P)` when P is after S; otherwise (only while a drag holds P outside the flags)
 *   the page box ending at or holding P. A range resolves to the stored timeline with exactly that
 *   range when there is one (at most one per range, C-12). Read it with `selectedStoredTimeline`
 *   or `useSelectedStoredTimeline`.
 * - **none**: nothing selected (`selectNothing`).
 *
 * Every beat here is a spec beat position (`beats` index, spec §7). The zero-length beat 0 and
 * beat 1 are both show time 0; the playhead writes that time as 0 (`normalizePlayheadBeat`).
 *
 * `storedTimelines` is a read model of every stored timeline and who is in it, kept current by
 * `useTimelineSelectionHost` (mounted by `TimelineResolverHost`) after each timeline write, undo
 * and redo. It is `null` until first loaded. `pageBoxes` is kept by
 * `TimelineModePanel`.
 *
 * **Isolation** (docs/timeline/research/ownership/09-isolation.md, _prototype_): double-clicking a
 * stored timeline's clip or page box isolates it. The flags become its range, the playhead stays
 * inside it, and marchers outside it are dimmed and locked (`isMarcherDimmed`). Esc, a page box or
 * home, a dragged range, or the timeline going away ends isolation and puts the flags and P back
 * where they were.
 *
 * **Playback** (UI-22): **Play** always plays from S to E, and loops there while `looping` is on;
 * otherwise it stops at E. Stopping (Stop, or the end of a run) puts the playhead on E
 * (`stopAtEnd`); pausing freezes it on the nearest beat (`pauseAt`). Playing never writes the
 * playhead. Audio plays from, and the paused canvas shows, the **cursor** (`cursorBeat`) when
 * there is one, and the playhead otherwise. Play sets the cursor where playback starts and
 * `playback` to what is running. Every write of the window (navigation, seeking, a range) clears
 * the cursor, so the canvas is back at P before anything edits there.
 */

/** Home, a range or nothing (UI-9, "What the selection holds"; UI-10 edit window). */
export type TimelineEditSelection =
    | { readonly kind: "home" }
    | {
          readonly kind: "range";
          /** First beat, inclusive (spec beats): the start flag */
          readonly start: number;
          /** End beat, exclusive: the playhead, where movers arrive */
          readonly end: number;
      }
    | { readonly kind: "none" };

/** A stored timeline and the marchers with an assignment in any of its transitions. */
export interface StoredTimelineMembership {
    readonly id: number;
    readonly start: number;
    readonly end: number;
    readonly marcherIds: ReadonlySet<number>;
    /** The timeline's name (UI-14 Rename), `null` or absent when it has none */
    readonly name?: string | null;
}

/** Where the flags and the playhead are, to go back to */
export interface TimelineFlagsAndPlayhead {
    readonly startBeat: number;
    readonly endBeat: number;
    readonly playheadBeat: number;
}

/** An isolated stored timeline (see the module comment) and the flags to restore after it. */
export interface TimelineIsolation {
    readonly timelineId: number;
    /** The timeline's range, kept current when it moves */
    readonly start: number;
    readonly end: number;
    readonly restore: TimelineFlagsAndPlayhead;
}

/**
 * What is playing (UI-11, UI-22): a **preview**, Play's run from `from` (the start flag) to `to`
 * (the end flag), or playing **on** to the end of the show (a jump past the end flag, or playback
 * started outside the transport). Its bounds are taken when playback starts, so edits made while
 * playing don't move them.
 */
export type TimelinePlaybackRun =
    | {
          readonly kind: "preview";
          readonly from: number;
          readonly to: number;
          /** Stops at `to` instead of looping: looping is off (UI-22) */
          readonly once?: boolean;
      }
    | { readonly kind: "on" };

/** A page's box: the previous flag to its own flag (`pageFlags`), in spec beats. */
export interface PageBox {
    readonly start: number;
    readonly end: number;
    /** The page's name, for messages ("Page 2"); absent where only the range matters */
    readonly name?: string;
}

/** How a gesture that moved the playhead ended (UI-22, `endScrub`) */
export type TimelineScrubEnd = "click" | "drag" | "keep";

export interface TimelineSelectionState {
    /** The edit window, derived from the start flag, the playhead and the page boxes */
    readonly selection: TimelineEditSelection;
    /** The start flag S (UI-10): where movers leave from, and where Play starts */
    readonly startBeat: number;
    /** The end flag E (UI-22): where Play stops, or loops back from, and where Stop goes */
    readonly endBeat: number;
    /** The paused playhead: a whole spec beat in `[0, beats.length]`. Not updated while playing. */
    readonly playheadBeat: number;
    /**
     * Increments on every playhead write, including one to the beat it is already on, so playback
     * can restart from it.
     */
    readonly playheadRevision: number;
    /** Every page's box after home, in show order; empty until the pages load */
    readonly pageBoxes: readonly PageBox[];
    /** Every stored timeline, by start then id; `null` until loaded */
    readonly storedTimelines: readonly StoredTimelineMembership[] | null;
    /**
     * The end of the show (`beats.length`), the furthest the playhead goes; `null` while unknown.
     * Kept by `useTimelinePlaybackDriver`.
     */
    readonly showEndBeat: number | null;
    /** The isolated timeline, or `null` (see the module comment) */
    readonly isolation: TimelineIsolation | null;
    /**
     * The playback cursor when it isn't the playhead (UI-11): where playback started or a loop
     * went back to, or the beat a scrub over playback shows. `null` when it is the playhead.
     */
    readonly cursorBeat: number | null;
    /** What is playing, or `null` while paused (UI-11) */
    readonly playback: TimelinePlaybackRun | null;
    /** Looping (UI-22, C): Play goes back to the start flag at the end flag instead of stopping */
    readonly looping: boolean;
    /** A drag is moving the playhead, which may leave the flags until it ends (UI-22) */
    readonly scrubbing: boolean;
    /** A flag being dragged by its line (UI-21, UI-22), and where things were when it began */
    readonly lineDrag: TimelineLineDrag | null;

    /**
     * Isolates the stored timeline `timelineId`: the flags become its range with the playhead at
     * its end. `restore` is where leaving goes back to (default: now; a double-click passes where
     * things were before its first click). Does nothing for a timeline that isn't loaded, or while
     * it is already isolated.
     */
    readonly isolate: (
        timelineId: number,
        restore?: TimelineFlagsAndPlayhead,
    ) => void;
    /** Ends isolation and restores the flags and playhead it saved. */
    readonly exitIsolation: () => void;
    /** Both flags and the playhead to beat 0 (home). */
    readonly selectHome: () => void;
    /**
     * The flags to `[start, end)`, with the playhead on `end`. Page boxes, page navigation, **+**,
     * a dragged range and Shift+click on pages call this.
     */
    readonly selectRange: (start: number, end: number) => void;
    /** Clears the selection; the flags and the playhead stay. */
    readonly selectNothing: () => void;
    /**
     * Moves the playhead (`normalizePlayheadBeat`, at most `showEndBeat`). During a drag
     * (`beginScrub`) it goes anywhere; otherwise (a click, a go-to, a beat step) inside the flags
     * it stays there, and outside them the flags move to the page box holding it (UI-22). A
     * non-finite beat is ignored.
     */
    readonly seek: (beat: number) => void;
    /**
     * A pause (UI-22): the playhead goes to `beat`, kept after `after` (the run's start, so the
     * window doesn't fall back to the page before), as `seek` puts it: outside the flags, they
     * come to it.
     */
    readonly pauseAt: (beat: number, after?: number) => void;
    /** Stop (UI-22): the playhead goes to the end flag, and the canvas back to it. */
    readonly stopAtEnd: () => void;
    /** A drag of the playhead began: `seek` takes it anywhere until `endScrub`. */
    readonly beginScrub: () => void;
    /**
     * The gesture ended (UI-22). Inside the flags the playhead stays. Outside them, a `"click"`
     * brings the flags to it (as `seek`), a `"drag"` puts it back on the end flag, and `"keep"`
     * (Play was pressed during the drag) leaves it.
     */
    readonly endScrub: (how?: TimelineScrubEnd) => void;
    /**
     * A drag of a flag by its line began (UI-21, UI-22), paused and not isolated. Until it ends,
     * `dragLine` puts the dragged flag at a beat.
     */
    readonly beginLineDrag: (line: TimelineFlagLine) => void;
    /**
     * The dragged flag is at `beat`. The left flag is the start flag and the right one the end
     * flag (`lineDragPositions`), so a flag dragged past the other swaps with it.
     */
    readonly dragLine: (beat: number) => void;
    /**
     * The flag drag ended where it is. Released on the other flag, the dragged one pushes it a
     * beat on: the end flag a beat later, or the start flag a beat earlier.
     */
    readonly endLineDrag: () => void;
    /** The flag drag was cancelled (Escape): the flags and P go back to where it began. */
    readonly cancelLineDrag: () => void;
    /**
     * A stored timeline moved from `from` by `delta` beats (a clip move): flags on exactly `from`
     * move with it, the playhead too, and so does the loaded stored timeline at `from` until the
     * host reloads, so the selection keeps resolving to it.
     */
    readonly followTimelineShift: (
        from: { readonly start: number; readonly end: number },
        delta: number,
    ) => void;
    /**
     * A page flag moved from beat `from` to `to` (docs/timeline/research/move-page-flag case 14):
     * a flag or the playhead on it goes with it, so the selected page stays selected. The page
     * boxes and the loaded stored timelines with an edge on it follow too, until the pages and the
     * host reload. Nothing happens in isolation, where flags don't move.
     */
    readonly followPageFlagMove: (from: number, to: number) => void;
    /**
     * A stored timeline's range changed from `from` to `to` (a clip resize, resize-move): as
     * `followTimelineShift`, flags on exactly `from` become `to`, with the playhead kept inside
     * them (on the new end if it was on the old one). An isolated timeline's flags follow it.
     */
    readonly followTimelineRange: (
        from: { readonly start: number; readonly end: number },
        to: { readonly start: number; readonly end: number },
    ) => void;
    /** Used by `TimelineModePanel` only. */
    readonly setPageBoxes: (boxes: readonly PageBox[]) => void;
    /** Used by `useTimelineSelectionHost` only. */
    readonly setStoredTimelines: (
        timelines: readonly StoredTimelineMembership[] | null,
    ) => void;
    /**
     * Moves the playback cursor to `beat` (clamped to the show) without moving the playhead, and
     * restarts playback there if playing. A non-finite beat is ignored.
     */
    readonly cue: (beat: number) => void;
    /** Puts the cursor back on the playhead: the canvas shows P again. */
    readonly clearCursor: () => void;
    /** Records what is playing (`null` once it stops). Used by the transport and the driver. */
    readonly setPlayback: (playback: TimelinePlaybackRun | null) => void;
    /**
     * Turns looping on or off (UI-22). A run playing now goes on with it: it loops at the end
     * flag, or stops there.
     */
    readonly setLooping: (looping: boolean) => void;
    /** Used by `useTimelinePlaybackDriver` only. */
    readonly setShowEndBeat: (showEndBeat: number | null) => void;
    /** Opening a show: home, playhead at 0, nothing loaded. */
    readonly reset: () => void;
}

/** The playhead's beat for show time 0 is 0, though beat 1 (after the zero-length beat 0) is too. */
export function normalizePlayheadBeat(
    beat: number,
    zeroLengthFirstBeat = true,
): number {
    const whole = Math.max(0, Math.round(beat));
    return zeroLengthFirstBeat && whole <= 1 ? 0 : whole;
}

/**
 * A line on the timeline that can be dragged by itself (UI-21, UI-22): a flag, or the playhead,
 * whose drag is a scrub
 */
export type TimelineLine = "start" | "end" | "playhead";

/** A flag's line (UI-22) */
export type TimelineFlagLine = Exclude<TimelineLine, "playhead">;

/** A flag drag (UI-21, UI-22): the dragged flag, and the flags and P from when it began */
export type TimelineLineDrag = TimelineFlagsAndPlayhead & {
    readonly line: TimelineFlagLine;
};

/**
 * Where the flags and P are with `drag`'s flag at `beat` (UI-21, UI-22, project owner 2026-10-14):
 * the flag not dragged stays, the left one is the start flag and the right one the end flag, as
 * Logic's locators. `swapped` when the dragged flag has passed the other and become it. P never
 * moves during the drag; `endLineDrag` puts it on the end flag if the flags left it outside.
 */
export function lineDragPositions(
    drag: TimelineLineDrag,
    beat: number,
): TimelineFlagsAndPlayhead & { swapped: boolean } {
    const other = drag.line === "start" ? drag.endBeat : drag.startBeat;
    return {
        startBeat: Math.min(beat, other),
        endBeat: Math.max(beat, other),
        playheadBeat: drag.playheadBeat,
        swapped: drag.line === "start" ? beat > other : beat < other,
    };
}

/**
 * The start of the page box holding `playheadBeat` or ending at it (UI-10): where the start flag
 * goes when the flags come to a beat (`pageAround`). Past the last flag, the last flag; with no
 * page boxes, 0.
 */
export function followingStart(
    playheadBeat: number,
    boxes: readonly PageBox[],
): number {
    // Beat 1 is show time 0, the same moment as beat 0 (`normalizePlayheadBeat`)
    if (normalizePlayheadBeat(playheadBeat) === 0) return 0;
    const box = boxes.find(
        (b) => b.start < playheadBeat && playheadBeat <= b.end,
    );
    if (box) return box.start;
    const last = boxes[boxes.length - 1];
    return last && playheadBeat > last.end ? last.end : 0;
}

/**
 * The edit window for start flag `startBeat` and playhead `playheadBeat` (UI-10): home at beat 0;
 * `[S, P)` when P is after S; otherwise the window S would follow to.
 */
export function editWindow(
    startBeat: number,
    playheadBeat: number,
    boxes: readonly PageBox[],
): Exclude<TimelineEditSelection, { kind: "none" }> {
    if (normalizePlayheadBeat(playheadBeat) === 0) return { kind: "home" };
    const start =
        playheadBeat > startBeat
            ? startBeat
            : followingStart(playheadBeat, boxes);
    return { kind: "range", start, end: playheadBeat };
}

/** The range a selection covers, or `null` for home and nothing. */
export function selectionRange(
    selection: TimelineEditSelection,
): { readonly start: number; readonly end: number } | null {
    return selection.kind === "range"
        ? { start: selection.start, end: selection.end }
        : null;
}

/** Whether a selection is exactly the range `[start, end)`. */
export function selectionIsRange(
    selection: TimelineEditSelection,
    start: number,
    end: number,
): boolean {
    return (
        selection.kind === "range" &&
        selection.start === start &&
        selection.end === end
    );
}

/**
 * The stored timeline a selection resolves to: the one with exactly the selected range. `null`
 * for home, nothing, a range with no stored timeline yet, or before the timelines are loaded.
 */
export function resolveStoredTimeline(
    selection: TimelineEditSelection,
    timelines: readonly StoredTimelineMembership[] | null,
): StoredTimelineMembership | null {
    if (selection.kind !== "range" || !timelines) return null;
    return (
        timelines.find(
            (t) => t.start === selection.start && t.end === selection.end,
        ) ?? null
    );
}

/** `resolveStoredTimeline` for the store's state. */
export const selectedStoredTimeline = (
    state: Pick<TimelineSelectionState, "selection" | "storedTimelines">,
): StoredTimelineMembership | null =>
    resolveStoredTimeline(state.selection, state.storedTimelines);

/** The isolated stored timeline with its members, or `null` (also before the timelines load). */
export const isolatedTimeline = (
    state: Pick<TimelineSelectionState, "isolation" | "storedTimelines">,
): StoredTimelineMembership | null =>
    state.isolation === null
        ? null
        : (state.storedTimelines?.find(
              (t) => t.id === state.isolation!.timelineId,
          ) ?? null);

/**
 * The move the window is on (UI-14): the isolated timeline (P may be anywhere inside it), else the
 * stored timeline the window resolves to, when it is off the page boxes. A page's own timeline
 * isn't a move (pages are moved with their flags), so it is `null` there, and with no timeline.
 * The Move card, the inspector's beat and **Select them**'s cleanup all go by this.
 */
export const windowMove = (
    state: Pick<
        TimelineSelectionState,
        "selection" | "storedTimelines" | "isolation" | "pageBoxes"
    >,
): StoredTimelineMembership | null => {
    const timeline = isolatedTimeline(state) ?? selectedStoredTimeline(state);
    if (!timeline) return null;
    const onPageBox = state.pageBoxes.some(
        (box) => box.start === timeline.start && box.end === timeline.end,
    );
    return onPageBox ? null : timeline;
};

/**
 * Whether a marcher is dimmed. Under UI-10 nothing is dimmed: dragging a marcher is what adds it
 * to the window's timeline, so every marcher must stay selectable (_lead default_). Isolating a
 * timeline dims and locks every marcher that isn't in it.
 */
export function isMarcherDimmed(
    state: Pick<
        TimelineSelectionState,
        "selection" | "storedTimelines" | "isolation"
    >,
    marcherId: number,
): boolean {
    const isolated = isolatedTimeline(state);
    return isolated !== null && !isolated.marcherIds.has(marcherId);
}

const HOME: TimelineEditSelection = { kind: "home" };

type WindowFields = Pick<
    TimelineSelectionState,
    "selection" | "startBeat" | "endBeat" | "playheadBeat" | "cursorBeat"
>;

/** The window fields for the flags and P, with `selection` derived from them. */
const windowFields = (
    startBeat: number,
    endBeat: number,
    playheadBeat: number,
    boxes: readonly PageBox[],
): WindowFields => ({
    startBeat,
    endBeat,
    playheadBeat,
    selection: editWindow(startBeat, playheadBeat, boxes),
    // Writing the window puts the canvas back at P (UI-11)
    cursorBeat: null,
});

/** Whether two selections are the same window. */
const sameSelection = (
    a: TimelineEditSelection,
    b: TimelineEditSelection,
): boolean =>
    a.kind === b.kind &&
    (a.kind !== "range" ||
        (b.kind === "range" && a.start === b.start && a.end === b.end));

/**
 * Keeps the current `selection` object when an update writes an equal one, so `s => s.selection`
 * subscribers (the canvas, the timeline, dimming) don't run again for a playhead move inside the
 * same window, or for every scrub beat that rewrites it unchanged.
 */
const keepEqualSelection = (
    s: TimelineSelectionState,
    next: Partial<TimelineSelectionState>,
): Partial<TimelineSelectionState> =>
    next.selection !== undefined &&
    next.selection !== s.selection &&
    sameSelection(next.selection, s.selection)
        ? { ...next, selection: s.selection }
        : next;

/** Whether `beat` is inside the flags, where the playhead rests: `S < beat <= E` (UI-22) */
export const insideFlags = (
    state: Pick<TimelineSelectionState, "startBeat" | "endBeat">,
    beat: number,
): boolean => state.startBeat < beat && beat <= state.endBeat;

/**
 * The flags a click outside them moves to (UI-22): the page box holding `beat` or ending on it;
 * past the last flag, from there to the end of the show. `null` for home.
 */
export function pageAround(
    beat: number,
    boxes: readonly PageBox[],
    showEndBeat: number | null,
): { readonly start: number; readonly end: number } | null {
    if (normalizePlayheadBeat(beat) === 0) return null;
    const box = boxes.find((b) => b.start < beat && beat <= b.end);
    if (box) return box;
    const start = followingStart(beat, boxes);
    return { start, end: Math.max(showEndBeat ?? beat, beat) };
}

/** The timeline-mode flags and playhead. See the module comment. */
export const useTimelineSelectionStore = create<TimelineSelectionState>(
    // eslint-disable-next-line max-lines-per-function
    (rawSet) => {
        const set = (
            update:
                | Partial<TimelineSelectionState>
                | ((
                      s: TimelineSelectionState,
                  ) => Partial<TimelineSelectionState>),
        ) =>
            rawSet((s) =>
                keepEqualSelection(
                    s,
                    typeof update === "function" ? update(s) : update,
                ),
            );
        const clamp = (s: TimelineSelectionState, beat: number) => {
            const whole = normalizePlayheadBeat(beat);
            const bounded =
                s.showEndBeat === null ? whole : Math.min(whole, s.showEndBeat);
            return s.isolation === null
                ? bounded
                : isolatedPlayhead(s.isolation, bounded);
        };
        // Inside isolation the playhead stays after the start: on the start flag, UI-10's window
        // falls back to the page box ending there, so a drag would edit the previous move
        const isolatedPlayhead = (isolation: TimelineIsolation, beat: number) =>
            Math.min(Math.max(beat, isolation.start + 1), isolation.end);
        const fields = (
            s: TimelineSelectionState,
            startBeat: number,
            endBeat: number,
            playheadBeat: number,
        ) => windowFields(startBeat, endBeat, playheadBeat, s.pageBoxes);
        /**
         * The playhead put on `beat` by a click, a go-to, a beat step or a pause (UI-22): inside
         * the flags it stays there; outside, the flags move to the page box holding it. Isolated,
         * it stays inside the isolated range, whose flags don't move
         */
        const place = (
            s: TimelineSelectionState,
            beat: number,
        ): Partial<TimelineSelectionState> => {
            const playhead = clamp(s, beat);
            const revision = { playheadRevision: s.playheadRevision + 1 };
            if (s.isolation)
                return {
                    ...fields(s, s.isolation.start, s.isolation.end, playhead),
                    ...revision,
                };
            if (insideFlags(s, playhead))
                return {
                    ...fields(s, s.startBeat, s.endBeat, playhead),
                    ...revision,
                };
            const page = pageAround(playhead, s.pageBoxes, s.showEndBeat);
            return {
                ...(page
                    ? fields(s, page.start, page.end, playhead)
                    : fields(s, 0, 0, 0)),
                ...revision,
            };
        };
        // While a flag drag holds both flags on one beat, the window is empty there, so neither
        // the page before nor the page box shows selected (UI-21 follow-up). Home stays home
        const lineDragWindow = (
            s: TimelineSelectionState,
            at: TimelineFlagsAndPlayhead,
        ): WindowFields => {
            const window = fields(s, at.startBeat, at.endBeat, at.playheadBeat);
            return at.startBeat === at.endBeat &&
                window.selection.kind === "range"
                ? {
                      ...window,
                      selection: {
                          kind: "range",
                          start: at.endBeat,
                          end: at.endBeat,
                      },
                  }
                : window;
        };
        // Released on the same beat (owner 2026-10-14), the dragged flag stays and shoves the
        // other a beat on: a start flag pushes the end flag a beat later, an end flag pushes the
        // start flag a beat earlier. At the show's end there is no later beat, so the start flag
        // goes back instead. The playhead goes onto the end flag
        const landLineDrag = (
            s: TimelineSelectionState,
            drag: TimelineLineDrag,
        ): Partial<TimelineSelectionState> | null => {
            const beat = s.endBeat;
            if (s.startBeat !== beat || normalizePlayheadBeat(beat) === 0)
                return null;
            const later = clamp(s, beat + 1);
            const [startBeat, endBeat] =
                drag.line === "start" && later > beat
                    ? [beat, later]
                    : [beat - 1, beat];
            return {
                ...fields(s, startBeat, endBeat, endBeat),
                ...(endBeat !== s.playheadBeat
                    ? { playheadRevision: s.playheadRevision + 1 }
                    : {}),
            };
        };
        // Reloads (page boxes, stored timelines, a clip move) rewrite the window without the user
        // seeking; while playing, they keep the cursor and the revision, so the audio isn't
        // restarted (UI-11)
        const keepCursorWhilePlaying =
            <T extends object>(
                fn: (s: TimelineSelectionState) => T,
            ): ((s: TimelineSelectionState) => T) =>
            (s) => {
                const next = fn(s);
                if (s.playback === null) return next;
                return {
                    ...next,
                    ...("cursorBeat" in next
                        ? { cursorBeat: s.cursorBeat }
                        : {}),
                    ...("playheadRevision" in next
                        ? { playheadRevision: s.playheadRevision }
                        : {}),
                };
            };
        const restored = (s: TimelineSelectionState) => {
            const r = s.isolation!.restore;
            return {
                ...fields(
                    s,
                    r.startBeat,
                    r.endBeat,
                    s.showEndBeat === null
                        ? r.playheadBeat
                        : Math.min(r.playheadBeat, s.showEndBeat),
                ),
                isolation: null,
                playheadRevision: s.playheadRevision + 1,
            };
        };
        return {
            selection: HOME,
            startBeat: 0,
            endBeat: 0,
            playheadBeat: 0,
            playheadRevision: 0,
            pageBoxes: [],
            storedTimelines: null,
            showEndBeat: null,
            isolation: null,
            cursorBeat: null,
            looping: false,
            playback: null,
            scrubbing: false,
            lineDrag: null,
            isolate: (timelineId, restore) =>
                set((s) => {
                    if (s.isolation?.timelineId === timelineId) return {};
                    const timeline = s.storedTimelines?.find(
                        (t) => t.id === timelineId,
                    );
                    if (!timeline) return {};
                    const isolation: TimelineIsolation = {
                        timelineId,
                        start: timeline.start,
                        end: timeline.end,
                        // Isolating another timeline from inside one keeps the first restore point
                        restore: s.isolation?.restore ??
                            restore ?? {
                                startBeat: s.startBeat,
                                endBeat: s.endBeat,
                                playheadBeat: s.playheadBeat,
                            },
                    };
                    return {
                        ...fields(
                            s,
                            timeline.start,
                            timeline.end,
                            timeline.end,
                        ),
                        isolation,
                        // Isolated, there is no flag drag (UI-21)
                        lineDrag: null,
                        playheadRevision: s.playheadRevision + 1,
                    };
                }),
            exitIsolation: () =>
                set((s) => (s.isolation === null ? {} : restored(s))),
            selectHome: () =>
                set((s) => ({
                    ...fields(s, 0, 0, 0),
                    isolation: null,
                    scrubbing: false,
                    playheadRevision: s.playheadRevision + 1,
                })),
            selectRange: (start, end) =>
                set((s) => ({
                    isolation: null,
                    scrubbing: false,
                    ...fields(s, start, end, end),
                    playheadRevision: s.playheadRevision + 1,
                })),
            selectNothing: () =>
                set({
                    selection: { kind: "none" },
                    isolation: null,
                    cursorBeat: null,
                }),
            seek: (beat) =>
                set((s) => {
                    if (!Number.isFinite(beat)) return {};
                    // A drag goes anywhere until it ends (`endScrub`)
                    if (s.scrubbing)
                        return {
                            ...fields(
                                s,
                                s.startBeat,
                                s.endBeat,
                                clamp(s, beat),
                            ),
                            playheadRevision: s.playheadRevision + 1,
                        };
                    return place(s, beat);
                }),
            pauseAt: (beat, after) =>
                set((s) => {
                    if (!Number.isFinite(beat)) return {};
                    let playhead = clamp(s, beat);
                    if (after !== undefined && playhead <= after)
                        playhead = clamp(s, after + 1);
                    return place(s, playhead);
                }),
            stopAtEnd: () =>
                set((s) => ({
                    ...fields(s, s.startBeat, s.endBeat, clamp(s, s.endBeat)),
                    scrubbing: false,
                    playheadRevision: s.playheadRevision + 1,
                })),
            beginScrub: () =>
                set((s) => (s.scrubbing ? {} : { scrubbing: true })),
            endScrub: (how = "drag") =>
                set((s) => {
                    if (!s.scrubbing) return {};
                    const done = { scrubbing: false };
                    if (
                        how === "keep" ||
                        s.isolation ||
                        s.selection.kind === "none" ||
                        insideFlags(s, s.playheadBeat) ||
                        // Home, where the flags are on beat 0 with the playhead
                        (s.endBeat === 0 && s.playheadBeat === 0)
                    )
                        return done;
                    const ended = { ...s, ...done };
                    if (how === "click")
                        return { ...done, ...place(ended, s.playheadBeat) };
                    return {
                        ...done,
                        ...fields(s, s.startBeat, s.endBeat, s.endBeat),
                        playheadRevision: s.playheadRevision + 1,
                    };
                }),
            beginLineDrag: (line) =>
                set((s) =>
                    s.isolation !== null ||
                    s.playback !== null ||
                    s.selection.kind === "none"
                        ? {}
                        : {
                              lineDrag: {
                                  line,
                                  startBeat: s.startBeat,
                                  endBeat: s.endBeat,
                                  playheadBeat: s.playheadBeat,
                              },
                          },
                ),
            dragLine: (beat) =>
                set((s) => {
                    const drag = s.lineDrag;
                    if (!drag || !Number.isFinite(beat)) return {};
                    const at = lineDragPositions(drag, clamp(s, beat));
                    if (
                        at.startBeat === s.startBeat &&
                        at.endBeat === s.endBeat &&
                        at.playheadBeat === s.playheadBeat
                    )
                        return {};
                    return {
                        ...lineDragWindow(s, at),
                        ...(at.playheadBeat !== s.playheadBeat
                            ? { playheadRevision: s.playheadRevision + 1 }
                            : {}),
                    };
                }),
            endLineDrag: () =>
                set((s) => {
                    const drag = s.lineDrag;
                    if (!drag) return {};
                    const landed = landLineDrag(s, drag);
                    // The window of two flags on one beat was an empty range: derive it again
                    if (landed) return { lineDrag: null, ...landed };
                    // P stayed put during the drag; the flags may have left it outside, and then
                    // it goes to the end flag
                    if (!insideFlags(s, s.playheadBeat))
                        return {
                            lineDrag: null,
                            ...fields(s, s.startBeat, s.endBeat, s.endBeat),
                            playheadRevision: s.playheadRevision + 1,
                        };
                    return {
                        lineDrag: null,
                        selection: editWindow(
                            s.startBeat,
                            s.playheadBeat,
                            s.pageBoxes,
                        ),
                    };
                }),
            cancelLineDrag: () =>
                set((s) => {
                    const drag = s.lineDrag;
                    if (!drag) return {};
                    return {
                        lineDrag: null,
                        ...fields(
                            s,
                            drag.startBeat,
                            drag.endBeat,
                            drag.playheadBeat,
                        ),
                        ...(drag.playheadBeat !== s.playheadBeat
                            ? { playheadRevision: s.playheadRevision + 1 }
                            : {}),
                    };
                }),
            followTimelineRange: (from, to) =>
                set(
                    keepCursorWhilePlaying((s) => {
                        // A shift carries P along; a resize keeps it inside, on the end if it was
                        const shift =
                            to.end - to.start === from.end - from.start
                                ? to.start - from.start
                                : null;
                        const playhead =
                            shift !== null
                                ? s.playheadBeat + shift
                                : s.playheadBeat === from.end
                                  ? to.end
                                  : Math.min(
                                        Math.max(s.playheadBeat, to.start + 1),
                                        to.end,
                                    );
                        const moved = (t: StoredTimelineMembership) =>
                            t.start === from.start && t.end === from.end
                                ? { ...t, start: to.start, end: to.end }
                                : t;
                        const isolation =
                            s.isolation?.start === from.start &&
                            s.isolation.end === from.end
                                ? {
                                      ...s.isolation,
                                      start: to.start,
                                      end: to.end,
                                  }
                                : s.isolation;
                        // The isolated clip moved or resized: the flags and P go with it
                        if (isolation && isolation !== s.isolation)
                            return {
                                isolation,
                                ...fields(
                                    s,
                                    isolation.start,
                                    isolation.end,
                                    isolatedPlayhead(isolation, playhead),
                                ),
                                storedTimelines:
                                    s.storedTimelines?.map((t) =>
                                        t.id === isolation.timelineId
                                            ? {
                                                  ...t,
                                                  start: isolation.start,
                                                  end: isolation.end,
                                              }
                                            : t,
                                    ) ?? null,
                                playheadRevision: s.playheadRevision + 1,
                            };
                        if (
                            s.startBeat !== from.start ||
                            s.endBeat !== from.end
                        )
                            return {};
                        return {
                            ...fields(s, to.start, to.end, playhead),
                            // Until the host reloads them, move the stored timeline too, so the
                            // moved selection still resolves to it meanwhile
                            storedTimelines:
                                s.storedTimelines?.map(moved) ?? null,
                        };
                    }),
                ),
            followPageFlagMove: (from, to) =>
                set(
                    keepCursorWhilePlaying((s) => {
                        if (s.isolation || from === to) return {};
                        const follow = (beat: number) =>
                            beat === from ? to : beat;
                        const onFlag = (r: { start: number; end: number }) =>
                            r.start === from || r.end === from;
                        const pageBoxes = s.pageBoxes.map((b) =>
                            onFlag(b)
                                ? {
                                      ...b,
                                      start: follow(b.start),
                                      end: follow(b.end),
                                  }
                                : b,
                        );
                        const startBeat = follow(s.startBeat);
                        const endBeat = follow(s.endBeat);
                        const playheadBeat = follow(s.playheadBeat);
                        const fieldsNow =
                            startBeat === s.startBeat &&
                            endBeat === s.endBeat &&
                            playheadBeat === s.playheadBeat
                                ? {}
                                : s.selection.kind === "none"
                                  ? { startBeat, endBeat, playheadBeat }
                                  : windowFields(
                                        startBeat,
                                        endBeat,
                                        playheadBeat,
                                        pageBoxes,
                                    );
                        return {
                            pageBoxes,
                            ...fieldsNow,
                            storedTimelines:
                                s.storedTimelines?.map((t) =>
                                    onFlag(t)
                                        ? {
                                              ...t,
                                              start: follow(t.start),
                                              end: follow(t.end),
                                          }
                                        : t,
                                ) ?? null,
                        };
                    }),
                ),
            followTimelineShift: (from, delta) =>
                useTimelineSelectionStore.getState().followTimelineRange(from, {
                    start: from.start + delta,
                    end: from.end + delta,
                }),
            setPageBoxes: (pageBoxes) =>
                set(
                    keepCursorWhilePlaying((s) => {
                        const same =
                            pageBoxes.length === s.pageBoxes.length &&
                            pageBoxes.every(
                                (b, i) =>
                                    b.start === s.pageBoxes[i]!.start &&
                                    b.end === s.pageBoxes[i]!.end &&
                                    b.name === s.pageBoxes[i]!.name,
                            );
                        if (same) return {};
                        if (s.selection.kind === "none") return { pageBoxes };
                        return {
                            pageBoxes,
                            ...windowFields(
                                s.startBeat,
                                s.endBeat,
                                s.playheadBeat,
                                pageBoxes,
                            ),
                        };
                    }),
                ),
            setStoredTimelines: (storedTimelines) =>
                set(
                    keepCursorWhilePlaying((s) => {
                        // Stored timelines reload after every timeline edit, undo and redo, so
                        // while paused this drops a held preview frame: whatever edited (the
                        // canvas, the inspector, a shortcut) wrote at P, and the canvas goes back
                        // to show it
                        const dropHeld =
                            s.playback === null && s.cursorBeat !== null;
                        if (dropHeld && s.isolation === null)
                            return { storedTimelines, cursorBeat: null };
                        if (s.isolation === null || storedTimelines === null)
                            return {
                                storedTimelines,
                                ...(storedTimelines === null && s.isolation
                                    ? restored(s)
                                    : {}),
                            };
                        const timeline = storedTimelines.find(
                            (t) => t.id === s.isolation!.timelineId,
                        );
                        // The isolated timeline is gone (deleted, or undone away)
                        if (!timeline)
                            return { storedTimelines, ...restored(s) };
                        if (
                            timeline.start === s.isolation.start &&
                            timeline.end === s.isolation.end
                        )
                            return { storedTimelines };
                        // Its range changed (a clip move, a beat edit): follow it
                        const isolation = {
                            ...s.isolation,
                            start: timeline.start,
                            end: timeline.end,
                        };
                        return {
                            storedTimelines,
                            isolation,
                            ...fields(
                                s,
                                isolation.start,
                                isolation.end,
                                isolatedPlayhead(isolation, s.playheadBeat),
                            ),
                            playheadRevision: s.playheadRevision + 1,
                        };
                    }),
                ),
            cue: (beat) =>
                set((s) => {
                    if (!Number.isFinite(beat)) return {};
                    const whole = normalizePlayheadBeat(beat);
                    return {
                        cursorBeat:
                            s.showEndBeat === null
                                ? whole
                                : Math.min(whole, s.showEndBeat),
                        playheadRevision: s.playheadRevision + 1,
                    };
                }),
            clearCursor: () =>
                set((s) => (s.cursorBeat === null ? {} : { cursorBeat: null })),
            // Playing ends a flag drag where it is (UI-21): its release seeks while playing,
            // which no longer reaches the store's line drag. Flags on one beat don't push there
            setPlayback: (playback) =>
                set((s) =>
                    playback === null
                        ? { playback }
                        : {
                              playback,
                              lineDrag: null,
                              // As at the release, a playhead the flags left outside goes to the
                              // end flag. Two flags on one beat get UI-10's window back
                              ...(s.lineDrag && !insideFlags(s, s.playheadBeat)
                                  ? fields(s, s.startBeat, s.endBeat, s.endBeat)
                                  : {
                                        selection: editWindow(
                                            s.startBeat,
                                            s.playheadBeat,
                                            s.pageBoxes,
                                        ),
                                    }),
                          },
                ),
            setLooping: (looping) =>
                set((s) =>
                    looping === s.looping
                        ? {}
                        : {
                              looping,
                              // The run playing now loops or stops at its end from here on
                              ...(s.playback?.kind === "preview"
                                  ? {
                                        playback: {
                                            ...s.playback,
                                            once: !looping,
                                        },
                                    }
                                  : {}),
                          },
                ),
            setShowEndBeat: (showEndBeat) => set({ showEndBeat }),
            reset: () =>
                set((s) => ({
                    ...fields(s, 0, 0, 0),
                    playheadRevision: s.playheadRevision + 1,
                    isolation: null,
                    storedTimelines: null,
                    showEndBeat: null,
                    playback: null,
                    looping: false,
                    scrubbing: false,
                    lineDrag: null,
                })),
        };
    },
);

/**
 * The beat the timeline and the paused canvas show (UI-11): the cursor while a scrub suspends
 * playback, or the playhead. Where audio starts, too.
 */
export const displayedBeat = (
    state: Pick<TimelineSelectionState, "cursorBeat" | "playheadBeat">,
): number => state.cursorBeat ?? state.playheadBeat;

/** The stored timeline the selection resolves to (see `resolveStoredTimeline`). */
export const useSelectedStoredTimeline = (): StoredTimelineMembership | null =>
    useTimelineSelectionStore(selectedStoredTimeline);
