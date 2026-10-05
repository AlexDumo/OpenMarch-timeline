import {
    ArrowsOutLineHorizontalIcon,
    PauseIcon,
    PushPinIcon,
    StopIcon,
    PlayIcon,
    SkipBackIcon,
    SkipForwardIcon,
    WarningIcon,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { START_INK } from "./startFlagInk";
import {
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    type RefObject,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { createPortal } from "react-dom";
import {
    beatToX,
    clamp,
    clientXToBeat,
    filterMarkersByMinimumSpacing,
    getFrameContext,
    getPageCountAt,
    getPageRange,
    getSelectionRange,
    getPlayheadLabel,
    getTrackRange,
    sameRange,
    isPageSnapDisabled,
    snapBoundary,
    snapRangeOffset,
} from "./TimelineGeometry";
import { timelineRangeTargetProps } from "./TimelineRangeMenu";
import type {
    BeatPosition,
    TimelineBeatRange,
    TimelineMeasureMarker,
    TimelineNavigation,
    TimelinePageMarker,
    TimelineRangeChange,
    TimelineSelection,
    TimelineTrack,
    TimelineTrackId,
    TimelineViewModel,
} from "./TimelineViewModel";

/** Low enough that Fit shows a long show whole (UI-12): 500 beats fit in 500px */
export const TIMELINE_MIN_PX_PER_BEAT = 1;
export const TIMELINE_MAX_PX_PER_BEAT = 64;
export const TIMELINE_INITIAL_PAGE_WIDTH = 40;

export interface TimelineSelectionInteraction {
    readonly range: TimelineBeatRange;
    readonly activeHandle: "start" | "end" | null;
    readonly dragging: boolean;
}

const TransportButton = ({
    label,
    children,
    onClick,
    pressed,
}: {
    label: string;
    children: ReactNode;
    onClick?: (event: ReactMouseEvent) => void;
    pressed?: boolean;
}) => (
    <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        title={label}
        onClick={onClick}
        disabled={!onClick}
        className={clsx(
            "focus-visible:ring-accent rounded-4 enabled:hover:text-accent enabled:hover:bg-fg-2 flex size-24 items-center justify-center outline-hidden transition-[color,background-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-30",
            pressed ? "text-accent" : "text-text",
        )}
    >
        {children}
    </button>
);

/**
 * The transport (UI-12): Previous, Play, Stop, Next, then the caller's accessories (From start
 * with Loop, Sound), under one readout line of the clock, the page and count, the measure, and
 * the view controls (Fit, then the caller's compact and fullscreen toggles). Shift+click on
 * Previous or Next goes to the first or last page (as Shift+Q/E do). Compact puts it on one line.
 * Page navigation is ignored while playing, so its buttons are disabled then.
 */
export function TimelineTransport({
    model,
    clock,
    positionBeat,
    isPlaying,
    onPlayingChange,
    onStop,
    onNavigate,
    onFit,
    fitted = false,
    accessories,
    viewControls,
    compact = false,
}: {
    model: TimelineViewModel;
    /** The playback clock; the app passes its audio clock */
    clock?: ReactNode;
    positionBeat: BeatPosition;
    isPlaying: boolean;
    onPlayingChange?: (isPlaying: boolean) => void;
    /** **Stop** (UI-10); without it, there is no Stop button */
    onStop?: () => void;
    onNavigate?: (direction: TimelineNavigation) => void;
    /** Fit the show in view, or back to the zoom from before fitting */
    onFit?: () => void;
    /** The show is fitted, so Fit goes back */
    fitted?: boolean;
    /** Controls after Next, such as From start, Loop and Sound */
    accessories?: ReactNode;
    /** Controls at the end of the readout, such as compact and fullscreen */
    viewControls?: ReactNode;
    compact?: boolean;
}) {
    const frame = getFrameContext(model, positionBeat);
    const at = getPageCountAt(model, positionBeat);
    const navigate =
        onNavigate && !isPlaying
            ? (shift: TimelineNavigation, plain: TimelineNavigation) =>
                  (event: ReactMouseEvent) =>
                      onNavigate(event.shiftKey ? shift : plain)
            : undefined;
    const readout = (
        <span
            data-testid="timeline-readout"
            className="text-text flex items-baseline gap-6 font-mono text-[11px] leading-none whitespace-nowrap"
            title={`Page ${at.pageLabel}, count ${at.count} (measure ${frame.measureAndCount.slice(1)})`}
        >
            <span>
                Pg {at.pageLabel} · ct {at.count}
            </span>
            <span className="text-text-subtitle">{frame.measureAndCount}</span>
        </span>
    );
    const view = (
        <div className="ml-auto flex items-center gap-4">
            {onFit && (
                <TransportButton
                    label={
                        fitted
                            ? "Back to the previous zoom (Ctrl+scroll zooms)"
                            : "Fit the show (Ctrl+scroll zooms)"
                    }
                    pressed={fitted}
                    onClick={onFit}
                >
                    <ArrowsOutLineHorizontalIcon size={16} />
                </TransportButton>
            )}
            {viewControls}
        </div>
    );
    const buttons = (
        <div className="flex items-center gap-6">
            <TransportButton
                label="Previous page (Shift: first page)"
                onClick={navigate?.("first-page", "previous-page")}
            >
                <SkipBackIcon size={18} />
            </TransportButton>
            <TransportButton
                label={isPlaying ? "Pause" : "Play"}
                pressed={isPlaying}
                onClick={
                    onPlayingChange
                        ? () => onPlayingChange(!isPlaying)
                        : undefined
                }
            >
                {isPlaying ? (
                    <PauseIcon size={20} weight="fill" />
                ) : (
                    <PlayIcon size={20} weight="fill" />
                )}
            </TransportButton>
            {onStop && (
                <TransportButton label="Stop" onClick={onStop}>
                    <StopIcon size={18} />
                </TransportButton>
            )}
            <TransportButton
                label="Next page (Shift: last page)"
                onClick={navigate?.("last-page", "next-page")}
            >
                <SkipForwardIcon size={18} />
            </TransportButton>
            {accessories != null && (
                <div className="border-stroke ml-2 flex items-center gap-6 border-l pl-8">
                    {accessories}
                </div>
            )}
        </div>
    );
    return (
        <aside
            data-testid="timeline-transport"
            className={clsx(
                "border-stroke bg-fg-1 rounded-6 flex shrink-0 border px-12",
                compact
                    ? "items-center gap-12 py-4"
                    : "w-[300px] flex-col justify-center gap-8 py-8",
            )}
        >
            {compact ? (
                <>
                    {buttons}
                    {readout}
                    {view}
                </>
            ) : (
                <>
                    <div className="text-text-subtitle flex items-center gap-8">
                        {clock}
                        {readout}
                        {view}
                    </div>
                    {buttons}
                </>
            )}
        </aside>
    );
}

export const TimelineShell = ({
    transport,
    children,
    viewportRef,
    className,
}: {
    transport?: ReactNode;
    children: ReactNode;
    viewportRef: RefObject<HTMLDivElement | null>;
    className?: string;
}) => (
    <div className={clsx("flex min-w-0 gap-8 font-sans", className)}>
        {transport}
        <section className="border-stroke bg-fg-1 text-text rounded-6 min-w-0 flex-1 overflow-visible border p-6">
            <div
                ref={viewportRef}
                data-testid="timeline-viewport"
                className="min-w-0 overflow-x-auto overflow-y-hidden"
            >
                {children}
            </div>
        </section>
    </div>
);

/**
 * Scrubbing by dragging along the page boxes (UI-12). A press that moves past the drag threshold
 * scrubs the playhead with the pointer and swallows the click that follows, so the box under the
 * release isn't selected; a press that doesn't move stays a click.
 */
const useRulerScrub = (
    onSeek: ((beat: BeatPosition) => void) | undefined,
    beatCount: number,
    pixelsPerBeat: number,
) => {
    const drag = useRef<{
        pointerId: number;
        startClientX: number;
        surfaceLeft: number;
        scrubbing: boolean;
    } | null>(null);
    const swallowClick = useRef(false);
    const beatAt = (clientX: number, surfaceLeft: number) =>
        Math.round(
            clamp((clientX - surfaceLeft) / pixelsPerBeat, 0, beatCount),
        );
    return {
        consumeClick: () => {
            const swallow = swallowClick.current;
            swallowClick.current = false;
            return swallow;
        },
        handlers: {
            onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
                swallowClick.current = false;
                // A range-modifier press draws a range: the surface handles it, and the click it
                // ends with mustn't select the box
                if (event.button === 0 && isRangeModifier(event)) {
                    swallowClick.current = true;
                    return;
                }
                if (!onSeek || event.button !== 0 || event.ctrlKey) return;
                const surface = event.currentTarget.closest(
                    '[data-testid="timeline-pointer-surface"]',
                );
                if (!surface) return;
                drag.current = {
                    pointerId: event.pointerId,
                    startClientX: event.clientX,
                    surfaceLeft: surface.getBoundingClientRect().left,
                    scrubbing: false,
                };
                event.currentTarget.setPointerCapture?.(event.pointerId);
            },
            onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
                const current = drag.current;
                if (!current || current.pointerId !== event.pointerId) return;
                if (
                    !current.scrubbing &&
                    Math.abs(event.clientX - current.startClientX) <
                        TIMELINE_RANGE_DRAG_PX
                )
                    return;
                current.scrubbing = true;
                onSeek?.(beatAt(event.clientX, current.surfaceLeft));
            },
            onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
                const current = drag.current;
                if (!current || current.pointerId !== event.pointerId) return;
                drag.current = null;
                event.currentTarget.releasePointerCapture?.(event.pointerId);
                swallowClick.current = current.scrubbing;
            },
            onPointerCancel: () => {
                drag.current = null;
            },
        },
    };
};

