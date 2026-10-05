import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type MouseEvent,
} from "react";
import { PlusIcon } from "@phosphor-icons/react";
import clsx from "clsx";
import { TimelineGridCanvas, TimelineWaveformCanvas } from "./TimelineCanvas";
import {
    beatToX,
    clamp,
    getPageSnapBeats,
    getSelectionRange,
    getTrackRange,
    sameRange,
    packTimelineTracks,
} from "./TimelineGeometry";
import {
    TIMELINE_MAX_PX_PER_BEAT,
    TIMELINE_INITIAL_PAGE_WIDTH,
    TIMELINE_MIN_PX_PER_BEAT,
    TimelinePageLines,
    TimelinePlayhead,
    TimelinePlayheadDetail,
    TimelineRehearsalMarkers,
    TimelineRuler,
    TimelineSelectionRange,
    type TimelineSelectionInteraction,
    TimelineShell,
    TimelineTrackClip,
    TimelineTransport,
    useElementWidth,
    useTimelinePointer,
} from "./TimelinePrimitives";
import { markedRangeAt, useTimelineRangeMenu } from "./TimelineRangeMenu";
import type {
    TimelineCommonProps,
    TimelineNavigation,
    TimelineSelection,
} from "./TimelineViewModel";

type TimelineDensity = "expanded" | "collapsed";

/** The zoom a second Fit goes back to when there was none before (Timeline's starting zoom) */
const TIMELINE_DEFAULT_PX_PER_BEAT = 16;

const useTimelineZoom = ({
    viewportRef,
    pixelsPerBeat,
    beatCount,
    leadingInset,
    onPixelsPerBeatChange,
}: {
    viewportRef: React.RefObject<HTMLDivElement | null>;
    pixelsPerBeat: number;
    beatCount: number;
    leadingInset: number;
    onPixelsPerBeatChange?: (pixelsPerBeat: number) => void;
}) => {
    const viewportWidth = useElementWidth(viewportRef);
    // The zoom from before Fit, so a second Fit goes back to it (UI-12)
    const beforeFit = useRef<number | null>(null);
    const latest = useRef({ pixelsPerBeat, onPixelsPerBeatChange });
    latest.current = { pixelsPerBeat, onPixelsPerBeatChange };
    const fitValue =
        beatCount > 0 && viewportWidth > 0
            ? clamp(
                  Math.max(0, viewportWidth - leadingInset) / beatCount,
                  TIMELINE_MIN_PX_PER_BEAT,
                  TIMELINE_MAX_PX_PER_BEAT,
              )
            : null;
    const fitted =
        fitValue !== null && Math.abs(pixelsPerBeat - fitValue) < 0.01;

    /** Zooms to `next`, keeping the beat at `anchorPx` (from the viewport's left) in place */
    const zoomTo = useCallback(
        (next: number, anchorPx?: number) => {
            const viewport = viewportRef.current;
            const { pixelsPerBeat: current, onPixelsPerBeatChange: change } =
                latest.current;
            if (!viewport || !change) return;
            const bounded = clamp(
                next,
                TIMELINE_MIN_PX_PER_BEAT,
                TIMELINE_MAX_PX_PER_BEAT,
            );
            const anchor = anchorPx ?? viewport.clientWidth / 2;
            const anchorBeat =
                (viewport.scrollLeft + anchor - leadingInset) / current;
            latest.current = {
                pixelsPerBeat: bounded,
                onPixelsPerBeatChange: change,
            };
            change(bounded);
            requestAnimationFrame(() => {
                viewport.scrollLeft = Math.max(
                    0,
                    leadingInset + anchorBeat * bounded - anchor,
                );
            });
        },
        [leadingInset, viewportRef],
    );

    // Ctrl+scroll (or a trackpad pinch, which arrives as one) zooms about the pointer
    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const onWheel = (event: WheelEvent) => {
            if (!(event.ctrlKey || event.metaKey)) return;
            event.preventDefault();
            beforeFit.current = null;
            zoomTo(
                latest.current.pixelsPerBeat * Math.exp(-event.deltaY * 0.0025),
                event.clientX - viewport.getBoundingClientRect().left,
            );
        };
        viewport.addEventListener("wheel", onWheel, { passive: false });
        return () => viewport.removeEventListener("wheel", onWheel);
    }, [viewportRef, zoomTo]);

    const fit = useCallback(() => {
        const viewport = viewportRef.current;
        if (!viewport || !onPixelsPerBeatChange || fitValue === null) return;
        if (fitted) {
            const back = beforeFit.current ?? TIMELINE_DEFAULT_PX_PER_BEAT;
            beforeFit.current = null;
            zoomTo(back);
            return;
        }
        beforeFit.current = pixelsPerBeat;
        onPixelsPerBeatChange(fitValue);
        requestAnimationFrame(() => {
            viewport.scrollLeft = 0;
        });
    }, [
        fitValue,
        fitted,
        onPixelsPerBeatChange,
        pixelsPerBeat,
        viewportRef,
        zoomTo,
    ]);

    return { fit, fitted };
};

