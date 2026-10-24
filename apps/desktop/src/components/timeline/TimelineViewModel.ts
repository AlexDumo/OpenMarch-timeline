import type { LabeledHoldMarks } from "./PageHoldMark";
import type { TimelineBand } from "./TimelineBand";
import type { PageKeepChains } from "./PageKeepChain";
import type { TimelineClipResizeCommands } from "./TimelineClipResize";
import type { TimelineDrillFlagMove } from "./TimelinePageFlagHandles";
import type { TimelineClipPeel } from "./TimelineClipPeel";
import type { ReactNode } from "react";
import type { AudioEnvelope } from "@/timeline/timelineWaveform";
import type { CountUnit, TypedSection } from "@/timeline/tempo";
import type {
    TimelineAddMarchersMenu,
    TimelineMoveCommands,
    TimelineMenuTarget,
} from "./TimelineRangeMenu";
import type { TimelineMeasureRowCommands } from "./TimelineMeasureRow";

export type TimelineTrackId = string | number;

/**
 * An x-position in the timeline measured in beats. Integer positions are beat
 * boundaries; fractional positions are used by the playback and hover cursors.
 */
export type BeatPosition = number;

/** All timeline ranges use an inclusive start and an exclusive end. */
export interface TimelineBeatRange {
    readonly startBeatIndex: number;
    readonly endBeatIndex: number;
}

export interface TimelineMarker {
    readonly id: string | number;
    readonly label: string;
    readonly atBeat: BeatPosition;
}

export interface TimelinePageMarker extends TimelineMarker {
    /** The zero-count setup page that precedes the beat-scaled timeline. */
    readonly isInitial: boolean;
    /**
     * Where the page's flag is: the end of its counts (UI-9). The last page's box ends here, not at
     * the end of the beats. Without it, a page ends where the next one starts, or at the end.
     */
    readonly endBeat?: BeatPosition;
}

/** Where a page flag can go, in view beats, and what stops it at each end, in words */
export interface TimelinePageFlagLimits {
    /** The flag's beat now */
    readonly flag: BeatPosition;
    readonly min: BeatPosition;
    readonly max: BeatPosition;
    /** Why it stops at `min`, such as "Page 2's flag" */
    readonly minReason: string;
    readonly maxReason: string;
    /** Beats between `min` and `max` the flag passes over but can't land on, and why */
    readonly holes?: readonly {
        readonly beat: BeatPosition;
        readonly reason: string;
    }[];
}

/** Moving a page flag (docs/timeline/research/move-page-flag), in view beats */
export interface TimelinePageFlagMove {
    /** Where page `pageId`'s flag can go now; null where it can't move */
    readonly limits: (
        pageId: string | number,
    ) => Promise<TimelinePageFlagLimits | null>;
    /**
     * Moves page `pageId`'s flag to `beat`, as one undoable edit. It may return a promise that
     * settles once the pages show the move (or the move was refused); it never rejects.
     */
    readonly commit: (
        pageId: string | number,
        beat: BeatPosition,
    ) => Promise<void> | void;
}

export interface TimelineMeasureMarker extends TimelineMarker {
    readonly rehearsalMark?: string | null;
}

export interface TimelineLeg {
    readonly id: string | number;
    readonly startBeat: BeatPosition;
    readonly endBeat: BeatPosition;
    /** Retained for the movement engine; the timeline no longer encodes it visually. */
    readonly texture: "move" | "hold";
}

export interface TimelineActivitySpan {
    readonly startBeatIndex: number;
    readonly endBeatIndex: number;
    readonly active: boolean;
}

export interface TimelineTarget {
    readonly id: string | number;
    readonly type: "marcher" | "shape";
}

/** What a track stands for: a marcher or a shape (stories), or a whole stored timeline (UI-9) */
export type TimelineTrackTargetType = TimelineTarget["type"] | "timeline";

export interface TimelineTrack {
    readonly id: TimelineTrackId;
    /**
     * Tracks with the same link id move together (ui.md: a clip move moves its whole spec
     * timeline), so selecting one highlights the others.
     */
    readonly linkId?: string | number;
    readonly targetId: string;
    readonly targetType: TimelineTrackTargetType;
    readonly label: string;
    readonly color: string;
    readonly legs: readonly TimelineLeg[];
    /** A gap-free, non-overlapping partition of the track's complete range. */
    readonly activitySpans: readonly TimelineActivitySpan[];
    /**
     * What screen readers call the clip, when the owner can say more than the label (UI-14 review:
     * "Move 1, Page 3, counts 1–4"); without it, the label and its beats
     */
    readonly accessibleName?: string;
    /** More about the clip, for its tooltip and screen readers (UI-14 review: why it is dashed) */
    readonly description?: string;
}