export const TimelineRuler = ({
    pages,
    measures,
    beatCount,
    pixelsPerBeat,
    selection,
    onSelectionChange,
    onSeek,
    initialPageWidth,
    showMeasures = true,
}: {
    pages: readonly TimelinePageMarker[];
    measures: readonly TimelineMeasureMarker[];
    beatCount: number;
    pixelsPerBeat: number;
    selection?: TimelineSelection;
    onSelectionChange?: (selection: TimelineSelection) => void;
    /** Dragging along the page boxes scrubs (UI-12); a click still selects the box */
    onSeek?: (beat: BeatPosition) => void;
    initialPageWidth: number;
    /** The measure numbers under the boxes; compact leaves them out */
    showMeasures?: boolean;
}) => {
    const visibleMeasures = filterMarkersByMinimumSpacing(
        measures.filter((measure) => !measure.rehearsalMark?.trim()),
        pixelsPerBeat,
    );
    const scrub = useRulerScrub(onSeek, beatCount, pixelsPerBeat);
    const initialPage = pages.find((page) => page.isInitial);
    const orderedPages = pages
        .filter((page) => !page.isInitial)
        .sort((a, b) => a.atBeat - b.atBeat);
    // UI-9: the initial box is home; a page box is its range, previous flag to its own flag
    const selectedRange = getSelectionRange(selection);
    const pageRange = (page: TimelinePageMarker) =>
        getPageRange({ pages: orderedPages, pageId: page.id, beatCount });
    const isSelected = (page: TimelinePageMarker) =>
        page.isInitial
            ? selection?.kind === "home"
            : sameRange(pageRange(page), selectedRange);
    const selectPage = (page: TimelinePageMarker) => {
        if (page.isInitial) {
            onSelectionChange?.({ kind: "home" });
            return;
        }
        const range = pageRange(page);
        if (range) onSelectionChange?.({ kind: "range", range });
    };
    return (
        <>
            <div
                data-testid="timeline-page-ruler"
                className="border-stroke bg-fg-2 rounded-6 absolute top-0 h-28 overflow-hidden border font-mono"
                style={{
                    left: -initialPageWidth,
                    width: beatCount * pixelsPerBeat + initialPageWidth,
                }}
            >
                {initialPage && (
                    <button
                        type="button"
                        data-timeline-interactive="true"
                        data-testid="timeline-initial-page"
                        aria-label={`Page ${initialPage.label}`}
                        aria-pressed={isSelected(initialPage)}
                        {...scrub.handlers}
                        onClick={() => {
                            if (!scrub.consumeClick()) selectPage(initialPage);
                        }}
                        className="border-stroke text-text focus-visible:ring-accent absolute top-0 left-0 flex h-full items-center justify-center border-r text-[11px] outline-hidden focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset aria-pressed:z-10 aria-pressed:ring-1 aria-pressed:ring-[var(--color-accent)] aria-pressed:ring-inset"
                        style={{ width: initialPageWidth }}
                    >
                        {initialPage.label}
                    </button>
                )}
                {orderedPages.map((page) => {
                    const range = getPageRange({
                        pages: orderedPages,
                        pageId: page.id,
                        beatCount,
                    });
                    if (!range) return null;
                    const selected = isSelected(page);
                    return (
                        <button
                            key={page.id}
                            type="button"
                            data-timeline-interactive="true"
                            {...timelineRangeTargetProps(
                                range,
                                undefined,
                                page.id,
                            )}
                            aria-label={`Page ${page.label}`}
                            aria-pressed={selected}
                            {...scrub.handlers}
                            onClick={(event) => {
                                if (scrub.consumeClick()) return;
                                // macOS ctrl+click opens the context menu (UI-9: no selection change)
                                if (!event.ctrlKey) selectPage(page);
                            }}
                            className="border-stroke text-text focus-visible:ring-accent absolute top-0 flex h-full items-center justify-end border-r px-8 text-[11px] outline-hidden focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset aria-pressed:z-10 aria-pressed:ring-1 aria-pressed:ring-[var(--color-accent)] aria-pressed:ring-inset"
                            style={{
                                left:
                                    initialPageWidth +
                                    beatToX(
                                        range.startBeatIndex,
                                        pixelsPerBeat,
                                    ),
                                width:
                                    (range.endBeatIndex -
                                        range.startBeatIndex) *
                                    pixelsPerBeat,
                            }}
                        >
                            {page.label}
                        </button>
                    );
                })}
            </div>
            {showMeasures && (
                // UI-12: measure numbers without the "M"; a measure with a rehearsal mark shows the
                // mark instead (TimelineRehearsalMarkers)
                <div className="pointer-events-none absolute inset-x-0 top-[31px] h-16 font-mono">
                    {visibleMeasures.map((measure) => (
                        <span
                            key={measure.id}
                            className="text-text-subtitle absolute top-2 -translate-x-1/2 text-[9px] whitespace-nowrap"
                            style={{
                                left: beatToX(measure.atBeat, pixelsPerBeat),
                            }}
                        >
                            {measure.label.replace(/^m/i, "")}
                        </span>
                    ))}
                </div>
            )}
        </>
    );
};