const navigateToPage = ({
    direction,
    currentBeat,
    pages,
}: {
    direction: TimelineNavigation;
    currentBeat: number;
    pages: TimelineCommonProps["model"]["pages"];
}) => {
    if (pages.length === 0) return 0;
    const timedPages = pages.filter((page) => !page.isInitial);
    const ordered = [...(timedPages.length > 0 ? timedPages : pages)].sort(
        (a, b) => a.atBeat - b.atBeat,
    );
    if (direction === "first-page") return ordered[0].atBeat;
    if (direction === "last-page") return ordered[ordered.length - 1].atBeat;
    if (direction === "previous-page") {
        return (
            [...ordered].reverse().find((page) => page.atBeat < currentBeat)
                ?.atBeat ?? ordered[0].atBeat
        );
    }
    return (
        ordered.find((page) => page.atBeat > currentBeat)?.atBeat ??
        ordered[ordered.length - 1].atBeat
    );
};

const transportNavigation = (props: TimelineCommonProps) =>
    props.onNavigate ??
    (props.onSeek
        ? (direction: TimelineNavigation) =>
              props.onSeek?.(
                  navigateToPage({
                      direction,
                      currentBeat: props.positionBeat,
                      pages: props.model.pages,
                  }),
              )
        : undefined);

function TimelineSurface({
    density,
    ...props
}: TimelineCommonProps & { density: TimelineDensity }) {
    const {
        model,
        pixelsPerBeat,
        positionBeat,
        selection,
        selectedTarget,
        showTransport = true,
        className,
    } = props;
    const expanded = density === "expanded";
    const viewportRef = useRef<HTMLDivElement>(null);
    const playheadRef = useRef<HTMLButtonElement>(null);
    const [playheadHovered, setPlayheadHovered] = useState(false);
    const [playheadFocused, setPlayheadFocused] = useState(false);
    const rows = useMemo(
        () => packTimelineTracks(model.tracks),
        [model.tracks],
    );
    const snapBeats = useMemo(
        () =>
            getPageSnapBeats({
                pages: model.pages,
                beatCount: model.beatCount,
            }),
        [model.beatCount, model.pages],
    );
    const width = model.beatCount * pixelsPerBeat;
    const initialPageWidth = model.pages.some((page) => page.isInitial)
        ? TIMELINE_INITIAL_PAGE_WIDTH
        : 0;
    const surfaceWidth = width + initialPageWidth;
    // UI-12: the ruler (28px), the measure row under it, then a lane only for what is there:
    // clip rows only when there are off-page clips, the waveform only with audio peaks (expanded)
    const railHeight = expanded ? 20 : 14;
    const trackTop = 28 + railHeight + 2;
    const rowPitch = expanded ? 22 : 8;
    const trackHeight = expanded ? 14 : 6;
    // Compact bars sit in a taller hit area, so they can still be clicked and dragged
    const clipHitHeight = expanded ? trackHeight : 14;
    const trackBandHeight = rows.length * rowPitch;
    const showWaveform =
        expanded &&
        model.waveform.peaksByBeat.some((peaks) => peaks.length > 0);
    const waveformHeight = 32;
    const audioTop = trackTop + trackBandHeight + 4;
    const timelineHeight =
        (showWaveform
            ? audioTop + waveformHeight
            : trackTop + trackBandHeight) + (expanded ? 4 : 0);
    const selectionRange = getSelectionRange(selection);
    const [selectionInteraction, setSelectionInteraction] =
        useState<TimelineSelectionInteraction | null>(null);
    const selectionIdentity = selection?.kind ?? "none";
    useEffect(() => {
        setSelectionInteraction(null);
    }, [
        selectionIdentity,
        selectionRange?.endBeatIndex,
        selectionRange?.startBeatIndex,
    ]);
    const displayedSelectionRange = selectionRange
        ? (selectionInteraction?.range ?? selectionRange)
        : null;
    const selectionDragging = selectionInteraction?.dragging ?? false;
    const countFollowsStart =
        selectionDragging && selectionInteraction?.activeHandle === "start";
    const countRendersToLeft = displayedSelectionRange
        ? countFollowsStart
            ? displayedSelectionRange.startBeatIndex > 0
            : displayedSelectionRange.endBeatIndex >= model.beatCount
        : false;
    const zoom = useTimelineZoom({
        viewportRef,
        pixelsPerBeat,
        beatCount: model.beatCount,
        leadingInset: initialPageWidth,
        onPixelsPerBeatChange: props.onPixelsPerBeatChange,
    });
    // The owner seeks on a selection (UI-9: to a range's end, or home's beat 0)
    const onSelectionChange = (next: TimelineSelection) =>
        props.onSelectionChange?.(next);
    const pointer = useTimelinePointer({
        onSeek: props.onSeek,
        onRangeSelect: props.onSelectionChange
            ? (range) =>
                  onSelectionChange({ kind: "range", range, drawn: true })
            : undefined,
        pixelsPerBeat,
        beatCount: model.beatCount,
        snapBeats,
    });
    const showCreateTrack =
        selection?.kind === "range" &&
        selectedTarget != null &&
        selectionRange != null &&
        props.onCreateTrack != null &&
        !selectionDragging;
    const showPlayheadDetail =
        playheadHovered || playheadFocused || pointer.isDragging;
    const transportProps = {
        ...props,
        onNavigate: transportNavigation(props),
    };
    // The right-click menu's target: a page box or clip under the pointer, else a dragged range
    // the pointer is inside (UI-9 Adding marchers, Creating a timeline)
    const rangeMenu = useTimelineRangeMenu({
        menu: props.addSelectedMarchers,
        resolveRange: (event: MouseEvent<HTMLElement>) => {
            const marked = markedRangeAt(event.target);
            if (marked) return marked;
            if (selection?.kind !== "range" || !selectionRange) return null;
            const surface = event.currentTarget.querySelector(
                '[data-testid="timeline-pointer-surface"]',
            );
            if (!surface) return null;
            const beat =
                (event.clientX - surface.getBoundingClientRect().left) /
                pixelsPerBeat;
            return beat >= selectionRange.startBeatIndex &&
                beat <= selectionRange.endBeatIndex
                ? { range: selectionRange }
                : null;
        },
    });

    return (
        <TimelineShell
            viewportRef={viewportRef}
            className={className}
            transport={
                showTransport ? (
                    <TimelineTransport
                        model={model}
                        clock={props.transportClock}
                        accessories={props.transportAccessories}
                        viewControls={props.transportViewControls}
                        positionBeat={positionBeat}
                        isPlaying={transportProps.isPlaying}
                        onPlayingChange={transportProps.onPlayingChange}
                        onStop={transportProps.onStop}
                        onNavigate={transportProps.onNavigate}
                        onFit={
                            props.onPixelsPerBeatChange ? zoom.fit : undefined
                        }
                        fitted={zoom.fitted}
                        compact={!expanded}
                    />
                ) : undefined
            }
        >
            <div
                className="relative"
                style={{ width: surfaceWidth, height: timelineHeight }}
                onContextMenu={rangeMenu.onContextMenu}
                onDoubleClick={(event) => {
                    const marked = markedRangeAt(event.target);
                    if (marked) props.onOpenRange?.(marked);
                }}
            >
                <div
                    {...pointer.pointerHandlers}
                    data-testid="timeline-pointer-surface"
                    className="absolute top-0 touch-none"
                    style={{
                        left: initialPageWidth,
                        width,
                        height: timelineHeight,
                    }}
                >
                    <TimelineGridCanvas
                        width={width}
                        height={timelineHeight}
                        pixelsPerBeat={pixelsPerBeat}
                        measures={model.measures}
                        lineTop={28}
                        topTickY={34}
                        // UI-12: one row of beat ticks, in the measure row
                        bottomTickY={null}
                    />
                    <TimelinePageLines
                        pages={model.pages}
                        pixelsPerBeat={pixelsPerBeat}
                        height={timelineHeight}
                    />
                    <TimelineRuler
                        pages={model.pages}
                        measures={model.measures}
                        beatCount={model.beatCount}
                        pixelsPerBeat={pixelsPerBeat}
                        selection={selection}
                        onSelectionChange={onSelectionChange}
                        onSeek={props.onSeek}
                        initialPageWidth={initialPageWidth}
                        showMeasures={expanded}
                    />
                    {rows.flatMap((row, rowIndex) =>
                        row.map((track) => (
                            <TimelineTrackClip
                                key={track.id}
                                track={track}
                                pixelsPerBeat={pixelsPerBeat}
                                top={
                                    trackTop +
                                    rowIndex * rowPitch -
                                    (clipHitHeight - trackHeight) / 2
                                }
                                height={clipHitHeight}
                                barHeight={expanded ? undefined : trackHeight}
                                // A clip is its timeline: it shows selected when its range is
                                // the selection, and clicking it selects that range (UI-12)
                                selected={sameRange(
                                    getTrackRange(track),
                                    selectionRange,
                                )}
                                onSelect={
                                    props.onSelectionChange
                                        ? () => {
                                              const range =
                                                  getTrackRange(track);
                                              if (range)
                                                  onSelectionChange({
                                                      kind: "range",
                                                      range,
                                                  });
                                          }
                                        : undefined
                                }
                                onRangeCommit={props.onTimelineRangeCommit}
                                beatCount={model.beatCount}
                                snapBeats={snapBeats}
                                micro={!expanded}
                            />
                        )),
                    )}
                    {showWaveform && (
                        <div
                            className="bg-bg-1/40 rounded-4 absolute left-0 overflow-hidden"
                            style={{
                                top: audioTop,
                                width,
                                height: waveformHeight,
                            }}
                        >
                            <TimelineWaveformCanvas
                                waveform={model.waveform}
                                width={width}
                                height={waveformHeight}
                                pixelsPerBeat={pixelsPerBeat}
                                positionBeat={positionBeat}
                            />
                        </div>
                    )}
                    <TimelineRehearsalMarkers
                        model={model}
                        pixelsPerBeat={pixelsPerBeat}
                        top={expanded ? 30 : 29}
                        compact={!expanded}
                        onSeek={props.onSeek}
                    />
                    <TimelinePlayhead
                        model={model}
                        positionBeat={positionBeat}
                        livePositionBeat={
                            props.isPlaying ? props.livePositionBeat : undefined
                        }
                        pageLabel={props.pageLabel}
                        pixelsPerBeat={pixelsPerBeat}
                        height={timelineHeight}
                        beatCount={model.beatCount}
                        anchorRef={playheadRef}
                        onHoverChange={setPlayheadHovered}
                        onFocusChange={setPlayheadFocused}
                        onSeek={props.onSeek}
                    />
                    {props.onAddPageFlag && !props.isPlaying && (
                        <button
                            type="button"
                            data-testid="timeline-add-page-flag"
                            data-timeline-interactive="true"
                            aria-label="Add a page flag here"
                            title="Add a page flag here"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={props.onAddPageFlag}
                            className="bg-accent text-text-invert focus-visible:ring-accent pointer-events-auto absolute top-6 z-[60] flex size-16 items-center justify-center rounded-full outline-hidden focus-visible:ring-2"
                            style={{
                                left: beatToX(positionBeat, pixelsPerBeat) + 8,
                            }}
                        >
                            <PlusIcon size={10} weight="bold" />
                        </button>
                    )}
                    <TimelinePlayheadDetail
                        model={model}
                        positionBeat={positionBeat}
                        pageLabel={props.pageLabel}
                        pixelsPerBeat={pixelsPerBeat}
                        height={timelineHeight}
                        anchorRef={playheadRef}
                        visible={showPlayheadDetail}
                    />
                    {pointer.rangePreview && (
                        <div
                            data-testid="timeline-range-preview"
                            aria-hidden="true"
                            className="bg-accent/15 border-accent pointer-events-none absolute top-28 z-30 border-x"
                            style={{
                                left:
                                    pointer.rangePreview.startBeatIndex *
                                    pixelsPerBeat,
                                width:
                                    (pointer.rangePreview.endBeatIndex -
                                        pointer.rangePreview.startBeatIndex) *
                                    pixelsPerBeat,
                                height: Math.max(0, timelineHeight - 28),
                            }}
                        />
                    )}
                    {selectionRange && (
                        <TimelineSelectionRange
                            range={selectionRange}
                            startFlagBeatIndex={
                                selection?.kind === "range"
                                    ? selection.startFlagBeatIndex
                                    : undefined
                            }
                            fromStart={
                                selection?.kind === "range" &&
                                selection.fromStart === true
                            }
                            onFromStartOff={props.onPlayFromStartOff}
                            startPinned={
                                selection?.kind === "range" &&
                                selection.startPinned === true
                            }
                            onUnpin={props.onUnpinStart}
                            pinTop={expanded ? 31 : 29}
                            beatCount={model.beatCount}
                            pixelsPerBeat={pixelsPerBeat}
                            height={timelineHeight}
                            snapBeats={snapBeats}
                            onCommit={
                                props.onSelectionChange
                                    ? (range) =>
                                          props.onSelectionChange?.({
                                              kind: "range",
                                              range,
                                          })
                                    : undefined
                            }
                            onInteractionChange={setSelectionInteraction}
                        />
                    )}
                    {displayedSelectionRange && (
                        <div
                            data-testid="timeline-selection-actions"
                            className="absolute z-40 flex flex-col gap-4"
                            style={{
                                left:
                                    (countFollowsStart
                                        ? displayedSelectionRange.startBeatIndex
                                        : displayedSelectionRange.endBeatIndex) *
                                        pixelsPerBeat +
                                    (countRendersToLeft ? -6 : 6),
                                top: expanded ? 31 : 29,
                                alignItems: countRendersToLeft
                                    ? "flex-end"
                                    : "flex-start",
                                transform: countRendersToLeft
                                    ? "translateX(-100%)"
                                    : undefined,
                            }}
                        >
                            <span
                                data-testid="timeline-selection-count"
                                className={clsx(
                                    "border-stroke bg-bg-1 text-text rounded-6 border font-mono whitespace-nowrap",
                                    expanded
                                        ? "px-8 py-2 text-[10px]"
                                        : "px-6 py-0 text-[9px]",
                                )}
                            >
                                {displayedSelectionRange.endBeatIndex -
                                    displayedSelectionRange.startBeatIndex}{" "}
                                counts
                            </span>
                            {showCreateTrack && selectedTarget && (
                                <button
                                    type="button"
                                    data-timeline-interactive="true"
                                    onClick={() =>
                                        props.onCreateTrack?.({
                                            target: selectedTarget,
                                            range: displayedSelectionRange,
                                        })
                                    }
                                    className="bg-accent text-text-invert rounded-full px-8 py-3 text-[11px] leading-none whitespace-nowrap"
                                >
                                    Create Track
                                </button>
                            )}
                        </div>
                    )}
                </div>
                {rangeMenu.element}
            </div>
        </TimelineShell>
    );
}

export function ExpandedTimeline(props: TimelineCommonProps) {
    return <TimelineSurface {...props} density="expanded" />;
}

export function CollapsedTimeline(props: TimelineCommonProps) {
    return <TimelineSurface {...props} density="collapsed" />;
}
