import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { T } from "@tolgee/react";
import type Page from "@/global/classes/Page";
import type Beat from "@/global/classes/Beat";
import { useIsPlaying } from "@/context/IsPlayingContext";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { beatAtTime, timeAtBeat } from "@/timeline/timeMap";
import { pageFlags } from "@/timeline/timelinePlayhead";
import { jumpTimelinePlayback } from "@/timeline/timelineTransport";
import { getLivePlaybackPosition } from "../audio/AudioPlayer";

/**
 * Basic mode's page bar additions (UI-19, docs/timeline/research/basic-mode): the page-mode bar's
 * layout, driven by the timeline playhead. The page boxes (`PageTimeline`) put the playhead on a
 * page's flag; this strip under them puts it on any count (the free playhead), and the playhead
 * line runs across the boxes, the strip and the waveform.
 *
 * Positions follow the page-mode bar's own geometry: a page box is `duration × pixelsPerSecond`
 * wide, so x is linear in show time from the second page box's left edge. That edge is measured
 * from the DOM, so borders and the label column don't need to be known here.
 */

/** Where show time `seconds` is, in px from `container`'s left edge; `null` before layout */
export type TimeToX = (seconds: number) => number;

export interface BasicTimeAxis {
    /** The x of `t0`, in px from the container's left edge (scrolled content) */
    readonly x0: number;
    /** The start time of the first page box after home, in seconds */
    readonly t0: number;
}

/**
 * Measures the page bar's time axis relative to `containerRef`: the left edge of the first page
 * box after home is that page's start time. Re-measured after every render (pages, zoom, resize
 * drags all re-render the bar); state changes only when the axis moves. `null` with no page box.
 */
export function useBasicTimeAxis(
    containerRef: React.RefObject<HTMLElement | null>,
    pages: readonly Page[],
): BasicTimeAxis | null {
    const [axis, setAxis] = useState<BasicTimeAxis | null>(null);
    useLayoutEffect(() => {
        const container = containerRef.current;
        const first = pages[1];
        const element = first
            ? container?.querySelector(`[timeline-page-id="${first.id}"]`)
            : null;
        const next =
            container && first && element instanceof HTMLElement
                ? {
                      x0:
                          element.getBoundingClientRect().left -
                          container.getBoundingClientRect().left,
                      t0: first.timestamp,
                  }
                : null;
        setAxis((prev) =>
            prev === next ||
            (prev && next && prev.x0 === next.x0 && prev.t0 === next.t0)
                ? prev
                : next,
        );
    });
    return axis;
}

const axisX = (
    axis: BasicTimeAxis | null,
    seconds: number,
    pixelsPerSecond: number,
) => (axis ? axis.x0 + (seconds - axis.t0) * pixelsPerSecond : null);

/**
 * The playhead line over the whole bar (boxes, counts strip and waveform). Paused, it sits on the
 * displayed beat; playing, it follows the live audio position every frame and keeps itself in view.
 * Neither re-renders React: it writes the element's transform.
 */
export function BasicPlayhead({
    scrollRef,
    axis,
    beats,
    pixelsPerSecond,
}: {
    scrollRef: React.RefObject<HTMLElement | null>;
    axis: BasicTimeAxis | null;
    beats: readonly Beat[];
    pixelsPerSecond: number;
}) {
    const lineRef = useRef<HTMLDivElement>(null);
    const { isPlaying } = useIsPlaying()!;
    const place = useCallback(
        (seconds: number, follow: boolean) => {
            const line = lineRef.current;
            const x = axisX(axis, seconds, pixelsPerSecond);
            if (!line) return;
            line.style.visibility = x === null ? "hidden" : "visible";
            if (x === null) return;
            line.style.transform = `translateX(${x}px)`;
            const scroller = scrollRef.current;
            if (!follow || !scroller) return;
            const view = scroller.clientWidth;
            if (
                x < scroller.scrollLeft + 24 ||
                x > scroller.scrollLeft + view - 24
            )
                scroller.scrollLeft = Math.max(0, x - view / 3);
        },
        [axis, pixelsPerSecond, scrollRef],
    );
    // Paused: the displayed beat, without re-rendering on every scrubbed beat
    useLayoutEffect(() => {
        if (isPlaying) return;
        const at = (beat: number) => place(timeAtBeat(beats, beat), false);
        at(displayedBeat(useTimelineSelectionStore.getState()));
        return useTimelineSelectionStore.subscribe((s) => at(displayedBeat(s)));
    });
    // Playing: the live position, every frame
    useEffect(() => {
        if (!isPlaying) return;
        let frame = 0;
        const update = () => {
            place(getLivePlaybackPosition(), true);
            frame = requestAnimationFrame(update);
        };
        update();
        return () => cancelAnimationFrame(frame);
    }, [isPlaying, place]);
    return (
        <div
            ref={lineRef}
            aria-hidden
            data-testid="basic-playhead"
            className="bg-accent pointer-events-none absolute top-0 bottom-0 left-0 z-30 w-[2px] -translate-x-1/2"
            style={{ visibility: "hidden" }}
        />
    );
}