export const TimelinePageLines = ({
    pages,
    pixelsPerBeat,
    height,
}: {
    pages: readonly TimelinePageMarker[];
    pixelsPerBeat: number;
    height: number;
}) => (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {pages
            .filter((page) => !page.isInitial)
            .map((page) => (
                <span
                    key={page.id}
                    className="bg-text absolute top-28 w-px opacity-[0.24]"
                    style={{
                        left: Math.round(beatToX(page.atBeat, pixelsPerBeat)),
                        height: Math.max(0, height - 28),
                    }}
                />
            ))}
    </div>
);

export const TimelineTrackClip = ({
    track,
    pixelsPerBeat,
    top,
    height,
    selected,
    linked = false,
    onSelect,
    onRangeCommit,
    beatCount,
    snapBeats = [],
    micro = false,
    barHeight,
}: {
    track: TimelineTrack;
    pixelsPerBeat: number;
    top: number;
    height: number;
    selected: boolean;
    /** Another clip of the same spec timeline is selected; this one moves with it */
    linked?: boolean;
    onSelect?: (trackId: TimelineTrackId) => void;
    onRangeCommit?: (change: TimelineRangeChange) => void;
    beatCount?: number;
    /** Page lines the clip's edges snap to while it moves (ui.md UI-2); Alt turns snapping off */
    snapBeats?: readonly number[];
    micro?: boolean;
    /**
     * The drawn bar's height, centered in `height` (UI-12 compact: a thin bar in a taller hit
     * area, so it can still be clicked, dragged and double-clicked). Without it the bar fills it.
     */
    barHeight?: number;
}) => {
    const range = getTrackRange(track);
    const [previewOffset, setPreviewOffset] = useState(0);
    // A drag ends with a click on the clip; that click mustn't also select it
    const draggedRef = useRef(false);
    const dragRef = useRef<{
        pointerId: number;
        startClientX: number;
        offset: number;
    } | null>(null);

    useEffect(() => {
        dragRef.current = null;
        setPreviewOffset(0);
    }, [range?.endBeatIndex, range?.startBeatIndex]);

    if (!range) return null;
    const left = (range.startBeatIndex + previewOffset) * pixelsPerBeat;
    const width = (range.endBeatIndex - range.startBeatIndex) * pixelsPerBeat;
    const canMove = onRangeCommit != null && beatCount != null;
    const getOffset = (
        clientX: number,
        startClientX: number,
        snapDisabled: boolean,
    ) => {
        const requested = snapRangeOffset({
            range,
            offset: (clientX - startClientX) / pixelsPerBeat,
            snapBeats: snapDisabled ? [] : snapBeats,
            pixelsPerBeat,
        });
        const minimum = -range.startBeatIndex;
        const maximum = Math.max(minimum, beatCount! - range.endBeatIndex);
        return clamp(requested, minimum, maximum);
    };

    return (
        <button
            type="button"
            data-timeline-interactive="true"
            {...timelineRangeTargetProps(range, track.id)}
            aria-label={`${track.label} timeline, beats ${range.startBeatIndex + 1} through ${range.endBeatIndex}${
                track.diagnostics
                    ? `, ${track.diagnostics.messages.length} ${track.diagnostics.messages.length === 1 ? "diagnostic" : "diagnostics"}`
                    : ""
            }`}
            aria-pressed={selected}
            data-linked={linked || undefined}
            title={
                track.diagnostics
                    ? [track.label, ...track.diagnostics.messages].join("\n")
                    : track.label
            }
            onClick={(event) => {
                const dragged = draggedRef.current;
                draggedRef.current = false;
                // macOS ctrl+click opens the context menu (UI-9: no selection change)
                if (!dragged && !event.ctrlKey) onSelect?.(track.id);
            }}
            onPointerDown={(event) => {
                draggedRef.current = false;
                if (!canMove || event.button !== 0 || event.ctrlKey) return;
                event.stopPropagation();
                dragRef.current = {
                    pointerId: event.pointerId,
                    startClientX: event.clientX,
                    offset: 0,
                };
                event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                const offset = getOffset(
                    event.clientX,
                    drag.startClientX,
                    isPageSnapDisabled(event),
                );
                drag.offset = offset;
                setPreviewOffset(offset);
            }}
            onPointerUp={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                dragRef.current = null;
                event.currentTarget.releasePointerCapture?.(event.pointerId);
                // Recompute with the release's modifier state, as the selection flags do
                const offset = getOffset(
                    event.clientX,
                    drag.startClientX,
                    isPageSnapDisabled(event),
                );
                setPreviewOffset(0);
                if (offset === 0) return;
                draggedRef.current = true;
                onRangeCommit?.({
                    timelineId: track.id,
                    startBeatIndex: range.startBeatIndex + offset,
                    endBeatIndex: range.endBeatIndex + offset,
                });
            }}
            onPointerCancel={() => {
                dragRef.current = null;
                setPreviewOffset(0);
            }}
            className={clsx(
                "focus-visible:ring-accent absolute overflow-visible outline-hidden transition-[filter,box-shadow] duration-150 focus-visible:ring-2 enabled:hover:brightness-110",
                canMove && "cursor-grab touch-none active:cursor-grabbing",
                micro ? "rounded-full" : "rounded-4",
            )}
            style={{
                left,
                top,
                width,
                height,
                boxShadow: selected
                    ? "0 0 0 2px var(--color-accent)"
                    : linked
                      ? "0 0 0 1px var(--color-accent)"
                      : undefined,
            }}
        >
            {track.activitySpans.map((span) => {
                const isFirst = span.startBeatIndex === range.startBeatIndex;
                const isLast = span.endBeatIndex === range.endBeatIndex;

                return (
                    <span
                        key={`${span.startBeatIndex}-${span.endBeatIndex}`}
                        data-activity={span.active ? "active" : "inactive"}
                        className={clsx(
                            "absolute overflow-hidden",
                            barHeight === undefined && "inset-y-0",
                            isFirst &&
                                (micro ? "rounded-l-full" : "rounded-l-4"),
                            isLast &&
                                (micro ? "rounded-r-full" : "rounded-r-4"),
                            span.active
                                ? "border border-transparent"
                                : "border border-dashed",
                        )}
                        style={{
                            ...(barHeight !== undefined && {
                                top: (height - barHeight) / 2,
                                height: barHeight,
                            }),
                            left:
                                (span.startBeatIndex - range.startBeatIndex) *
                                pixelsPerBeat,
                            width:
                                (span.endBeatIndex - span.startBeatIndex) *
                                pixelsPerBeat,
                            backgroundColor: span.active
                                ? `color-mix(in srgb, ${track.color} 82%, var(--color-bg-1))`
                                : `color-mix(in srgb, ${track.color} 12%, transparent)`,
                            borderColor: span.active
                                ? "transparent"
                                : track.color,
                        }}
                    />
                );
            })}
            {track.diagnostics && (
                <span
                    data-testid="timeline-track-diagnostics"
                    data-level={track.diagnostics.level}
                    className={clsx(
                        "pointer-events-none absolute top-1/2 right-2 flex -translate-y-1/2 items-center",
                        track.diagnostics.level === "warning"
                            ? "text-yellow"
                            : "text-text-subtitle",
                    )}
                >
                    {micro ? (
                        <span className="block size-[5px] rounded-full bg-current" />
                    ) : (
                        <WarningIcon size={12} weight="fill" />
                    )}
                </span>
            )}
        </button>
    );
};

