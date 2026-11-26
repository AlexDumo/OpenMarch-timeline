import type { ReactNode } from "react";
import type { TimelineBeatRange } from "./TimelineViewModel";

/**
 * Where a timeline's lanes draw (`TimelineBand`), in the surface's own
 * coordinates: x 0 is beat 0, and `top` is just below the waveform.
 */
export interface TimelineBandGeometry {
    top: number;
    width: number;
    pixelsPerBeat: number;
    beatCount: number;
    /** The beats a drag pulls to: page lines and downbeats (`snapSeekBeat`). */
    snapBeats: readonly number[];
    /**
     * The page lines alone, and the measures' downbeats alone, for a dragged edge's rule
     * (`snapEdgeBeat`: page lines from 12 px, downbeats from 6 px). Absent: `snapBeats` for both
     */
    pageBeats?: readonly number[];
    downbeats?: readonly number[];
    /** The room left of beat 0 (the home page's column): x -leadingInset is the scroll's left edge */
    leadingInset: number;
    /**
     * Selects `[start, end)` as the window (S at its start, the playhead at its end), as a click on
     * a move's clip does. Absent where the timeline can't select.
     */
    onSelectRange?: (range: TimelineBeatRange) => void;
}

/**
 * Lanes a timeline draws in place of its clip rows (tempo mode's lanes): they make the timeline `height`
 * tall below the waveform and draw `render` there. Not in Basic.
 */
export interface TimelineBand {
    height: number;
    /**
     * The band is what's being edited (tempo mode): the timeline quiets its page row and offers no
     * page editing (moving page flags, adding pages at the playhead) while it shows
     */
    focus?: boolean;
    /** A row the timeline draws over its transport while the band shows: the band's own header */
    header?: ReactNode;
    /**
     * Lanes under the clip rows: something in them takes presses (a cue lane shows), so the
     * playhead and start flag are grabbed only above them. Without it (only the Lanes button shows),
     * they're grabbed the whole way down, as with no lanes.
     */
    takesPresses?: boolean;
    render(geometry: TimelineBandGeometry): ReactNode;
    /**
     * A control the timeline draws in its bottom-left corner, over the viewport, where it stays in
     * view however the timeline scrolls (the Lanes button). It takes no room in the band; lane
     * labels stick clear of it (`LANE_LABEL_STICKY_CLASS`).
     */
    corner?: ReactNode;
}

/**
 * How far in from the viewport's left edge a lane's label (its heading, a row's name) sticks while
 * the timeline scrolls, so the corner control (`TimelineBand.corner`) doesn't cover it. The shell
 * sets it as `--lane-label-inset`, beside the corner:
 * - 28 px clears the 24 px control with a 4 px gap;
 * - on touch the control is 44 px, and 40 px leaves it over the label's 4–6 px padding, not its
 *   text. Clearing it fully would move every label, and its 44 px touch buttons, before a scroll.
 *
 * Both are within the home page's 40 px column (`TIMELINE_INITIAL_PAGE_WIDTH`), so a label stays
 * where it is until the timeline scrolls. For inline styles (a bar's name pinned past its row's
 * name); 0 outside a timeline shell.
 */
export const LANE_LABEL_INSET = "var(--lane-label-inset, 0px)";

/** A lane label that sticks at the visible left edge, `LANE_LABEL_INSET` in */
export const LANE_LABEL_STICKY_CLASS =
    "sticky left-[var(--lane-label-inset,0px)]";
