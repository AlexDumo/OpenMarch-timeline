/**
 * Visuals mode's data for the whole workspace (performer-behavior.md
 * section 7.1): one compile of the show's cues for the focused who, read by
 * its timeline's cue lanes and by the inspector's cue panel and why
 * readout. Always rendered, so switching modes keeps the compile's queries;
 * outside Visuals mode it compiles nothing.
 */
import { createContext, useContext, type ReactNode } from "react";
import { useIsVisualsView } from "@/stores/WorkspaceViewStore";
import { useVisualsBandData, type VisualsBandData } from "./useVisualsBandData";
import { useVisualsWorkspaceLock } from "./useVisualsWorkspaceLock";
import { useVisualsFocusSync } from "./useVisualsFocusSync";

const VisualsDataContext = createContext<VisualsBandData | null>(null);

export function VisualsProvider({ children }: { children: ReactNode }) {
    // here, not in the inspector, so the focus stays current while the
    // inspector is hidden (fullscreen)
    useVisualsFocusSync();
    const visuals = useIsVisualsView();
    const data = useVisualsBandData(visuals);
    useVisualsWorkspaceLock(visuals);
    return (
        <VisualsDataContext.Provider value={data}>
            {children}
        </VisualsDataContext.Provider>
    );
}

/** The focused who's lanes, result and compile; null with no focus. */
export function useVisualsData(): VisualsBandData | null {
    return useContext(VisualsDataContext);
}
