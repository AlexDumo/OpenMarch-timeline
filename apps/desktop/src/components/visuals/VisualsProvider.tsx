/**
 * Visuals mode's data for the whole workspace (performer-behavior.md
 * section 7.1): one compile of the show's cues for the focused who, read by
 * the timeline's cue band and by the inspector's cue panel and why readout.
 * Always rendered, so switching modes keeps the timeline and the inspector
 * mounted; outside Visuals mode it compiles nothing and gives no band.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { TimelineBandProvider } from "@/components/timeline/TimelineBand";
import { useIsVisualsView } from "@/stores/WorkspaceViewStore";
import { useVisualsStore } from "@/stores/VisualsStore";
import { useVisualsBandData, type VisualsBandData } from "./useVisualsBandData";
import { visualsTimelineBand } from "./VisualsCueBand";
import { useVisualsFocusSync } from "./useVisualsFocusSync";

const VisualsDataContext = createContext<VisualsBandData | null>(null);

export function VisualsProvider({ children }: { children: ReactNode }) {
    // here, not in the inspector, so the focus stays current while the
    // inspector is hidden (fullscreen)
    useVisualsFocusSync();
    const visuals = useIsVisualsView();
    const data = useVisualsBandData(visuals);
    const collapsed = useVisualsStore((s) => s.bandCollapsed);
    const band = useMemo(
        () => (visuals ? visualsTimelineBand(data, collapsed) : null),
        [visuals, data, collapsed],
    );
    return (
        <VisualsDataContext.Provider value={data}>
            <TimelineBandProvider band={band}>{children}</TimelineBandProvider>
        </VisualsDataContext.Provider>
    );
}

/** The focused who's lanes, result and compile; null with no focus. */
export function useVisualsData(): VisualsBandData | null {
    return useContext(VisualsDataContext);
}