export const TimelineSelectionRange = ({
    range,
    startFlagBeatIndex,
    fromStart = false,
    onFromStartOff,
    startPinned = false,
    onUnpin,
    pinTop = 30,
    beatCount,
    pixelsPerBeat,
    height,
    snapBeats = [],
    onCommit,
    onInteractionChange,
}: {
    range: TimelineBeatRange;
    /** Where to draw the start flag when it isn't the range's start (UI-10, after Stop) */
    startFlagBeatIndex?: number;
    /**
     * **From start** is on (UI-11): the window is drawn in the start flag's color with a bar
     * across its top; clicking the bar turns it off (`onFromStartOff`). Off, the start flag is
     * dimmed, since Play doesn't go back to it.
     */
    fromStart?: boolean;
    onFromStartOff?: () => void;
    /**
     * The start flag is pinned (UI-10): it stays through navigation. UI-12 draws a pin beside its
     * stem, under the ruler, so a forgotten pin can be seen; clicking the pin unpins (`onUnpin`).
     */
    startPinned?: boolean;
    onUnpin?: () => void;
    /** Where the pin sits, below the ruler */
    pinTop?: number;
    beatCount: number;
    pixelsPerBeat: number;
    height: number;
    /** Page lines the dragged flag snaps to (ui.md UI-2); Alt turns snapping off */
    snapBeats?: readonly number[];
    onCommit?: (range: TimelineBeatRange) => void;
    onInteractionChange?: (
        interaction: TimelineSelectionInteraction | null,
    ) => void;
}) => {
    const [preview, setPreview] = useState(range);
    const previewRef = useRef(range);
    const dragRef = useRef<{
        kind: "start" | "end";
        pointerId: number;
        surface: HTMLElement;
        startClientX: number;
        /** The pointer has moved past the drag threshold: a drag, not a click */
        moved: boolean;
    } | null>(null);

    useEffect(() => {
        const next = {
            startBeatIndex: range.startBeatIndex,
            endBeatIndex: range.endBeatIndex,
        };
        dragRef.current = null;
        previewRef.current = next;
        setPreview(next);
    }, [range.endBeatIndex, range.startBeatIndex]);

    const updatePreview = useCallback(
        (
            kind: "start" | "end",
            clientX: number,
            surface: HTMLElement,
            snapDisabled: boolean,
            dragging = true,
        ) => {
            const bounds = surface.getBoundingClientRect();
            const requested = snapBoundary({
                beat: clamp(
                    (clientX - bounds.left) / pixelsPerBeat,
                    0,
                    beatCount,
                ),
                snapBeats: snapDisabled ? [] : snapBeats,
                pixelsPerBeat,
            });
            const current = previewRef.current;
            const next =
                kind === "start"
                    ? {
                          startBeatIndex: clamp(
                              requested,
                              0,
                              current.endBeatIndex - 1,
                          ),
                          endBeatIndex: current.endBeatIndex,
                      }
                    : {
                          startBeatIndex: current.startBeatIndex,
                          endBeatIndex: clamp(
                              requested,
                              current.startBeatIndex + 1,
                              beatCount,
                          ),
                      };
            previewRef.current = next;
            setPreview(next);
            onInteractionChange?.({
                range: next,
                activeHandle: dragging ? kind : null,
                dragging,
            });
            return next;
        },
        [beatCount, onInteractionChange, pixelsPerBeat, snapBeats],
    );

    const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (!drag.moved) {
            // A click: nothing changes
            dragRef.current = null;
            event.currentTarget.releasePointerCapture?.(event.pointerId);
            onInteractionChange?.(null);
            return;
        }
        const next = updatePreview(
            drag.kind,
            event.clientX,
            drag.surface,
            isPageSnapDisabled(event),
            false,
        );
        dragRef.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        if (
            next.startBeatIndex !== range.startBeatIndex ||
            next.endBeatIndex !== range.endBeatIndex
        ) {
            onCommit?.(next);
        }
    };

    const flagTitle = (kind: "start" | "end", beatIndex: number) =>
        kind === "start"
            ? "Start flag: dragged marchers leave from here. Drag to move it."
            : `Selection ${kind}: beat boundary ${beatIndex}`;
    const flagHandlers = (kind: "start" | "end", beatIndex: number) => ({
        disabled: !onCommit,
        onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
            if (!onCommit || event.button !== 0) return;
            event.stopPropagation();
            const surface = event.currentTarget.parentElement?.parentElement;
            if (!surface) return;
            // Nothing moves until the pointer does: after Stop the start flag is drawn on the
            // playhead, away from the fallback window's start, so a press must not jump it
            dragRef.current = {
                kind,
                pointerId: event.pointerId,
                surface,
                startClientX: event.clientX,
                moved: false,
            };
            event.currentTarget.setPointerCapture?.(event.pointerId);
        },
        onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            if (
                !drag.moved &&
                Math.abs(event.clientX - drag.startClientX) <
                    TIMELINE_RANGE_DRAG_PX
            )
                return;
            drag.moved = true;
            updatePreview(
                kind,
                event.clientX,
                drag.surface,
                isPageSnapDisabled(event),
            );
        },
        onPointerUp: finishDrag,
        onPointerCancel: () => {
            dragRef.current = null;
            previewRef.current = range;
            setPreview(range);
            onInteractionChange?.(null);
        },
        onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
            if (!onCommit) return;
            const delta =
                event.key === "ArrowLeft"
                    ? -1
                    : event.key === "ArrowRight"
                      ? 1
                      : 0;
            if (delta === 0) return;
            event.preventDefault();
            // The arrow moves the flag, not the selected marchers (the window's nudge keys)
            event.stopPropagation();
            // The start flag stays before the playhead (UI-10): after Stop it is drawn on the
            // playhead, so a step right has nowhere to go
            if (
                kind === "start" &&
                (beatIndex + delta >= range.endBeatIndex ||
                    beatIndex + delta < 0)
            )
                return;
            onCommit(
                kind === "start"
                    ? {
                          startBeatIndex: clamp(
                              beatIndex + delta,
                              0,
                              range.endBeatIndex - 1,
                          ),
                          endBeatIndex: range.endBeatIndex,
                      }
                    : {
                          startBeatIndex: range.startBeatIndex,
                          endBeatIndex: clamp(
                              beatIndex + delta,
                              range.startBeatIndex + 1,
                              beatCount,
                          ),
                      },
            );
        },
    });

    const flag = (kind: "start" | "end", beatIndex: number) => {
        const x = beatToX(beatIndex, pixelsPerBeat);
        if (kind === "end")
            return (
                <button
                    type="button"
                    data-timeline-interactive="true"
                    aria-label={`Selection ${kind}`}
                    title={flagTitle(kind, beatIndex)}
                    {...flagHandlers(kind, beatIndex)}
                    className="focus-visible:ring-accent pointer-events-auto absolute top-0 z-40 h-full w-12 -translate-x-1/2 touch-none border-0 bg-transparent p-0 outline-hidden focus-visible:ring-2 enabled:cursor-ew-resize disabled:cursor-default"
                    style={{ left: x, height }}
                >
                    <span className="bg-accent absolute inset-y-0 left-1/2 w-px" />
                    <span className="bg-accent absolute top-0 right-1/2 h-10 w-8 rounded-l-sm" />
                </button>
            );
        // UI-10, UI-11: the start flag, where movers leave from. No words: a line and a pennant,
        // hollow while From start is off and filled while it is on
        return (
            <>
                <button
                    type="button"
                    data-timeline-interactive="true"
                    aria-label={`Start flag, beat ${beatIndex}`}
                    title={flagTitle(kind, beatIndex)}
                    {...flagHandlers(kind, beatIndex)}
                    className="focus-visible:ring-accent pointer-events-auto absolute top-0 z-40 h-full w-12 -translate-x-1/2 touch-none border-0 bg-transparent p-0 outline-hidden focus-visible:ring-2 enabled:cursor-ew-resize disabled:cursor-default"
                    style={{ left: x, height }}
                >
                    <span
                        className={clsx(
                            "absolute inset-y-0 left-1/2",
                            START_INK.bg,
                            fromStart || startPinned ? "w-0.5" : "w-px",
                        )}
                    />
                </button>
                {startPinned && (
                    <button
                        type="button"
                        data-testid="timeline-start-pin"
                        data-timeline-interactive="true"
                        aria-label="Start flag pinned. Click to unpin"
                        title="Pinned: the start flag stays here when you move to other pages. Click to unpin, so it follows the page again."
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={onUnpin}
                        disabled={!onUnpin}
                        className={clsx(
                            "bg-bg-1 rounded-4 pointer-events-auto absolute z-[55] flex size-14 items-center justify-center border p-0 shadow-sm enabled:cursor-pointer",
                            START_INK.text,
                            START_INK.border,
                        )}
                        style={{ left: x + 3, top: pinTop }}
                    >
                        <PushPinIcon size={10} weight="fill" />
                    </button>
                )}
                {/* The pennant is its own handle above the playhead's (z-50): after Stop the flag
                    is drawn on the playhead, and this is the part of it that can be grabbed */}
                <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden="true"
                    data-testid="timeline-start-pennant"
                    data-timeline-interactive="true"
                    title={flagTitle(kind, beatIndex)}
                    {...flagHandlers(kind, beatIndex)}
                    onKeyDown={undefined}
                    className="pointer-events-auto absolute top-0 z-[55] h-14 w-14 touch-none border-0 bg-transparent p-0 outline-hidden enabled:cursor-ew-resize disabled:cursor-default"
                    style={{ left: x - 1 }}
                >
                    <svg
                        width="11"
                        height="9"
                        viewBox="0 0 11 9"
                        aria-hidden="true"
                        className={clsx(
                            "absolute top-0 left-0",
                            START_INK.text,
                        )}
                    >
                        <path
                            d="M1 0.75 L10 4.5 L1 8.25 Z"
                            fill={
                                fromStart ? "currentColor" : "var(--color-bg-1)"
                            }
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinejoin="round"
                        />
                    </svg>
                </button>
            </>
        );
    };

    const startX = beatToX(preview.startBeatIndex, pixelsPerBeat);
    const endX = beatToX(preview.endBeatIndex, pixelsPerBeat);
    return (
        // No z-index here: one would make a stacking context, and the start pennant must rise
        // above the playhead (z-50), which is outside it. Each child sets its own instead.
        <div
            data-testid="timeline-selection-range"
            className="pointer-events-none absolute inset-0"
        >
            <span
                aria-hidden="true"
                className={clsx(
                    "absolute top-0 z-30",
                    fromStart ? "bg-yellow/12" : "bg-accent/8",
                )}
                style={{ left: startX, width: endX - startX, height }}
            />
            {fromStart && (
                // UI-11: a thin bar along the ruler's top edge, clear of the page numbers, inside a
                // taller click target (at least 24px wide) that turns From start off
                <button
                    type="button"
                    data-testid="timeline-from-start-bar"
                    data-timeline-interactive="true"
                    aria-label="From start is on. Click to turn it off"
                    title="From start: Play replays from the start flag to the playhead. Click, C or Esc to turn off"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={onFromStartOff}
                    disabled={!onFromStartOff}
                    className="group pointer-events-auto absolute top-0 z-40 h-10 border-0 bg-transparent p-0 enabled:cursor-pointer"
                    style={{
                        left: Math.min(startX, (startX + endX) / 2 - 12),
                        width: Math.max(endX - startX, 24),
                    }}
                >
                    <span
                        className={clsx(
                            "absolute top-0 h-3 transition-[height] duration-100 group-hover:h-5",
                            START_INK.bg,
                        )}
                        style={{
                            left:
                                startX -
                                Math.min(startX, (startX + endX) / 2 - 12),
                            width: endX - startX,
                        }}
                    />
                </button>
            )}
            <div className="pointer-events-none absolute inset-0">
                {flag(
                    "start",
                    startFlagBeatIndex !== undefined && !dragRef.current
                        ? startFlagBeatIndex
                        : preview.startBeatIndex,
                )}
                {/* UI-10: the playhead is the window's end, so it has no handle of its own */}
            </div>
        </div>
    );
};

