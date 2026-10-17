import { useEffect, type RefObject } from "react";
import type { TimelineXAxis } from "./timelineAxis";
import type { TimelineViewportExtent } from "./TimelineViewModel";

/*
 * How the timeline's surface tells its owner how much room to leave past where playback stops
 * (docs/tempo/endless-counts.md rule 7, decisions.md EC-9), and what Fit fits in the Align view.
 */

/**
 * Tells the owner how many counts a screen holds (rule 7), so it can leave room past where
 * playback stops. Reports on resize and when the zoom changes, but only when the answer changes
 * by a tenth or more.
 */
export function useViewportExtent(
    viewportRef: RefObject<HTMLElement | null>,
    axis: Pick<TimelineXAxis, "pxPerBeatAt">,
    beatCount: number,
    onExtent: ((extent: TimelineViewportExtent) => void) | undefined,
): void {
    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport || !onExtent) return;
        let last: number | null = null;
        const report = () => {
            const width = viewport.clientWidth;
            if (!(width > 0)) return;
            const screenBeats =
                width / axis.pxPerBeatAt(Math.max(beatCount - 1, 0));
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
    }, [axis, beatCount, onExtent, viewportRef]);
}

/** The seconds Fit fits in the Align view: up to `fitBeatCount` (where playback stops), or all */
export const fitSeconds = (
    axis: Pick<TimelineXAxis, "extent" | "toUnit">,
    fitBeatCount: number | undefined,
) =>
    fitBeatCount === undefined
        ? axis.extent
        : Math.min(axis.extent, axis.toUnit(fitBeatCount));
