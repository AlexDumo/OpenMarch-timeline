import { useEffect, useRef, type RefObject } from "react";
import type { TimelineViewportExtent } from "./TimelineViewModel";

/**
 * Tells the timeline's owner how many counts a screen holds (docs/timeline/endless-counts.md rule 7,
 * EC-9), so it can leave room past where playback stops. Reports on resize and when the zoom
 * changes, but only when the answer changes by a tenth or more since the last report, so a zoom
 * gesture's frames report only once they add up to a tenth.
 */
export function useViewportExtent(
    viewportRef: RefObject<HTMLElement | null>,
    pixelsPerBeat: number,
    onExtent: ((extent: TimelineViewportExtent) => void) | undefined,
): void {
    const pixelsPerBeatRef = useRef(pixelsPerBeat);
    pixelsPerBeatRef.current = pixelsPerBeat;
    const onExtentRef = useRef(onExtent);
    onExtentRef.current = onExtent;
    const lastRef = useRef<number | null>(null);
    const reportRef = useRef(() => {
        const viewport = viewportRef.current;
        const ppb = pixelsPerBeatRef.current;
        const report = onExtentRef.current;
        if (!viewport || !report || !(ppb > 0)) return;
        const width = viewport.clientWidth;
        if (!(width > 0)) return;
        const screenBeats = width / ppb;
        const last = lastRef.current;
        if (last !== null && Math.abs(screenBeats - last) < last * 0.1) return;
        lastRef.current = screenBeats;
        report({ screenBeats });
    });

    // Resizes: one observer for the viewport's life, reading the zoom through the ref
    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport || typeof ResizeObserver === "undefined") return;
        const report = reportRef.current;
        const observer = new ResizeObserver(() => report());
        observer.observe(viewport);
        return () => observer.disconnect();
    }, [viewportRef]);

    // The first report, and zoom changes
    useEffect(() => {
        reportRef.current();
    }, [pixelsPerBeat, onExtent]);
}
