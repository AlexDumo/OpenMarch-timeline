import { createContext, useContext, type ReactNode } from "react";

/**
 * Where an extra band under the clip rows draws, in the surface's own
 * coordinates: x 0 is beat 0, and `top` is just below the last row.
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
 * A band the timeline draws under its clip rows (performer-behavior.md
 * section 7.1, Visuals mode's cue lanes): it grows the timeline by `height`
 * and draws `render` there. Not in Basic, which has no clip rows.
 */
export interface TimelineBand {
    height: number;
    render(geometry: TimelineBandGeometry): ReactNode;
}

const TimelineBandContext = createContext<TimelineBand | null>(null);

export function TimelineBandProvider({
    band,
    children,
}: {
    band: TimelineBand | null;
    children: ReactNode;
}) {
    return (
        <TimelineBandContext.Provider value={band}>
            {children}
        </TimelineBandContext.Provider>
    );
}

export function useTimelineBand(): TimelineBand | null {
    return useContext(TimelineBandContext);
}