/**
 * Rehearsal marks as tabs in the measure row (UI-12; they sat on the waveform lane before), in
 * place of their measure's number. Clicking one seeks there. Thinned like the measure numbers, so
 * they don't pile up when zoomed out.
 */
export const TimelineRehearsalMarkers = ({
    model,
    pixelsPerBeat,
    top,
    compact = false,
    onSeek,
}: {
    model: TimelineViewModel;
    pixelsPerBeat: number;
    top: number;
    compact?: boolean;
    onSeek?: (beat: BeatPosition) => void;
}) => (
    <div className="pointer-events-none absolute inset-0 z-20">
        {filterMarkersByMinimumSpacing(
            model.measures.filter((measure) => measure.rehearsalMark?.trim()),
            pixelsPerBeat,
            18,
        ).map((measure) => {
            const label = measure.rehearsalMark!.trim();
            return (
                <button
                    key={measure.id}
                    type="button"
                    data-timeline-interactive="true"
                    aria-label={`Rehearsal mark ${label}`}
                    title={`Rehearsal mark ${label}`}
                    onClick={() => onSeek?.(measure.atBeat)}
                    className={clsx(
                        "border-text-subtitle bg-bg-1 text-text rounded-4 pointer-events-auto absolute flex -translate-x-1/2 items-center justify-center border px-3 font-mono leading-none font-semibold",
                        compact
                            ? "h-12 min-w-12 text-[8px]"
                            : "h-16 min-w-16 text-[10px]",
                    )}
                    style={{
                        left: beatToX(measure.atBeat, pixelsPerBeat),
                        top,
                    }}
                >
                    {label}
                </button>
            );
        })}
    </div>
);

