import { useEffect, useRef, type RefObject } from "react";
import type { TimelineXAxis } from "./timelineAxis";
import type { TimelineViewportExtent } from "./TimelineViewModel";

/**
 * Tells the timeline's owner how wide a screen is (docs/timeline/endless-counts.md rule 7, EC-9),
 * so it can leave room past where playback stops. The owner holds the zoom too, so it works out
 * the counts a screen holds as it renders, in the zoom's own commit. Reports once, then on resizes
 * that change the width by a tenth or more since the last report.
 */
export function useViewportExtent(
    viewportRef: RefObject<HTMLElement | null>,
    onExtent: ((extent: TimelineViewportExtent) => void) | undefined,
): void {
    const onExtentRef = useRef(onExtent);
    onExtentRef.current = onExtent;
    const lastRef = useRef<number | null>(null);
    const reportRef = useRef(() => {
        const viewport = viewportRef.current;
        const report = onExtentRef.current;
        if (!viewport || !report) return;
        const width = viewport.clientWidth;
        if (!(width > 0)) return;
        const last = lastRef.current;
        if (last !== null && Math.abs(width - last) < last * 0.1) return;
        lastRef.current = width;
        report({ width });
    });

    // One observer for the viewport's life
    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport || typeof ResizeObserver === "undefined") return;
        const report = reportRef.current;
        const observer = new ResizeObserver(() => report());
        observer.observe(viewport);
        return () => observer.disconnect();
    }, [viewportRef]);

    // The first report, and a new owner
    useEffect(() => {
        if (onExtent) lastRef.current = null;
        reportRef.current();
    }, [onExtent]);
}

/** The seconds Fit fits in the Align view: up to `fitBeatCount` (where playback stops), or all */
export const fitSeconds = (
    axis: Pick<TimelineXAxis, "extent" | "toUnit">,
    fitBeatCount: number | undefined,
) =>
    fitBeatCount === undefined
        ? axis.extent
        : Math.min(axis.extent, axis.toUnit(fitBeatCount));