export interface TimelineWaveform {
    /**
     * Normalized peak magnitudes (0..1), grouped by beat. It may stop before the timeline's last
     * beat (the music ends); the beats after it have none.
     */
    readonly peaksByBeat: readonly (readonly number[])[];
}

/**
 * **+ Add N-Count Page** beside the paused playhead past the last page (UI-9, owner 2026-10-20;
 * it replaced **+ N counts** after the last flag): a page from the last flag to the playhead, N
 * counts long, as **Create page at playhead** adds there. Hovering it shades where the page goes.
 */
export interface TimelineAppendAtPlayhead {
    /** The new page's counts, from the last page's flag to the playhead */
    readonly counts: number;
    /** The button's text, such as "Add 3-Count Page" */
    readonly label: string;
    /** Its tooltip and accessible name */
    readonly title: string;
    readonly onAppend: () => void;
    /**
     * With Shift held the button adds the page as a subset (owner 2026-10-20), as **Create subset
     * at playhead** does: its text and tooltip, and the add
     */
    readonly subset?: {
        readonly label: string;
        readonly title: string;
        readonly onAppend: () => void;
    };
}

/** What the timeline's scroller shows, so its owner can leave room past the show (endless counts) */
export interface TimelineViewportExtent {
    /** The scroller's width in pixels; with the zoom, how many counts one screen holds */
    readonly width: number;
}

export interface TimelineViewModel {
    readonly beatCount: number;
    readonly pages: readonly TimelinePageMarker[];
    readonly measures: readonly TimelineMeasureMarker[];
    readonly tracks: readonly TimelineTrack[];
    readonly waveform: TimelineWaveform;
}

/**
 * The timeline's selection (ui.md UI-9, "What the selection holds"): home (the initial page box),
 * a range (a page box, a dragged range, or a resized one), or nothing. A page box is the range from
 * the previous flag to its own flag, so a page is selected exactly when its range is. In the app it
 * mirrors `useTimelineSelectionStore`.
 */
export type TimelineSelection =
    | { readonly kind: "home" }
    | {
          readonly kind: "range";
          readonly range: TimelineBeatRange;
          /**
           * Where the start flag is drawn (UI-10), when it isn't the range's start: after C the
           * flag sits on the playhead and the window falls back to the page box
           */
          readonly startFlagBeatIndex?: number;
          /** How the user set this window (UI-17): `pages` for Shift+click on page boxes */
          readonly via?: "pages";
          /** The range was drawn by dragging on empty timeline space (Ctrl+drag) */
          readonly drawn?: boolean;
          /**
           * UI-25: the stored timeline the window stands for, when known (a clicked clip; the
           * app's resolved one). Several moves may share a range since a move can be split off a
           * page's timeline, so the range alone doesn't say which clip is selected
           */
          readonly timelineId?: number;
          /**
           * UI-25: the window is a move's clip, not a page box, though its range may be a page
           * box's (a move split off it): the page box doesn't show selected
           */
          readonly onClip?: boolean;
          /**
           * UI-25: a second move selected beside the window's (Shift+click on its clip), for
           * **Merge moves**; its clip shows selected too
           */
          readonly pairedTimelineId?: number;
          /** From the timeline: a Shift+click on a clip, which adds it beside the selected one */
          readonly extend?: boolean;
      }
    | null;

/**
 * Where a seek sits in a pointer or key gesture (UI-12 review). `press` is the pointer going down
 * (a click so far), `drag` is the gesture moving the playhead, and `end` is its release or cancel.
 * A seek without a gesture is one explicit action (a rehearsal tab, the go-to box). While playing,
 * a drag suspends playback, which resumes once from where the gesture ends; a press that ends
 * without a drag jumps playback there. The start flag moves once, when the gesture ends.
 */
export type TimelineSeekGesture = "press" | "drag" | "end" | "cancel";