export const TimelinePlayheadDetail = ({
    model,
    positionBeat,
    pageLabel,
    pixelsPerBeat,
    height,
    anchorRef,
    visible,
}: {
    model: TimelineViewModel;
    positionBeat: BeatPosition;
    pageLabel?: string;
    pixelsPerBeat: number;
    height: number;
    anchorRef: RefObject<HTMLButtonElement | null>;
    visible: boolean;
}) => {
    const detailRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<{
        left: number;
        top: number;
    } | null>(null);
    const updatePosition = useCallback(() => {
        const anchor = anchorRef.current;
        const detail = detailRef.current;
        if (!anchor || !detail) return;
        const anchorRect = anchor.getBoundingClientRect();
        const detailRect = detail.getBoundingClientRect();
        const centeredLeft =
            anchorRect.left + anchorRect.width / 2 - detailRect.width / 2;
        const maximumLeft = Math.max(
            8,
            window.innerWidth - detailRect.width - 8,
        );
        const next = {
            left: clamp(centeredLeft, 8, maximumLeft),
            top: Math.max(8, anchorRect.top - detailRect.height - 8),
        };
        setPosition((current) =>
            current?.left === next.left && current.top === next.top
                ? current
                : next,
        );
    }, [anchorRef]);

    useLayoutEffect(() => {
        if (!visible) {
            setPosition(null);
            return;
        }
        updatePosition();
        const observer =
            typeof ResizeObserver === "undefined"
                ? null
                : new ResizeObserver(updatePosition);
        if (anchorRef.current) observer?.observe(anchorRef.current);
        if (detailRef.current) observer?.observe(detailRef.current);
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [
        anchorRef,
        height,
        pixelsPerBeat,
        positionBeat,
        updatePosition,
        visible,
    ]);

    if (!visible) return null;
    const isDark = anchorRef.current?.closest(".dark") != null;
    return createPortal(
        <div
            ref={detailRef}
            role="tooltip"
            data-testid="timeline-playhead-detail"
            className={clsx(
                "bg-accent text-text-invert rounded-4 pointer-events-none fixed z-[100] px-6 py-4 font-mono text-[11px] leading-none whitespace-nowrap shadow-sm",
                isDark && "dark",
            )}
            style={{
                left: position?.left ?? 0,
                top: position?.top ?? 0,
                visibility: position ? "visible" : "hidden",
            }}
        >
            {getPlayheadLabel(model, positionBeat, pageLabel)}
        </div>,
        document.body,
    );
};

export const TimelinePlayhead = ({
    model,
    positionBeat,
    livePositionBeat,
    pageLabel,
    pixelsPerBeat,
    height,
    beatCount,
    anchorRef,
    onHoverChange,
    onFocusChange,
    onSeek,
}: {
    model: TimelineViewModel;
    positionBeat: BeatPosition;
    /**
     * While playing, the live position (view beats, fractional). The line follows it every
     * animation frame by setting its own `left`, without re-rendering the timeline.
     */
    livePositionBeat?: () => number | null;
    pageLabel?: string;
    pixelsPerBeat: number;
    height: number;
    beatCount: number;
    anchorRef: RefObject<HTMLButtonElement | null>;
    onHoverChange: (hovered: boolean) => void;
    onFocusChange: (focused: boolean) => void;
    onSeek?: (beat: BeatPosition) => void;
}) => {
    const left = beatToX(positionBeat, pixelsPerBeat);
    // Where React last put the line; read when following stops (see below)
    const restingLeft = useRef(left);
    restingLeft.current = left;
    useEffect(() => {
        const element = anchorRef.current;
        if (!livePositionBeat || !element) return;
        let frame = 0;
        const follow = () => {
            const beat = livePositionBeat();
            if (beat !== null)
                element.style.left = `${beatToX(beat, pixelsPerBeat)}px`;
            frame = requestAnimationFrame(follow);
        };
        frame = requestAnimationFrame(follow);
        return () => {
            cancelAnimationFrame(frame);
            // React only writes `left` when its value changes, so put the line back itself
            element.style.left = `${restingLeft.current}px`;
        };
    }, [anchorRef, livePositionBeat, pixelsPerBeat]);

    return (
        <button
            ref={anchorRef}
            type="button"
            data-testid="timeline-playhead"
            data-timeline-scrub="true"
            aria-label={`Playback position: ${getPlayheadLabel(model, positionBeat, pageLabel)}`}
            onPointerDown={(event) => event.preventDefault()}
            onPointerEnter={() => onHoverChange(true)}
            onPointerLeave={() => onHoverChange(false)}
            onFocus={() => onFocusChange(true)}
            onBlur={() => onFocusChange(false)}
            onKeyDown={(event) => {
                const delta =
                    event.key === "ArrowLeft"
                        ? -1
                        : event.key === "ArrowRight"
                          ? 1
                          : 0;
                if (delta === 0 || !onSeek) return;
                event.preventDefault();
                onSeek(clamp(Math.round(positionBeat) + delta, 0, beatCount));
            }}
            className="focus-visible:ring-accent pointer-events-auto absolute top-0 z-50 w-12 -translate-x-1/2 cursor-ew-resize touch-none border-0 bg-transparent p-0 outline-hidden focus-visible:ring-2"
            style={{
                left,
                height,
            }}
        >
            <span className="border-t-accent absolute top-0 left-1/2 size-0 -translate-x-1/2 border-t-[6px] border-r-[4px] border-l-[4px] border-r-transparent border-l-transparent" />
            <span className="bg-accent absolute top-6 bottom-0 left-1/2 w-px" />
        </button>
    );
};

/** How far, in pixels, a press on empty timeline space must move to select a range */
export const TIMELINE_RANGE_DRAG_PX = 4;

/**
 * The range a drag on empty timeline space selects (ui.md UI-9 "Creating a timeline"): from where
 * it started to where it is, each edge snapped as in UI-2 (Alt turns snapping off), in order.
 * `null` while it covers no whole beat.
 */
export const getDraggedRange = ({
    fromBeat,
    toBeat,
    snapBeats,
    pixelsPerBeat,
    beatCount,
}: {
    fromBeat: number;
    toBeat: number;
    snapBeats: readonly number[];
    pixelsPerBeat: number;
    beatCount: number;
}): TimelineBeatRange | null => {
    const edge = (beat: number) =>
        clamp(snapBoundary({ beat, snapBeats, pixelsPerBeat }), 0, beatCount);
    const a = edge(fromBeat);
    const b = edge(toBeat);
    if (a === b) return null;
    return { startBeatIndex: Math.min(a, b), endBeatIndex: Math.max(a, b) };
};

/**
 * The pointer on the timeline's surface. Pressing the playhead and dragging scrubs it. On empty
 * space, a click seeks; with `onRangeSelect`, a drag selects the dragged range instead (UI-9),
 * shown as `rangePreview` until it's released. Without it, a drag scrubs.
 */
/** macOS, where Ctrl+click is a right-click and Cmd is the modifier */
export const isMac = () =>
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * The modifier that turns a drag on the timeline into a drawn range (UI-12): Cmd on macOS, Ctrl
 * elsewhere. Without it a drag scrubs the playhead.
 */
export const isRangeModifier = (event: {
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
}) => (isMac() ? event.metaKey : event.ctrlKey);

export const useTimelinePointer = ({
    onSeek,
    onRangeSelect,
    pixelsPerBeat,
    beatCount,
    snapBeats = [],
}: {
    onSeek?: (beat: number) => void;
    onRangeSelect?: (range: TimelineBeatRange) => void;
    pixelsPerBeat: number;
    beatCount: number;
    snapBeats?: readonly number[];
}) => {
    const [isDragging, setIsDragging] = useState(false);
    const [rangePreview, setRangePreview] = useState<TimelineBeatRange | null>(
        null,
    );
    const gesture = useRef<{
        mode: "scrub" | "press" | "range";
        startClientX: number;
        startBeat: number;
    } | null>(null);
    const draggedRange = (
        event: ReactPointerEvent<HTMLElement>,
        startBeat: number,
    ) =>
        getDraggedRange({
            fromBeat: startBeat,
            toBeat: pointerBeat(event),
            snapBeats: isPageSnapDisabled(event) ? [] : snapBeats,
            pixelsPerBeat,
            beatCount,
        });
    const pointerBeat = useCallback(
        (event: ReactPointerEvent<HTMLElement>) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            return clientXToBeat({
                clientX: event.clientX,
                surfaceLeft: bounds.left,
                pixelsPerBeat,
                startBeat: 0,
                beatCount,
            });
        },
        [beatCount, pixelsPerBeat],
    );
    const seek = useCallback(
        (beat: number) => onSeek?.(Math.round(beat)),
        [onSeek],
    );

    const end = () => {
        gesture.current = null;
        setIsDragging(false);
        setRangePreview(null);
    };

    return {
        isDragging,
        rangePreview,
        pointerHandlers: {
            onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
                const current = gesture.current;
                if (!current) return;
                if (current.mode === "scrub") {
                    seek(pointerBeat(event));
                    return;
                }
                if (
                    current.mode === "press" &&
                    Math.abs(event.clientX - current.startClientX) <
                        TIMELINE_RANGE_DRAG_PX
                )
                    return;
                current.mode = "range";
                setRangePreview(draggedRange(event, current.startBeat));
            },
            onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
                const drawing = isRangeModifier(event);
                if (
                    (event.button !== undefined && event.button !== 0) ||
                    // macOS ctrl+click is a right-click: it opens the context menu, not a seek
                    (isMac() && event.ctrlKey) ||
                    (event.target instanceof Element &&
                        // With the range modifier a page box is timeline space too (UI-12)
                        event.target.closest(
                            drawing
                                ? "[data-timeline-interactive]:not([data-timeline-range-page])"
                                : "[data-timeline-interactive]",
                        ))
                )
                    return;
                const onPlayhead =
                    event.target instanceof Element &&
                    event.target.closest("[data-timeline-scrub]") != null;
                const startBeat = pointerBeat(event);
                // UI-12: a plain drag scrubs; Ctrl+drag (Cmd on macOS) draws a range
                gesture.current = {
                    mode:
                        onPlayhead || !onRangeSelect || !drawing
                            ? "scrub"
                            : "press",
                    startClientX: event.clientX,
                    startBeat,
                };
                event.currentTarget.setPointerCapture?.(event.pointerId);
                if (gesture.current.mode === "scrub") {
                    setIsDragging(true);
                    if (!onPlayhead) seek(startBeat);
                }
            },
            onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
                const current = gesture.current;
                if (!current) return;
                event.currentTarget.releasePointerCapture?.(event.pointerId);
                if (current.mode === "range") {
                    const range = draggedRange(event, current.startBeat);
                    end();
                    if (range) onRangeSelect?.(range);
                    return;
                }
                end();
                seek(
                    current.mode === "press"
                        ? current.startBeat
                        : pointerBeat(event),
                );
            },
            onPointerCancel: end,
        },
    };
};

export const useElementWidth = (ref: RefObject<HTMLElement | null>) => {
    const [width, setWidth] = useState(0);
    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        const updateWidth = () => setWidth(element.clientWidth);
        updateWidth();
        // Without ResizeObserver (jsdom) the first measure stands
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(updateWidth);
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);
    return width;
};
