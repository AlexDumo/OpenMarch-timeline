import { memo, useEffect, useRef, useState, type RefObject } from "react";
import type { TimelineXAxis } from "./timelineAxis";
import type { TimelineViewportExtent } from "./TimelineViewModel";

/*
 * The timeline past the show's end (docs/tempo/endless-counts.md): the END line, and how the
 * surface tells its owner how far to draw the counts.
 */

/** A dragged END line lands on a downbeat or page line within this many pixels */
const SNAP_PX = 6;

/**
 * The END line (rule 4): a thin, quiet line at the show's end, the last page's flag. It isn't a
 * wall: placing, selecting, looping and playing go on across it, so only its own grab strip,
 * below the page row, takes a press. Dragging it changes the last page's length, landing on whole
 * counts (and on a downbeat or page line when near one); `onMove` gets the new beat on release.
 * The page flag's grip in the ruler still moves the flag and the moves on it (UI-16); this one
 * leaves the moves where they are. Beats are view beats.
 */
export const TimelineShowEnd = memo(function TimelineShowEnd({
    beat,
    minBeat,
    axis,
    top,
    height,
    snapBeats,
    onMove,
}: {
    beat: number;
    /** The earliest the end can go: one count after the last page's start */
    minBeat: number;
    axis: TimelineXAxis;
    /** Where the line starts: under the page row, whose flag grips it leaves alone */
    top: number;
    height: number;
    snapBeats: readonly number[];
    /** Without it (while playing), the line is drawn but can't be dragged */
    onMove?: (beat: number) => void;
}) {
    const [dragBeat, setDragBeat] = useState<number | null>(null);
    const drag = useRef<{ pointerId: number; left: number } | null>(null);
    useEffect(() => {
        if (!onMove) setDragBeat(null);
    }, [onMove]);
    const shown = dragBeat ?? beat;
    const x = axis.x(shown);
    const beatAtClient = (clientX: number) => {
        const left = drag.current?.left ?? 0;
        const px = clientX - left;
        const near = snapBeats.find(
            (b) => b >= minBeat && Math.abs(axis.x(b) - px) <= SNAP_PX,
        );
        return near ?? Math.max(minBeat, Math.round(axis.beatAt(px)));
    };
    return (
        <>
            <div
                data-testid="timeline-show-end"
                aria-hidden="true"
                className="bg-text pointer-events-none absolute z-30 w-px opacity-35"
                style={{ left: x, top, height: Math.max(0, height - top) }}
            />
            <span
                aria-hidden="true"
                className="text-text pointer-events-none absolute z-30 pl-3 text-[9px] leading-none font-medium tracking-wide opacity-50"
                style={{ left: x, top: top + 3 }}
            >
                END
            </span>
            {onMove && (
                <button
                    type="button"
                    data-testid="timeline-show-end-grip"
                    data-timeline-interactive="true"
                    aria-label="End of the show. Drag to change the last page's length"
                    title="End of the show: drag to change the last page's length. Exports end here."
                    className="pointer-events-auto absolute z-30 w-12 -translate-x-1/2 cursor-ew-resize! touch-none border-0 bg-transparent p-0 outline-hidden"
                    style={{ left: x, top, height: Math.max(0, height - top) }}
                    onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.stopPropagation();
                        event.preventDefault();
                        const surface =
                            event.currentTarget.parentElement?.getBoundingClientRect();
                        drag.current = {
                            pointerId: event.pointerId,
                            left: surface?.left ?? 0,
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                        setDragBeat(beat);
                    }}
                    onPointerMove={(event) => {
                        if (drag.current?.pointerId !== event.pointerId) return;
                        setDragBeat(beatAtClient(event.clientX));
                    }}
                    onPointerUp={(event) => {
                        if (drag.current?.pointerId !== event.pointerId) return;
                        const to = beatAtClient(event.clientX);
                        drag.current = null;
                        setDragBeat(null);
                        if (to !== beat) onMove(to);
                    }}
                    onPointerCancel={() => {
                        drag.current = null;
                        setDragBeat(null);
                    }}
                    onLostPointerCapture={() => {
                        drag.current = null;
                        setDragBeat(null);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Escape" && drag.current) {
                            drag.current = null;
                            setDragBeat(null);
                        }
                    }}
                />
            )}
        </>
    );
});

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