/** A tick on the counts strip: a beat, a page's flag, or a mid-page position of the selection */
export interface CountsStripMark {
    readonly beat: number;
    readonly kind: "point";
}

/**
 * The counts strip under the page boxes: a tick per count, a taller one per page flag, and an
 * accent tick where a selected marcher has a mid-page position. Clicking or dragging on it puts the
 * playhead on the nearest count (UI-19 free playhead). While playing, it jumps playback there.
 * Right-clicking a mid-page tick calls `onPointMenu` with its beat.
 */
export function BasicCountsStrip({
    axis,
    beats,
    pages,
    pixelsPerSecond,
    width,
    points,
    onPointContextMenu,
}: {
    axis: BasicTimeAxis | null;
    beats: readonly Beat[];
    pages: readonly Page[];
    pixelsPerSecond: number;
    /** The strip's width in px: the page boxes' */
    width: number;
    /** Beats where a selected marcher has a mid-page position */
    points: readonly number[];
    onPointContextMenu?: (beat: number, event: React.MouseEvent) => void;
}) {
    const stripRef = useRef<HTMLDivElement>(null);
    const { isPlaying } = useIsPlaying()!;
    // The strip's left edge on the axis' scale, measured after layout
    const [stripLeft, setStripLeft] = useState(0);
    useLayoutEffect(() => {
        const strip = stripRef.current;
        const container = strip?.offsetParent;
        if (!strip || !(container instanceof HTMLElement)) return;
        const left =
            strip.getBoundingClientRect().left -
            container.getBoundingClientRect().left;
        setStripLeft((prev) => (prev === left ? prev : left));
    });
    const beatAtClientX = (clientX: number): number | null => {
        const strip = stripRef.current;
        if (!strip || !axis || beats.length === 0) return null;
        const x = clientX - strip.getBoundingClientRect().left + stripLeft;
        const seconds = axis.t0 + (x - axis.x0) / pixelsPerSecond;
        const beat = Math.round(beatAtTime(beats, Math.max(0, seconds)));
        return Math.min(Math.max(beat, 0), beats.length);
    };
    const dragging = useRef(false);
    const seekTo = (beat: number) => {
        if (isPlaying) jumpTimelinePlayback(beats, beat);
        else useTimelineSelectionStore.getState().seek(beat);
    };

    const flags = useMemo(
        () => new Set(pageFlags(pages).map((f) => f.flag)),
        [pages],
    );
    const xOf = (beat: number) => {
        const x = axisX(axis, timeAtBeat(beats, beat), pixelsPerSecond);
        return x === null ? null : x - stripLeft;
    };
    let countPath = "";
    let flagPath = "";
    for (let b = 1; b <= beats.length; b++) {
        const x = xOf(b);
        if (x === null) break;
        if (flags.has(b)) flagPath += `M${x} 0V16`;
        else countPath += `M${x} 10V16`;
    }
    const pointXs = points.flatMap((beat) => {
        const x = xOf(beat);
        return x === null ? [] : [{ beat, x }];
    });

    return (
        <div
            ref={stripRef}
            data-testid="basic-counts-strip"
            role="slider"
            aria-label="Playhead count"
            aria-valuemin={0}
            aria-valuemax={beats.length}
            aria-valuenow={useTimelineSelectionStore(displayedBeat)}
            tabIndex={-1}
            className="relative h-16 cursor-col-resize touch-none select-none"
            style={{ width }}
            onPointerDown={(e) => {
                if (e.button !== 0) return;
                const beat = beatAtClientX(e.clientX);
                if (beat === null) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                dragging.current = true;
                if (!isPlaying)
                    useTimelineSelectionStore.getState().beginScrub();
                seekTo(beat);
            }}
            onPointerMove={(e) => {
                if (!dragging.current) return;
                const beat = beatAtClientX(e.clientX);
                if (beat !== null && !isPlaying) seekTo(beat);
            }}
            onPointerUp={(e) => {
                if (!dragging.current) return;
                dragging.current = false;
                e.currentTarget.releasePointerCapture(e.pointerId);
                if (!isPlaying) useTimelineSelectionStore.getState().endScrub();
            }}
        >
            <svg
                className="pointer-events-none absolute inset-0 overflow-visible"
                width={width}
                height={16}
                aria-hidden
            >
                <path d={countPath} className="stroke-stroke" strokeWidth={1} />
                <path
                    d={flagPath}
                    className="stroke-text-subtitle"
                    strokeWidth={1}
                />
            </svg>
            {pointXs.map(({ beat, x }) => (
                <button
                    key={beat}
                    type="button"
                    data-testid="basic-point-tick"
                    aria-label={`Position at count ${beat}`}
                    className="bg-accent absolute top-0 h-16 w-[3px] -translate-x-1/2 cursor-context-menu rounded-full"
                    style={{ left: x }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => seekTo(beat)}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        onPointContextMenu?.(beat, e);
                    }}
                />
            ))}
        </div>
    );
}

/** The "Counts" label for the strip's row, matching the page bar's other row labels */
export function BasicCountsLabel() {
    return (
        <p className="text-sub w-[4rem]">
            <T keyName="timeline.basic.counts" defaultValue="Counts" />
        </p>
    );
}