export interface TimelineSeekOptions {
    readonly gesture?: TimelineSeekGesture;
    /**
     * The gesture drags this line by itself (UI-21): the start flag, or the playhead by its line or
     * head. Paused, a line dragged past the other swaps with it. `cancel` ends a start flag drag
     * where it began.
     */
    readonly line?: "start" | "playhead";
}

/**
 * A seek to a whole beat. During a scrub (`press` and `drag`) the owner may return the beat the
 * playhead is on once the seek has landed, in the same beats as the seek: the beat sent, or
 * another when the playhead couldn't follow (held inside an isolated range), so the scrub's line
 * stays on it (`scrubLineBeat`). Nothing when it can't tell, or for any other seek.
 */
export type TimelineSeek = (
    beat: BeatPosition,
    options?: TimelineSeekOptions,
) => number | void;

/** Page navigation: Q and E, Shift for the start and end of the show */
export type TimelinePageNavigation =
    | "first-page"
    | "previous-page"
    | "next-page"
    | "last-page";

/** Q and E with Alt (or Alt+click Previous and Next) step a beat instead of a page */
export type TimelineNavigation =
    | TimelinePageNavigation
    | "previous-beat"
    | "next-beat";

export interface TimelineInteractionProps {
    readonly positionBeat: BeatPosition;
    /**
     * While playing, the live position in view beats, fractional, or `null` when there is none.
     * The playhead line reads it every animation frame so it moves smoothly; everything else
     * follows `positionBeat`, which changes once per beat.
     */
    readonly livePositionBeat?: () => number | null;
    /** While playing, where Stop goes back to, in view beats (UI-24) */
    readonly returnBeat?: BeatPosition;
    readonly isPlaying: boolean;
    readonly selection?: TimelineSelection;
    readonly selectedTarget?: TimelineTarget | null;
    readonly onSeek?: TimelineSeek;
    readonly onPlayingChange?: (isPlaying: boolean) => void;
    /** Looping is on, so Play loops (UI-17) */
    readonly playLoops?: boolean;
    /** Shift+click on Play (Shift+Space): plays on from the playhead, or the loop once */
    readonly onPlayFromPlayhead?: () => void;
    /** Alt+click on Play (Alt+Space): plays on from the start flag (Expert, UI-26) */
    readonly onPlayOn?: () => void;
    readonly onNavigate?: (direction: TimelineNavigation) => void;
    readonly onSelectionChange?: (selection: TimelineSelection) => void;
    readonly onCreateTrack?: (request: TimelineCreateTrackRequest) => void;
    /** The right-click menu's **Add selected marchers** (UI-9, P8.14), in view beats here */
    readonly addSelectedMarchers?: TimelineAddMarchersMenu<TimelineMenuTarget>;
    /** A clip's move commands (UI-14), by track id here: its menu, ⋯ button and keys */
    readonly moveCommands?: TimelineMoveCommands<TimelineTrackId>;
    /**
     * UI-9 **Create page at playhead**: adds a page whose flag is at the paused playhead, from the playhead's
     * right-click menu while it's given and the timeline isn't playing; the owner passes it only
     * where a page can be added. Without it the playhead has no menu.
     */
    readonly onAddPageFlag?: () => void;
    /** **Create subset at playhead** in the playhead's right-click menu, after **Create page at playhead** */
    readonly onAddSubsetPage?: () => void;
    /** The names the playhead's menu shows, muted, after **Create page at playhead** and **Create subset at playhead** */
    readonly addPageNames?: { readonly page: string; readonly subset: string };
    /**
     * Moving page flags by their grips (docs/timeline/research/move-page-flag), in view beats here.
     * The owner passes it only where flags can move (paused, not isolated).
     */
    readonly pageFlagMove?: TimelinePageFlagMove;
    /** **+ Add N-Count Page** at the playhead past the last page; without it, none */
    readonly appendAtPlayhead?: TimelineAppendAtPlayhead;
    /** The beats Fit fits (rule 7: where playback stops), in view beats; without it, every beat */
    readonly fitBeatCount?: number;
    /** The scroller's width (rule 7) */
    readonly onViewportExtent?: (extent: TimelineViewportExtent) => void;
    /** Double-clicking a page box or clip opens (isolates) its range, in view beats here */
    readonly onOpenRange?: (target: TimelineMenuTarget) => void;
    /**
     * Editing rehearsal marks and measure lines on the measure row (tempo E8), in view beats here.
     * Without it, the row only shows them.
     */
    readonly measureRow?: TimelineMeasureRowCommands;
}

