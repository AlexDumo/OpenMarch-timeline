import type { ReactNode } from "react";

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
}

/**
 * Lanes a timeline draws in place of its clip rows (performer-behavior.md
 * section 7.1, Visuals mode's cue lanes): they make the timeline `height`
 * tall below the waveform and draw `render` there. Not in Basic.
 */
export interface TimelineBand {
    height: number;
    render(geometry: TimelineBandGeometry): ReactNode;
}
