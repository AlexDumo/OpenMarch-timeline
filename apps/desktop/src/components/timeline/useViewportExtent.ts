import { useEffect, type RefObject } from "react";
import type { TimelineViewportExtent } from "./TimelineViewModel";

/**
 * Tells the timeline's owner how many counts a screen holds (docs/timeline/endless-counts.md rule 7,
 * EC-9), so it can leave room past where playback stops. Reports on resize and when the zoom
 * changes, but only when the answer changes by a tenth or more.
 */
export function useViewportExtent(
    viewportRef: RefObject<HTMLElement | null>,
    pixelsPerBeat: number,
    onExtent: ((extent: TimelineViewportExtent) => void) | undefined,
): void {
    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport || !onExtent || !(pixelsPerBeat > 0)) return;
        let last: number | null = null;
        const report = () => {
            const width = viewport.clientWidth;
            if (!(width > 0)) return;
            const screenBeats = width / pixelsPerBeat;
            if (last !== null && Math.abs(screenBeats - last) < last * 0.1)
                return;
            last = screenBeats;
            onExtent({ screenBeats });
        };
        report();
        const observer =
            typeof ResizeObserver === "undefined"
                ? null
                : new ResizeObserver(report);
        observer?.observe(viewport);
        return () => observer?.disconnect();
    }, [pixelsPerBeat, onExtent, viewportRef]);
}