export interface TimelineScaleProps {
    readonly pixelsPerBeat: number;
    readonly onPixelsPerBeatChange?: (pixelsPerBeat: number) => void;
    /** The zoom was fitted to the show last time (UI-12): the timeline opens fitted */
    readonly zoomFitted?: boolean;
    readonly onZoomFittedChange?: (fitted: boolean) => void;
}

/** A retime from the Align view, in spec count indexes, written as one undo entry */
export interface TimelineAlignEdit {
    /** Every count's new length, by ordinal (`beats` order) */
    readonly durations: readonly number[];
    /** How far count 1 moved against the music (`RetimeResult.originShift`) */
    readonly originShift: number;
    /** The synced counts afterwards */
    readonly synced: readonly number[];
}

/**
 * The Align view (E7, Tempo lab `alignView`; docs/tempo/README.md). Counts are spec count
 * indexes, as in `@/timeline/tempo`. Without it, the timeline has no Align view.
 */
export interface TimelineAlign {
    /** Whether the Align view is on; only the user changes it (`onToggle`) */
    readonly on: boolean;
    readonly onToggle: (on: boolean) => void;
    /** A key press doesn't toggle it, as when A moves the selected marchers */
    readonly keyBlocked?: boolean;
    /** Every count's length in seconds, by ordinal */
    readonly durations: readonly number[];
    /** The counts already on the music, ascending */
    readonly synced: readonly number[];
    /** The audio offset: positive pads silence before the music */
    readonly audioOffsetSeconds: number;
    /** The music, on the show's clock */
    readonly envelope: AudioEnvelope | null;
    /** Writes a retime; resolves once the timeline shows it (or it failed) */
    readonly onRetime: (edit: TimelineAlignEdit) => Promise<unknown> | void;
    /** Replaces the synced counts */
    readonly onSetSynced: (synced: readonly number[]) => void;
    /** Punch-in tap (E9, Tempo lab `punchInTap`); without it, Align has no Tap */
    readonly punchTap?: TimelinePunchTapConfig;
    /**
     * What the tempo map knows (FX-5, FX-7): each count's note and its length in it (by count
     * index), for "♩.=88" labels, and the typed sections a drag must not rescale silently.
     */
    readonly tempoMap?: {
        readonly units: readonly (CountUnit | undefined)[];
        readonly sections: readonly TypedSection[];
        /** Counts a ● row starts or ends on: synced by typing, not lined up (DE-6) */
        readonly edges?: readonly number[];
    };
}

/**
 * What punch-in tap needs from the app: playback, the live clock, and where to report. A take is
 * applied with Done (Enter), on leaving Align, or when another tool opens (DT-1).
 */
export interface TimelinePunchTapConfig {
    /**
     * Where the music was when an input event happened, in seconds on the show's clock (the
     * event's `timeStamp`, on the `performance.now()` clock, corrects for a late handler)
     */
    readonly liveTime: (eventTimeStamp: number) => number;
    /** Plays from spec count `from` (a count-in); false when nothing can play */
    readonly play: (from: number) => boolean;
    /** Another tool has T now, such as Tap the beat's open panel */
    readonly blocked?: () => boolean;
    /** Another tool is open now (Tap the beat's panel): opening it applies the take */
    readonly otherToolOpen?: boolean;
    /** After the taps were written, with "Lined up pages 12–18 to your taps." */
    readonly onApplied?: (message: string) => void;
    /** A take that couldn't be applied on leaving (it would change a typed tempo), and why */
    readonly onNotice?: (message: string) => void;
}

export interface TimelineCommonProps
    extends TimelineInteractionProps, TimelineScaleProps {
    readonly model: TimelineViewModel;
    /** The Align view, with the view axis's hidden beats (spec index = view beat + `offset`) */
    readonly align?: TimelineAlign & { readonly offset: number };
    readonly showTransport?: boolean;
    /** The playback clock shown in the transport. The app passes its audio clock; stories pass none. */
    readonly transportClock?: ReactNode;
    /**
     * A timeline that only navigates (Visuals mode, performer-behavior.md section 7.1): page
     * boxes select and the ruler seeks, but nothing draws a range. The owner passes no editing
     * commands
     */
    readonly readOnly?: boolean;
    /**
     * A read-only timeline's start flag (view beats), drawn with no handles: Play starts there,
     * so it shows even where nothing moves it by hand
     */
    readonly startFlagBeat?: number;
    /** Lanes drawn where the clip rows go, under the waveform (Visuals mode's cue lanes) */
    readonly band?: TimelineBand;
    /** Extra transport controls, such as volume, the metronome and fullscreen */
    readonly transportAccessories?: ReactNode;
    readonly className?: string;
    readonly onTimelineRangeCommit?: (
        change: TimelineRangeChange,
    ) => TimelineRangeCommitResult;
    /** Resizing a clip by its edges (resize-move), in view beats; without it clips have no handles */
    readonly clipResize?: TimelineClipResizeCommands;
    /** UI-25: dragging a clip down splits the selected marchers off; onto a move, merges */
    readonly clipPeel?: TimelineClipPeel;
    /** The loop (UI-17), view beats; `null` or absent when looping is off */
    readonly loop?: TimelineBeatRange | null;
    /** A loop end dragged or stepped (UI-17), view beats */
    readonly onLoopChange?: (loop: TimelineBeatRange) => void;
    /** Transport controls that fold into "⋯" on a narrow panel, such as Sound (UI-12) */
    readonly transportSecondary?: ReactNode;
    /** View controls first in the transport's right group, before Fit (fork #331); they fold too */
    readonly transportLeadingViewControls?: ReactNode;
    /** View controls at the transport's end, such as Compact (UI-12); they fold too */
    readonly transportViewControls?: ReactNode;
    /** Where the selected marchers hold, on the page boxes (UI-18); none without a selection */
    readonly holdMarks?: LabeledHoldMarks;
    /** The chains on the page boxes (UI-18 keep later pages); none without a selection */
    readonly keepChains?: PageKeepChains;
    /**
     * The moves a page box stands for, so they have no clip (`timelinesOffPages`), by track id.
     * One that gets a clip (its box was split, or a flag deleted) drops out of the page row
     * (`useClipDrops`)
     */
    readonly pageMoves?: ReadonlySet<string | number>;
    /** UI-19 Basic: the selected marchers' mid-page positions, view beats */
    readonly basicPoints?: readonly TimelineBasicPoint[];
    /** UI-19 Basic: **Remove this count's position**, by its view beat */
    readonly onRemoveBasicPoint?: (beat: number) => void;
    /** UI-19 Basic: per page id, how many marchers on it use Expert moves (locked in Basic) */
    readonly expertMarks?: ReadonlyMap<string | number, number>;
    /**
     * Page flag grips that move a flag and carry the drill (Tempo lab `drillChoices`, E10), in
     * view beats. When set, they take the place of the `pageFlagMove` grips (UI-16).
     */
    readonly drillFlagMove?: TimelineDrillFlagMove;
    /**
     * A notice over the waveform lane's left edge, such as Tap the beat's "Counts aren't lined up
     * with the music yet" (Tempo lab, E6). Shown only in the full timeline, with audio loaded.
     */
    readonly waveformNotice?: ReactNode;
    /** A small action at the waveform lane's right edge (Tap the beat's way back, FB-4) */
    readonly waveformAction?: ReactNode;
    /** Drawn over the lanes (Tap the beat's preview and flash, FB-5) */
    readonly countOverlay?: TimelineCountOverlay;
    /** Spec beats hidden before view beat 0 (spec = view + offset) */
    readonly beatOffset?: number;
}

/** A mid-page position on a Basic page box (UI-19): its beat and its count in words */
export interface TimelineBasicPoint {
    readonly beat: number;
    /** "count 4 of page 2" */
    readonly label: string;
}

/** Where to draw over the timeline: a spec count position (fractional) to x, and the lane */
export type TimelineCountOverlay = (geometry: {
    readonly toX: (count: number) => number;
    readonly top: number;
    readonly height: number;
}) => ReactNode;

export interface TimelineRangeChange extends TimelineBeatRange {
    readonly timelineId: TimelineTrackId;
}

/**
 * What committing a clip's new range (a move or resize) returns: a promise of whether it was
 * written, so a released drag knows to let go of its preview at once when it wasn't (refused or
 * failed). It never rejects. Nothing (`void`) leaves the preview until the new range arrives.
 */
export type TimelineRangeCommitResult = Promise<boolean> | void;

export interface TimelineCreateTrackRequest {
    readonly target: TimelineTarget;
    readonly range: TimelineBeatRange;
}
