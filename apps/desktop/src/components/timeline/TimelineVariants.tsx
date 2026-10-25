import { wheelScrollsSideways } from "./timelineWheel";
import { TimelinePageFlagHandles } from "./TimelinePageFlagHandles";
import {
    memo,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type MouseEvent,
    type ReactNode,
} from "react";
import { TimelineLoopBar } from "./TimelineLoopBar";
import { useClipDrops } from "./clipDrops";
import { TimelinePaneStretchContext } from "./timelinePaneStretch";
import { flushSync } from "react-dom";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useTimelineFollow, type FollowZoomAnchor } from "./useTimelineFollow";
import clsx from "clsx";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { toast } from "sonner";
import { overriddenSections } from "@/timeline/tempo";
import {
    TimelineCountLinesCanvas,
    TimelineEnvelopeCanvas,
    TimelineGridCanvas,
    TimelineWaveformCanvas,
} from "./TimelineCanvas";
import {
    clamp,
    getPageSnapBeats,
    getWindowCountLabel,
    isPastLastFlag,
    getSelectionRange,
    getTimelineRows,
    getTrackRange,
    sameRange,
    packTimelineTracks,
    TIMELINE_PAGE_ROW_BOTTOM,
    TIMELINE_PAGE_ROW_TOP,
} from "./TimelineGeometry";
import {
    TIMELINE_MAX_PX_PER_BEAT,
    TIMELINE_INITIAL_PAGE_WIDTH,
    TIMELINE_MIN_PX_PER_BEAT,
    TimelinePageLines,
    TimelinePastEndShade,
    TimelinePlayhead,
    TimelineReturnMarker,
    showsReturnMarker,
    TimelineRangePreview,
    TimelineRuler,
    TimelineSelectionRange,
    TimelineStartFlagMark,
    type TimelineSelectionInteraction,
    TimelineShell,
    TimelineTrackClip,
    TimelineTransport,
    useElementHeight,
    useElementWidth,
    useTimelinePointer,
} from "./TimelinePrimitives";
import {
    markedRangeAt,
    useTimelineRangeMenu,
    type TimelineAddMarchersMenu,
    type TimelineMenuExtraItem,
    type TimelineMenuTarget,
} from "./TimelineRangeMenu";
import {
    MeasureRowMenuItems,
    measureRowTargetAt,
    TimelineMeasureRowEditor,
    TimelineRehearsalMarkers,
    useMeasureRowEditing,
} from "./TimelineMeasureRow";
import { isTyping, overlayOpen } from "./timelineHotkeys";
import { useLatestCallback } from "./useLatestCallback";
import { TimelineAppendAtPlayhead } from "./TimelineAppendAtPlayhead";
import {
    createLiveValue,
    type TimelineLiveValue,
    useLiveValue,
} from "./timelineLiveValue";
import {
    ALIGN_MAX_PX_PER_SECOND,
    ALIGN_MIN_PX_PER_SECOND,
    alignPixelsPerSecond,
    countsAxis,
    scrollKeepingBeat,
    secondsAxis,
    type TimelineXAxis,
} from "./timelineAxis";
import {
    alignFlags,
    alignMeasures,
    alignPages as toAlignPages,
    countTempoText,
    evenOutPage,
    formatShowTime,
    formatTempo,
    viewTimes,
    type AlignPage,
} from "./timelineAlign";
import {
    alignT,
    TimelineAlignChip,
    TimelineAlignConfirm,
    TimelineAlignFlags,
    TimelineAlignPreviewLayer,
    TimelineAlignTempoPrompt,
    TimelineAlignTicks,
    TimelineAlignTimeLine,
    ALIGN_DRAG_PX,
    TimelineAlignToggle,
    useAlignEdit,
} from "./TimelineAlignView";
import {
    TimelinePunchTapControls,
    TimelinePunchTapLayer,
    usePunchTap,
} from "./TimelinePunchTap";
import { fitSeconds, useViewportExtent } from "./useViewportExtent";
import type {
    TimelineBeatRange,
    TimelineCommonProps,
    TimelineNavigation,
    TimelinePageMarker,
    TimelineTarget,
    TimelineTrack,
    TimelineTrackId,
} from "./TimelineViewModel";
import {
    TimelineBasicBodies,
    TimelineBasicExpertMarks,
    TimelineBasicPoints,
} from "./TimelineBasicLayers";

type TimelineDensity = "expanded" | "collapsed" | "basic";

/** Timeline's starting zoom, and the least a second Fit zooms in to when it can't go back */
const TIMELINE_DEFAULT_PX_PER_BEAT = 16;

/**
 * Room after the show's last beat, fitted or scrolled to the end, so the playhead on the last
 * beat stays on screen with room to right-click it for **Create page at playhead** (UI-9). Sized for the **+**
 * that used to sit just after the playhead (its 8px gap, its 16px, and 8px to spare).
 */
export const TIMELINE_END_INSET = 32;

/** How far above the fitted zoom a remembered zoom must be for a second Fit to go back to it */
const FIT_BACK_MARGIN = 1.05;

/**
 * The zoom a second Fit goes back to (UI-12): the zoom from before Fit when it is visibly closer
 * in than the fit, else twice the fit (at least the starting zoom), so Fit always does something.
 * Zooming out stops at the fit, so going back to a zoom at or under it would do nothing.
 */
export function fitBackZoom(
    zoomBeforeFit: number | null,
    fitValue: number,
    maxScale = TIMELINE_MAX_PX_PER_BEAT,
): number {
    const back =
        zoomBeforeFit !== null && zoomBeforeFit > fitValue * FIT_BACK_MARGIN
            ? zoomBeforeFit
            : Math.max(TIMELINE_DEFAULT_PX_PER_BEAT, fitValue * 2);
    return Math.min(back, maxScale);
}

/** How much one pixel of wheel or pinch delta zooms */
const WHEEL_ZOOM_RATE = 0.0025;

/**
 * The timeline's zoom (UI-12), native to trackpads and wheels:
 * - A pinch, or Ctrl/Cmd+scroll, zooms smoothly about the pointer. Events are gathered and applied
 *   once a frame, and the scroll that keeps the beat under the pointer is set after React draws
 *   the new width and before the browser paints it, so nothing drifts.
 * - A plain vertical scroll or swipe scrolls the timeline sideways; a sideways swipe already does.
 * - Fit (or Shift+Z) fits the show; again goes back, about the playhead. Zooming out stops at the
 *   fitted zoom, so a show never shows as a sliver; while fitted it stays fitted as the viewport or
 *   the show changes (`fitted`, remembered by the caller).
 *
 * The Align view uses it in seconds: `pixelsPerBeat` is then px/s and `beatCount` the seconds the
 * surface spans, with its own `minScale` and `maxScale`.
 */
const useTimelineZoom = ({
    viewportRef,
    pixelsPerBeat,
    beatCount,
    leadingInset,
    trailingInset = 0,
    playheadBeat,
    onPixelsPerBeatChange,
    fitted: rememberedFitted,
    onFittedChange,
    followAnchor,
    minScale = TIMELINE_MIN_PX_PER_BEAT,
    maxScale = TIMELINE_MAX_PX_PER_BEAT,
}: {
    viewportRef: React.RefObject<HTMLDivElement | null>;
    pixelsPerBeat: number;
    /** The beats Fit fits: the show's, and any music drawn past its end */
    beatCount: number;
    leadingInset: number;
    /** Room after the last beat (`TIMELINE_END_INSET`, or **+ N counts**), left out of the fit */
    trailingInset?: number;
    playheadBeat: number;
    onPixelsPerBeatChange?: (pixelsPerBeat: number) => void;
    fitted?: boolean;
    onFittedChange?: (fitted: boolean) => void;
    /** While the view follows the playhead, the playhead to zoom about instead of the pointer */
    followAnchor?: () => FollowZoomAnchor | null;
    minScale?: number;
    maxScale?: number;
}) => {
    const viewportWidth = useElementWidth(viewportRef);
    const fitValue =
        beatCount > 0 && viewportWidth > 0
            ? clamp(
                  Math.max(0, viewportWidth - leadingInset - trailingInset) /
                      beatCount,
                  minScale,
                  maxScale,
              )
            : null;
    const minimum = fitValue ?? minScale;
    const isFitted =
        fitValue !== null && Math.abs(pixelsPerBeat - fitValue) < 0.01;
    const latest = useRef({
        pixelsPerBeat,
        minimum,
        maxScale,
        onPixelsPerBeatChange,
    });
    latest.current = {
        pixelsPerBeat,
        minimum,
        maxScale,
        onPixelsPerBeatChange,
    };
    /** The beat to keep at `anchorPx` once `pixelsPerBeat` lands on `next` */
    const pendingScroll = useRef<{
        next: number;
        anchorBeat: number;
        anchorPx: number;
    } | null>(null);
    const pendingWheel = useRef<{ factor: number; anchorPx: number } | null>(
        null,
    );
    const frame = useRef(0);
    /**
     * The zoom from before Fit, so a second Fit goes back to it. Per surface: switching compact
     * remounts it, and a second Fit then zooms in from the fit instead.
     */
    const zoomBeforeFit = useRef<number | null>(null);
    /** Set when the effect below fits a resized show, so the remember effect skips that commit */
    const autoFitted = useRef(false);

    /** Zooms to `next`, keeping `anchorBeat` at `anchorPx` from the viewport's left */
    const zoomTo = useCallback(
        (next: number, anchorPx: number, anchorBeat?: number) => {
            const viewport = viewportRef.current;
            const {
                pixelsPerBeat: current,
                minimum: floor,
                maxScale: ceiling,
                onPixelsPerBeatChange: change,
            } = latest.current;
            if (!viewport || !change) return;
            const bounded = clamp(next, floor, ceiling);
            if (Math.abs(bounded - current) < 0.001) return;
            pendingScroll.current = {
                next: bounded,
                anchorPx,
                anchorBeat:
                    anchorBeat ??
                    (viewport.scrollLeft + anchorPx - leadingInset) / current,
            };
            latest.current = { ...latest.current, pixelsPerBeat: bounded };
            // Drawn now, in this frame, rather than in a later task once the frame has painted
            // with the old zoom, so the zoom isn't a frame behind the gesture (h-dom H4)
            flushSync(() => change(bounded));
        },
        [leadingInset, viewportRef],
    );

    // After React has drawn the new width, before the browser paints: keep the anchor in place
    useLayoutEffect(() => {
        const pending = pendingScroll.current;
        const viewport = viewportRef.current;
        if (!pending || !viewport) return;
        if (Math.abs(pending.next - pixelsPerBeat) > 0.001) return;
        pendingScroll.current = null;
        viewport.scrollLeft = Math.max(
            0,
            leadingInset +
                pending.anchorBeat * pixelsPerBeat -
                pending.anchorPx,
        );
    }, [leadingInset, pixelsPerBeat, viewportRef]);

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const onWheel = (event: WheelEvent) => {
            if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                const anchorPx =
                    event.clientX - viewport.getBoundingClientRect().left;
                // Lines (some mice) are about 16px each
                const delta =
                    event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
                const factor = Math.exp(-delta * WHEEL_ZOOM_RATE);
                pendingWheel.current = {
                    factor: (pendingWheel.current?.factor ?? 1) * factor,
                    anchorPx,
                };
                if (frame.current) return;
                frame.current = requestAnimationFrame(() => {
                    frame.current = 0;
                    const wheel = pendingWheel.current;
                    pendingWheel.current = null;
                    if (!wheel) return;
                    // Following, the playhead stays put on screen (UI-23)
                    const follow = followAnchor?.();
                    zoomTo(
                        latest.current.pixelsPerBeat * wheel.factor,
                        follow?.anchorPx ?? wheel.anchorPx,
                        follow?.anchorBeat,
                    );
                });
                return;
            }
            // A vertical scroll or swipe scrolls the timeline sideways, unless the tracks overflow
            // the pane and have rows to scroll
            if (wheelScrollsSideways(viewport, event.deltaX, event.deltaY)) {
                event.preventDefault();
                viewport.scrollLeft +=
                    event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
            }
        };
        viewport.addEventListener("wheel", onWheel, { passive: false });
        return () => {
            viewport.removeEventListener("wheel", onWheel);
            cancelAnimationFrame(frame.current);
            frame.current = 0;
        };
    }, [followAnchor, viewportRef, zoomTo]);

    // Never smaller than the show: a remembered zoom from a longer show, a wider window, or a
    // remembered Fit fits this one
    useEffect(() => {
        if (fitValue === null || !onPixelsPerBeatChange) return;
        if (
            (rememberedFitted || pixelsPerBeat < fitValue) &&
            Math.abs(pixelsPerBeat - fitValue) > 0.01
        ) {
            autoFitted.current = true;
            onPixelsPerBeatChange(fitValue);
            const viewport = viewportRef.current;
            if (viewport) viewport.scrollLeft = 0;
        }
        // Only when the fit itself changes, or on the first measure
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fitValue]);

    // Remember whether the timeline is fitted, so the next show opens fitted too. Not in the
    // commit where the effect above fits a resize: the zoom here is still the old one, and
    // writing "not fitted" then "fitted" again would save twice on every resize.
    useEffect(() => {
        if (autoFitted.current) {
            autoFitted.current = false;
            return;
        }
        if (fitValue === null || rememberedFitted === isFitted) return;
        onFittedChange?.(isFitted);
    }, [fitValue, isFitted, onFittedChange, rememberedFitted]);

    // The same function across zooms and beats, so the transport and the Shift+Z listener stay put
    const fit = useLatestCallback(() => {
        const viewport = viewportRef.current;
        if (!viewport || !onPixelsPerBeatChange || fitValue === null) return;
        if (isFitted) {
            const back = fitBackZoom(zoomBeforeFit.current, fitValue, maxScale);
            zoomBeforeFit.current = null;
            // Back about the playhead, where the work is
            zoomTo(back, viewport.clientWidth / 2, playheadBeat);
            return;
        }
        zoomBeforeFit.current = pixelsPerBeat;
        onPixelsPerBeatChange(fitValue);
        viewport.scrollLeft = 0;
    })!;

    // Shift+Z fits, or goes back, unless a text field, popover, menu or dialog has the keys
    useEffect(() => {
        if (!onPixelsPerBeatChange) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (
                event.key.toLowerCase() !== "z" ||
                !event.shiftKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.altKey ||
                event.repeat ||
                isTyping(event.target) ||
                overlayOpen()
            )
                return;
            event.preventDefault();
            fit();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [fit, onPixelsPerBeatChange]);

    return { fit, fitted: isFitted, viewportWidth };
};

const navigateToPage = ({
    direction,
    currentBeat,
    pages,
    beatCount,
}: {
    direction: TimelineNavigation;
    currentBeat: number;
    pages: TimelineCommonProps["model"]["pages"];
    beatCount: number;
}) => {
    if (direction === "previous-beat") return Math.max(currentBeat - 1, 0);
    if (direction === "next-beat") return Math.min(currentBeat + 1, beatCount);
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
                      beatCount: props.model.beatCount,
                  }),
              )
        : undefined);

/**
 * The waveform lane (UI-12): the waveform in the rest tone, with the played tone laid over it up
 * to the playhead. While playing the played part follows the live position every frame by
 * resizing its clip, so the canvases are never redrawn for it.
 */
const TimelineWaveformLane = memo(function TimelineWaveformLane({
    canvas,
    top,
    width,
    height,
    axis,
    positionBeat,
    livePositionBeat,
    scrubLine,
    children,
}: {
    /** The waveform in one tone: per count on the normal axis, in seconds in the Align view */
    canvas: (tone: "played" | "rest") => ReactNode;
    top: number;
    width: number;
    height: number;
    axis: TimelineXAxis;
    positionBeat: number;
    livePositionBeat?: () => number | null;
    /** While a scrub is down, the played part follows its line (`scrubLineBeat`) */
    scrubLine?: TimelineLiveValue<number | null>;
    /** Drawn over the waveform, such as the Align view's count lines */
    children?: ReactNode;
}) {
    const playedRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const played = playedRef.current;
        if (!played) return;
        if (!livePositionBeat) {
            const draw = () => {
                const beat = scrubLine?.get() ?? positionBeat;
                played.style.width = `${Math.max(0, axis.x(beat))}px`;
            };
            draw();
            return scrubLine?.subscribe(draw);
        }
        // While playing, and under the pointer while it is down on the timeline (`TimelinePlayhead`)
        const draw = () => {
            const beat = scrubLine?.get() ?? livePositionBeat() ?? positionBeat;
            played.style.width = `${Math.max(0, axis.x(beat))}px`;
        };
        let frame = 0;
        const update = () => {
            draw();
            frame = requestAnimationFrame(update);
        };
        update();
        const unsubscribe = scrubLine?.subscribe(draw);
        return () => {
            cancelAnimationFrame(frame);
            unsubscribe?.();
        };
    }, [axis, livePositionBeat, positionBeat, scrubLine]);
    return (
        <div
            className="rounded-4 pointer-events-none absolute left-0 overflow-hidden"
            style={{ top, width, height }}
        >
            {canvas("rest")}
            <div
                ref={playedRef}
                className="absolute inset-y-0 left-0 overflow-hidden"
            >
                {canvas("played")}
            </div>
            {children}
        </div>
    );
});

const sameInteraction = (
    a: TimelineSelectionInteraction | null,
    b: TimelineSelectionInteraction | null,
) =>
    a === b ||
    (a !== null &&
        b !== null &&
        sameRange(a.range, b.range) &&
        a.activeHandle === b.activeHandle &&
        a.dragging === b.dragging);

/**
 * The window's count and Create Track, beside the window's end, or its start while the start flag
 * is dragged. It follows a dragged flag (`interaction`) on its own, without re-rendering the
 * timeline on each move.
 */
const TimelineSelectionActions = memo(function TimelineSelectionActions({
    model,
    range,
    interaction,
    axis,
    expanded,
    snapBeats,
    createTrackTarget,
    onCreateTrack,
}: {
    model: TimelineCommonProps["model"];
    range: TimelineBeatRange;
    interaction: TimelineLiveValue<TimelineSelectionInteraction | null>;
    axis: TimelineXAxis;
    expanded: boolean;
    snapBeats: readonly number[];
    /** What Create Track would make a track for; `null` hides it */
    createTrackTarget: TimelineTarget | null | undefined;
    onCreateTrack: TimelineCommonProps["onCreateTrack"];
}) {
    const current = useLiveValue(interaction);
    const displayedRange = current?.range ?? range;
    const dragging = current?.dragging ?? false;
    const countFollowsStart = dragging && current?.activeHandle === "start";
    const countRendersToLeft = countFollowsStart
        ? displayedRange.startBeatIndex > 0
        : displayedRange.endBeatIndex >= model.beatCount;
    // UI-13: the window's count shows while a handle is dragged, or when the window starts off a
    // page line; from a page line, it is the playhead's count, which the transport already shows.
    // Past the last flag it shows anyway: the designer reads off how long the next page would be
    const showWindowCount =
        dragging ||
        !snapBeats.includes(displayedRange.startBeatIndex) ||
        isPastLastFlag(model, displayedRange.endBeatIndex);
    const showCreateTrack = createTrackTarget != null && !dragging;
    return (
        <div
            data-testid="timeline-selection-actions"
            className="absolute z-40 flex flex-col gap-4"
            style={{
                left:
                    axis.x(
                        countFollowsStart
                            ? displayedRange.startBeatIndex
                            : displayedRange.endBeatIndex,
                    ) + (countRendersToLeft ? -6 : 6),
                top: TIMELINE_PAGE_ROW_BOTTOM + (expanded ? 3 : 1),
                alignItems: countRendersToLeft ? "flex-end" : "flex-start",
                transform: countRendersToLeft ? "translateX(-100%)" : undefined,
            }}
        >
            {showWindowCount && (
                <span
                    data-testid="timeline-selection-count"
                    className={clsx(
                        "border-stroke bg-bg-1 text-text rounded-6 border font-mono whitespace-nowrap",
                        expanded
                            ? "px-8 py-2 text-[10px]"
                            : "px-6 py-0 text-[9px]",
                    )}
                >
                    {getWindowCountLabel(model, displayedRange)}
                </span>
            )}
            {showCreateTrack && (
                <button
                    type="button"
                    data-timeline-interactive="true"
                    onClick={() =>
                        onCreateTrack?.({
                            target: createTrackTarget,
                            range: displayedRange,
                        })
                    }
                    className="bg-accent text-text-invert rounded-full px-8 py-3 text-[11px] leading-none whitespace-nowrap"
                >
                    Create Track
                </button>
            )}
        </div>
    );
});

/**
 * Shown at the edge the playhead is off (UI-23), playing or stopped: a click brings the view back
 * to it, and following resumes.
 */
const TimelinePlayheadChip = memo(function TimelinePlayheadChip({
    side,
    top,
    onClick,
}: {
    side: "left" | "right";
    top: number;
    onClick: () => void;
}) {
    const Caret = side === "left" ? CaretLeftIcon : CaretRightIcon;
    return (
        <button
            type="button"
            data-testid="timeline-playhead-chip"
            data-side={side}
            aria-label="Show the playhead"
            title="Show the playhead"
            // As the transport's buttons: a click doesn't take keyboard focus, so Space after it
            // is still the app's Play, not a second press of the chip
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClick}
            className={clsx(
                "bg-bg-1 border-stroke text-text hover:text-accent focus-visible:ring-accent absolute z-[70] flex items-center gap-2 rounded-full border px-8 py-2 text-[11px] leading-none whitespace-nowrap shadow-sm outline-hidden focus-visible:ring-2",
                side === "left"
                    ? "left-12 flex-row"
                    : "right-12 flex-row-reverse",
            )}
            style={{ top }}
        >
            <Caret size={10} weight="bold" />
            Playhead
        </button>
    );
});
/** The Align view's px/s on entering it, before any zoom (no playhead count to keep) */
const ALIGN_DEFAULT_PX_PER_SECOND = 32;
/**
 * The Align surface stays under this many pixels. It kept whole-width canvases under the browser's
 * canvas limit at 2× density; every Align canvas now draws only a viewport window, so this only
 * caps how far the view zooms in
 */
const ALIGN_MAX_SURFACE_PX = 16000;

/** The most px/s the Align view zooms to for a surface `extent` seconds long */
const alignMaxScale = (extent: number) =>
    Math.max(
        ALIGN_MIN_PX_PER_SECOND,
        Math.min(
            ALIGN_MAX_PX_PER_SECOND,
            extent > 0
                ? ALIGN_MAX_SURFACE_PX / extent
                : ALIGN_MAX_PX_PER_SECOND,
        ),
    );

const NO_SYNCED: readonly number[] = [];

const TimelineSurface = memo(function TimelineSurface({
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
        align,
    } = props;
    // UI-19 Basic: one row of page boxes with the music inside them; sized as expanded
    const basic = density === "basic";
    const expanded = density !== "collapsed";
    const viewportRef = useRef<HTMLDivElement>(null);
    const playheadRef = useRef<HTMLButtonElement>(null);
    const rows = useMemo(
        () => (basic ? [] : packTimelineTracks(model.tracks)),
        [basic, model.tracks],
    );
    // A move that stopped fitting a page box (the box was split, or a flag deleted) drops out of
    // the page row. A dropping clip draws in its own layer over the pinned header, so it is seen
    // leaving the page box, not sliding out from under the bar; the other clips stay under it
    const { drops: clipDrops, land: endDrop } = useClipDrops(
        model.tracks,
        props.pageMoves,
    );
    // The page row where the drops start, in the tracks' coordinates: the pane may be scrolled
    // down. Read once for the drops, so scrolling mid-drop doesn't restart them
    const dropFrom = useMemo(
        () =>
            clipDrops.size === 0
                ? 0
                : (viewportRef.current?.scrollTop ?? 0) + TIMELINE_PAGE_ROW_TOP,
        [clipDrops],
    );
    const snapBeats = useMemo(
        () =>
            getPageSnapBeats({
                pages: model.pages,
                beatCount: model.beatCount,
            }),
        [model.beatCount, model.pages],
    );
    const initialPageWidth = model.pages.some((page) => page.isInitial)
        ? TIMELINE_INITIAL_PAGE_WIDTH
        : 0;

    // The Align view (E7): the same lanes on a seconds axis. Off, nothing below changes the view.
    const alignOn = align?.on === true;
    const alignOffset = align?.offset ?? 0;
    const alignDurations = align?.durations;
    const envelope = align?.envelope ?? null;
    const envelopeSeconds = envelope
        ? envelope.peaks.length / envelope.rate
        : 0;
    const baseTimes = useMemo(
        () => (alignDurations ? viewTimes(alignDurations, alignOffset) : null),
        [alignDurations, alignOffset],
    );
    const alignPages = useMemo(
        () =>
            toAlignPages(
                model.pages,
                model.beatCount,
                alignOffset,
                model.measures,
            ),
        [alignOffset, model.beatCount, model.measures, model.pages],
    );
    const alignPlaceMeasures = useMemo(
        () => alignMeasures(model.measures, alignOffset),
        [alignOffset, model.measures],
    );
    const timesUsable =
        baseTimes !== null && baseTimes.length === model.beatCount + 1;
    const showAlign = alignOn && timesUsable;
    const rawExtent = timesUsable
        ? Math.max(baseTimes[baseTimes.length - 1] ?? 0, envelopeSeconds)
        : 0;
    const alignCeiling = alignMaxScale(rawExtent);
    const [ownPixelsPerSecond, setPixelsPerSecond] = useState(() =>
        timesUsable
            ? alignPixelsPerSecond(
                  pixelsPerBeat,
                  alignDurations?.[Math.round(positionBeat) + alignOffset] ??
                      null,
              )
            : ALIGN_DEFAULT_PX_PER_SECOND,
    );
    const pixelsPerSecond = Math.min(ownPixelsPerSecond, alignCeiling);
    const baseAxis = useMemo(
        () =>
            showAlign
                ? secondsAxis({
                      times: baseTimes,
                      pixelsPerSecond,
                      minExtent: envelopeSeconds,
                  })
                : countsAxis(pixelsPerBeat, model.beatCount),
        [
            baseTimes,
            envelopeSeconds,
            model.beatCount,
            pixelsPerBeat,
            pixelsPerSecond,
            showAlign,
        ],
    );
    const t = alignT;
    const playheadTime = baseAxis.toUnit(positionBeat);
    const alignEdit = useAlignEdit({
        align,
        pages: alignPages,
        measures: alignPlaceMeasures,
        pixelsPerSecond,
        playheadTime,
        viewportRef,
        t,
    });
    const preview = showAlign ? alignEdit.preview : null;
    // While dragging, the counts draw where the edit puts them; the music stays put
    const axis = useMemo(
        () =>
            preview
                ? secondsAxis({
                      times: viewTimes(preview.durations, alignOffset),
                      pixelsPerSecond,
                      origin: preview.origin,
                      minExtent: baseAxis.extent,
                  })
                : baseAxis,
        [alignOffset, baseAxis, pixelsPerSecond, preview],
    );
    // E9: punch-in tap, drawn over the stored timing so the playhead stays on the music
    const punchSelection = useMemo(
        () =>
            selection?.kind === "range"
                ? {
                      start: selection.range.startBeatIndex,
                      end: selection.range.endBeatIndex,
                  }
                : null,
        [selection],
    );
    const punch = usePunchTap({
        align,
        pages: alignPages,
        active: showAlign,
        isPlaying: props.isPlaying ?? false,
        positionBeat,
        selection: punchSelection,
    });
    const punchPreview = punch?.preview ?? null;
    const punchAxis = useMemo(
        () =>
            punchPreview
                ? secondsAxis({
                      times: viewTimes(punchPreview.durations, alignOffset),
                      pixelsPerSecond,
                      origin: punchPreview.origin,
                      minExtent: baseAxis.extent,
                  })
                : null,
        [alignOffset, baseAxis.extent, pixelsPerSecond, punchPreview],
    );
    // Leaving Align drops a drag in progress
    const cancelAlignEdit = alignEdit.cancel;
    useEffect(() => {
        if (!showAlign) cancelAlignEdit();
    }, [cancelAlignEdit, showAlign]);

    const width = axis.width;
    // The owner draws the counts on past where playback stops, with some room (endless counts,
    // EC-9), so the surface is as wide as the counts
    const surfaceWidth =
        Math.max(width + TIMELINE_END_INSET, baseAxis.width) + initialPageWidth;
    const showWaveform = showAlign
        ? envelope !== null
        : model.waveform.peaksByBeat.some((peaks) => peaks.length > 0);
    const waveformStyle = useUiSettingsStore(
        (state) => state.uiSettings.timelineWaveformStyle,
    );
    const rowsLayout = getTimelineRows({
        expanded,
        showWaveform,
        rowCount: rows.length,
    });
    // Basic (UI-19): under each box's header (the page row) its body: the measure numbers, the
    // waveform, then the count ticks along the bottom. With no waveform (no audio, or hidden in
    // settings) the body is just the measure numbers and the ticks, so it is shorter
    const basicBodyHeight = showWaveform ? 60 : 30;
    const basicMeasureRow = 18;
    const basicAudioTop = TIMELINE_PAGE_ROW_BOTTOM + basicMeasureRow;
    const basicWaveformHeight = basicBodyHeight - basicMeasureRow - 12;
    const { rowPitch, trackHeight, clipHitHeight } = rowsLayout;
    // The measure row under the page boxes (as `getTimelineRows`), where the simple-defaults
    // study's mid-page ticks sit
    const railHeight = expanded ? 20 : 17;
    const audioTop = basic ? basicAudioTop : rowsLayout.audioTop;
    const countsWaveformHeight = basic
        ? basicWaveformHeight
        : rowsLayout.waveformHeight;
    // The Align view's waveform is what's being edited, so it's taller (11-ui.md A)
    const waveformHeight = showAlign
        ? expanded
            ? 64
            : 24
        : countsWaveformHeight;
    const extraWaveform = showWaveform
        ? waveformHeight - countsWaveformHeight
        : 0;
    const trackTop =
        (basic
            ? showWaveform
                ? basicAudioTop + basicWaveformHeight + 4
                : basicAudioTop
            : rowsLayout.trackTop) + extraWaveform;
    const timelineHeight =
        (basic
            ? TIMELINE_PAGE_ROW_BOTTOM + basicBodyHeight
            : rowsLayout.timelineHeight) + extraWaveform;
    // The pane can be taller than the tracks (the splitter): the grid, page lines and playhead
    // fill it, the track rows keep their height. Only a pane with its own height: a fitted pane
    // is as tall as the surface (`TimelinePaneStretchContext`)
    const viewportHeight = useElementHeight(viewportRef);
    const stretch = useContext(TimelinePaneStretchContext);
    // Lanes in place of the clip rows (Visuals mode's cue lanes, performer-behavior.md 7.1)
    const band = basic ? undefined : props.band;
    const contentHeight = band ? trackTop + band.height : timelineHeight;
    const surfaceHeight = stretch
        ? Math.max(contentHeight, viewportHeight)
        : contentHeight;
    // The ruler, measure row and the layers spanning the pane stay pinned at the viewport's top
    // while the tracks scroll under them, so they are as tall as the visible pane
    const pinnedHeight =
        viewportHeight > 0
            ? Math.min(viewportHeight, surfaceHeight)
            : surfaceHeight;
    const selectionRange = getSelectionRange(selection);
    // A dragged start flag's range: only the window's count reads it (`TimelineSelectionActions`)
    const [selectionInteraction] = useState(() =>
        createLiveValue<TimelineSelectionInteraction | null>(
            null,
            sameInteraction,
        ),
    );
    const selectionIdentity = selection?.kind ?? "none";
    useEffect(() => {
        selectionInteraction.set(null);
    }, [
        selectionInteraction,
        selectionIdentity,
        selectionRange?.endBeatIndex,
        selectionRange?.startBeatIndex,
    ]);
    // The follow below needs the zoom's viewport width, and the zoom asks the follow where to
    // anchor; this stable callback breaks the cycle, and is only called once both exist
    const followAnchor = useLatestCallback(() => follow.zoomAnchor())!;
    const zoom = useTimelineZoom({
        viewportRef,
        pixelsPerBeat: showAlign ? pixelsPerSecond : pixelsPerBeat,
        // Fit fits up to where playback stops (endless counts rule 7), not the counts drawn past it
        beatCount: showAlign
            ? fitSeconds(baseAxis, props.fitBeatCount)
            : (props.fitBeatCount ?? model.beatCount),
        leadingInset: initialPageWidth,
        trailingInset: TIMELINE_END_INSET,
        playheadBeat: showAlign ? playheadTime : positionBeat,
        onPixelsPerBeatChange: showAlign
            ? setPixelsPerSecond
            : props.onPixelsPerBeatChange,
        // Align has its own zoom; the remembered Fit is the normal timeline's
        fitted: showAlign ? undefined : props.zoomFitted,
        onFittedChange: showAlign ? undefined : props.onZoomFittedChange,
        ...(showAlign
            ? { minScale: ALIGN_MIN_PX_PER_SECOND, maxScale: alignCeiling }
            : {}),
        followAnchor: showAlign ? undefined : followAnchor,
    });
    // UI-23: the view follows the playhead
    const follow = useTimelineFollow({
        viewportRef,
        viewportWidth: zoom.viewportWidth,
        contentWidth: surfaceWidth,
        pixelsPerBeat,
        inset: initialPageWidth,
        pages: model.pages,
        beatCount: model.beatCount,
        // The follow works in counts; the Align view doesn't follow the playhead
        isPlaying: showAlign ? false : props.isPlaying,
        positionBeat,
        livePositionBeat: props.livePositionBeat,
        loop: props.playLoops ? (props.loop ?? null) : null,
        selectionRange,
    });

    // Switching axes keeps the playhead at the same screen x (11-ui.md A)
    const lastAxis = useRef(baseAxis);
    useLayoutEffect(() => {
        const before = lastAxis.current;
        lastAxis.current = baseAxis;
        const viewport = viewportRef.current;
        if (!viewport || before.kind === baseAxis.kind) return;
        viewport.scrollLeft = scrollKeepingBeat({
            beat: positionBeat,
            before,
            after: baseAxis,
            scrollLeft: viewport.scrollLeft,
        });
        // Only on a switch; the playhead is read as it is then
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [baseAxis]);

    // A toggles Align (never while typing, in a menu, or when the key is someone else's)
    const toggleAlign = useCallback(
        (on: boolean) => {
            if (!align) return;
            if (on && !align.on && timesUsable)
                setPixelsPerSecond(
                    Math.min(
                        alignPixelsPerSecond(
                            pixelsPerBeat,
                            align.durations[
                                Math.min(
                                    Math.floor(positionBeat),
                                    model.beatCount - 1,
                                ) + alignOffset
                            ] ?? null,
                        ),
                        alignCeiling,
                    ),
                );
            align.onToggle(on);
        },
        [
            align,
            alignCeiling,
            alignOffset,
            model.beatCount,
            pixelsPerBeat,
            positionBeat,
            timesUsable,
        ],
    );
    const alignKeyBlocked = align?.keyBlocked === true;
    useEffect(() => {
        if (!align) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (
                event.key.toLowerCase() !== "a" ||
                event.ctrlKey ||
                event.metaKey ||
                event.altKey ||
                event.shiftKey ||
                event.repeat ||
                alignKeyBlocked ||
                isTyping(event.target) ||
                overlayOpen()
            )
                return;
            event.preventDefault();
            toggleAlign(!align.on);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [align, alignKeyBlocked, toggleAlign]);

    // Endless counts rule 7: say how wide a screen is, for the room past the end. The owner turns
    // the width into counts with the counts zoom; the Align view has its own zoom, so there the
    // width is scaled to hold as many counts at the counts zoom (in whole powers of two, so a pinch
    // in Align re-reports a few times, not every frame)
    const alignZoomRatio = showAlign
        ? pixelsPerBeat / axis.pxPerBeatAt(Math.max(model.beatCount - 1, 0))
        : 1;
    const alignExtentScale =
        Number.isFinite(alignZoomRatio) && alignZoomRatio > 0
            ? 2 ** Math.round(Math.log2(alignZoomRatio))
            : 1;
    const reportExtent = props.onViewportExtent;
    const onViewportExtent = useMemo(
        () =>
            reportExtent && alignExtentScale !== 1
                ? (extent: { width: number }) =>
                      reportExtent({ width: extent.width * alignExtentScale })
                : reportExtent,
        [alignExtentScale, reportExtent],
    );
    useViewportExtent(viewportRef, onViewportExtent);
    // Past the last page's flag, **+ Add N-Count Page** adds the page from it to the playhead
    const lastFlagBeat = Math.min(
        model.beatCount,
        model.pages.reduce(
            (end, page) => Math.max(end, page.endBeat ?? page.atBeat),
            0,
        ),
    );
    // Not in Align, where the ruler's flags retime counts: adding a page is a Normal-view edit
    const appendAtPlayhead =
        props.isPlaying || showAlign ? undefined : props.appendAtPlayhead;
    // The owner seeks on a selection (UI-9: to a range's end, or home's beat 0)
    const onSelectionChange = useLatestCallback(props.onSelectionChange);
    // UI-12: clicks and scrubs land on a nearby downbeat or page line; Basic's on any count
    // (UI-19: a mid-page edit happens at a count)
    const seekSnapBeats = useMemo(
        () =>
            basic
                ? Array.from({ length: model.beatCount + 1 }, (_, b) => b)
                : [
                      ...new Set([
                          ...snapBeats,
                          ...model.measures.map((measure) => measure.atBeat),
                      ]),
                  ].sort((a, b) => a - b),
        [basic, model.beatCount, model.measures, snapBeats],
    );
    // A dragged page flag also lands on the playhead when near; read when a drag starts, so the
    // ruler doesn't re-render as the playhead moves
    const playheadAt = useLatestCallback(() => positionBeat)!;
    const pointer = useTimelinePointer({
        seekSnapBeats,
        onSeek: props.onSeek,
        // Basic and a read-only timeline draw no ranges: every drag scrubs
        onRangeSelect:
            onSelectionChange && !basic && !props.readOnly
                ? (range) =>
                      onSelectionChange({ kind: "range", range, drawn: true })
                : undefined,
        axis,
        beatCount: model.beatCount,
        snapBeats,
    });
    const onNavigate = useLatestCallback(transportNavigation(props));
    // A clip is its timeline: clicking it selects that range (UI-12)
    const selectTrack = useLatestCallback(
        onSelectionChange
            ? (
                  trackId: TimelineTrackId,
                  options?: { readonly extend?: boolean },
              ) => {
                  const track = model.tracks.find((t) => t.id === trackId);
                  const range = track && getTrackRange(track);
                  if (range)
                      onSelectionChange({
                          kind: "range",
                          range,
                          ...(options?.extend ? { extend: true } : {}),
                          // UI-25: the clip's own move, though another may share its range
                          ...(track.linkId === undefined
                              ? {}
                              : { timelineId: Number(track.linkId) }),
                      });
              }
            : undefined,
    );
    const commitSelection = useLatestCallback(
        onSelectionChange
            ? (range: TimelineBeatRange) =>
                  onSelectionChange({ kind: "range", range })
            : undefined,
    );
    // UI-14: the clip whose inline name field is open
    const [renaming, setRenaming] = useState<string | null>(null);
    const { moveCommands } = props;
    // Stable, so the memoized clips don't redraw on every render
    const startRename = useCallback(
        (trackId: TimelineTrackId) => setRenaming(String(trackId)),
        [],
    );
    const endRename = useCallback(() => setRenaming(null), []);
    const moveActions = (trackId: TimelineTrackId) =>
        moveCommands && {
            onEdit: () => moveCommands.onEdit(trackId),
            onRename: () => setRenaming(String(trackId)),
            onDelete: () => moveCommands.onDelete(trackId),
            // UI-27
            ...(moveCommands.onSplit
                ? { onSplit: () => moveCommands.onSplit!(trackId) }
                : {}),
            ...(moveCommands.splitDisabledReason
                ? {
                      splitDisabledReason: () =>
                          moveCommands.splitDisabledReason!(trackId),
                  }
                : {}),
            disabledReason: moveCommands.disabledReason,
            ...(moveCommands.extraFor
                ? { extra: () => moveCommands.extraFor!(trackId) }
                : {}),
        };
    // Align: "Even out page 5" and "Tempo… [120]" on a page box (11-ui.md B)
    const [tempoPrompt, setTempoPrompt] = useState<{
        page: AlignPage;
        x: number;
        y: number;
    } | null>(null);
    const closeTempoPrompt = useCallback(() => setTempoPrompt(null), []);
    const alignMenuItems = (
        target: TimelineMenuTarget,
    ): TimelineMenuExtraItem[] => {
        if (!showAlign || !align || target.pageId === undefined) return [];
        const page = alignPages.find((p) => String(p.id) === target.pageId);
        if (!page || page.end <= page.start) return [];
        const bpm = formatTempo(
            align.durations,
            page.start,
            page.end,
            align.tempoMap?.units,
        );
        return [
            {
                id: "even-out",
                label: t("tempo.align.evenOut", { page: page.label }),
                onSelect: () => {
                    const next = evenOutPage(align.durations, page);
                    const write = () =>
                        void align.onRetime({
                            durations: next,
                            originShift: 0,
                            synced: align.synced,
                        });
                    // A typed rit. evened out is a typed tempo changed: ask first (DE-3)
                    const typed = overriddenSections(
                        align.tempoMap?.sections ?? [],
                        align.durations,
                        next,
                    )[0];
                    if (!typed) return write();
                    toast.warning(
                        t("tempo.align.override.question", {
                            tempo: typed.tempo,
                            measures: typed.measures,
                        }),
                        {
                            action: {
                                label: t("tempo.align.override.confirm"),
                                onClick: write,
                            },
                        },
                    );
                },
            },
            {
                id: "tempo",
                label: t("tempo.align.tempoItem", { bpm: bpm ?? "–" }),
                // After the menu has closed and handed focus back
                onSelect: ({ x, y }) =>
                    setTimeout(() => setTempoPrompt({ page, x, y }), 0),
            },
        ];
    };
    // Tempo E8: rehearsal marks and measure lines on the measure row
    const measureRow = props.measureRow;
    const markTop = TIMELINE_PAGE_ROW_BOTTOM + (expanded ? 2 : 1);
    const editing = useMeasureRowEditing({
        model,
        commands: measureRow,
        positionBeat,
        livePositionBeat: props.livePositionBeat,
        isPlaying: props.isPlaying,
        onPlayingChange: props.onPlayingChange,
    });
    const menu: TimelineAddMarchersMenu<TimelineMenuTarget> | undefined =
        measureRow
            ? {
                  ...props.addSelectedMarchers,
                  measureRowItems: (target) => (
                      <MeasureRowMenuItems
                          target={target}
                          model={model}
                          commands={measureRow}
                          onEditor={editing.setEditor}
                          onEditMark={editing.editMark}
                          onSeek={props.onSeek}
                      />
                  ),
              }
            : props.addSelectedMarchers;
    // The right-click menu's target: the measure row's count, measure or tab under the pointer;
    // else a page box or clip under the pointer, else a dragged range the pointer is inside (UI-9
    // Adding marchers, Creating a timeline)
    // Without the measure row's own targets (E8), the measure under the pointer, for count edits
    // (or the one starting at `atBeat`, a measure number's downbeat)
    const measureRangeAt = (
        event: MouseEvent<HTMLElement>,
        rowHeight: number,
        atBeat?: number,
    ) => {
        const surface = event.currentTarget.querySelector(
            '[data-testid="timeline-pointer-surface"]',
        );
        if (!surface) return null;
        const bounds = surface.getBoundingClientRect();
        const y = event.clientY - bounds.top;
        if (
            atBeat === undefined &&
            (y < TIMELINE_PAGE_ROW_BOTTOM ||
                y > TIMELINE_PAGE_ROW_BOTTOM + rowHeight)
        )
            return null;
        const beat = atBeat ?? axis.beatAt(event.clientX - bounds.left);
        const ordered = [...model.measures].sort((a, b) => a.atBeat - b.atBeat);
        const index = ordered.findLastIndex((m) => m.atBeat <= beat);
        if (index < 0) return null;
        const start = ordered[index]!.atBeat;
        const end = ordered[index + 1]?.atBeat ?? model.beatCount;
        if (end <= start || beat > end) return null;
        return {
            range: { startBeatIndex: start, endBeatIndex: end },
            measure: ordered[index]!.label.replace(/^m/i, "m"),
        };
    };
    // The drawn range the pointer is inside, if any
    const drawnRangeAt = (event: MouseEvent<HTMLElement>) => {
        if (selection?.kind !== "range" || !selectionRange) return null;
        const surface = event.currentTarget.querySelector(
            '[data-testid="timeline-pointer-surface"]',
        );
        if (!surface) return null;
        const beat = axis.beatAt(
            event.clientX - surface.getBoundingClientRect().left,
        );
        return beat >= selectionRange.startBeatIndex &&
            beat <= selectionRange.endBeatIndex
            ? selectionRange
            : null;
    };
    const measureLabelAt = (beat: number) => {
        const label = model.measures.find((m) => m.atBeat === beat)?.label;
        return label?.replace(/^m/i, "m");
    };
    const menuTargetAt = (
        event: MouseEvent<HTMLElement>,
    ): TimelineMenuTarget | null => {
        const pointerSurface = event.currentTarget.querySelector(
            '[data-testid="timeline-pointer-surface"]',
        );
        const onRow =
            measureRow && pointerSurface
                ? measureRowTargetAt({
                      event,
                      surface: pointerSurface,
                      model,
                      axis,
                      rowTop: TIMELINE_PAGE_ROW_BOTTOM,
                      rowHeight: railHeight + 2,
                  })
                : null;
        if (onRow) {
            // A measure, its tab or its number (the count tick on its downbeat) names the
            // measure, so count edits (E10) act on all of it; another count offers no cut
            const measure = measureLabelAt(onRow.range.startBeatIndex);
            if (onRow.target.kind !== "count")
                return {
                    range: onRow.range,
                    measureRow: onRow.target,
                    measure,
                };
            const whole = measure
                ? measureRangeAt(event, railHeight, onRow.target.beat)
                : null;
            return whole
                ? { ...whole, measureRow: onRow.target }
                : { range: onRow.range, measureRow: onRow.target };
        }
        const marked = markedRangeAt(event.target);
        if (marked) return marked;
        // The measure row: the measure under the pointer, for count edits (E10)
        const measure = props.addSelectedMarchers?.onRemoveCounts
            ? measureRangeAt(event, railHeight)
            : null;
        return measure ?? null;
    };
    const rangeMenu = useTimelineRangeMenu({
        menu,
        movesFor: moveCommands
            ? (trackId) => {
                  const track = model.tracks.find(
                      (t) => String(t.id) === trackId,
                  );
                  return track ? (moveActions(track.id) ?? null) : null;
              }
            : undefined,
        extraItems: align ? alignMenuItems : undefined,
        resolveRange: (event: MouseEvent<HTMLElement>) => {
            // Basic (UI-19): only page boxes have a menu; the window isn't drawn
            if (basic) return markedRangeAt(event.target);
            const target = menuTargetAt(event);
            // A drawn range under the pointer is the cut whatever else is there: ruler, measure
            // row, waveform or a clip
            const cut = drawnRangeAt(event);
            if (!target) {
                if (cut) return { range: cut, cut };
                // Empty space, with count edits on: a menu that can add counts at the playhead
                // and says how to draw a cut
                if (!props.addSelectedMarchers?.onRemoveCounts) return null;
                const surface = event.currentTarget.querySelector(
                    '[data-testid="timeline-pointer-surface"]',
                );
                if (!surface) return null;
                const beat = Math.floor(
                    axis.beatAt(
                        event.clientX - surface.getBoundingClientRect().left,
                    ),
                );
                if (beat < 0 || beat >= model.beatCount) return null;
                return {
                    range: { startBeatIndex: beat, endBeatIndex: beat + 1 },
                    blank: true,
                };
            }
            return cut ? { ...target, cut } : target;
        },
    });

    // Align's pieces: which counts are downbeats and flags, and the page tempo notes
    const downbeats = useMemo(
        () => new Set(model.measures.map((measure) => measure.atBeat)),
        [model.measures],
    );
    const flags = useMemo(() => alignFlags(alignPages), [alignPages]);
    const flagCounts = useMemo(
        () => new Set(flags.map((flag) => flag.index)),
        [flags],
    );
    const shownDurations = preview?.durations ?? alignDurations;
    const pageNote =
        showAlign && shownDurations
            ? (page: TimelinePageMarker) => {
                  const p = alignPages.find((ap) => ap.id === page.id);
                  return p
                      ? formatTempo(
                            shownDurations,
                            p.start,
                            p.end,
                            align?.tempoMap?.units,
                        )
                      : null;
              }
            : undefined;
    const readoutTempo =
        showAlign && alignDurations
            ? countTempoText(
                  alignDurations,
                  Math.min(Math.floor(positionBeat), model.beatCount - 1) +
                      alignOffset,
                  align?.tempoMap?.units,
              )
            : null;
    const markHandle =
        showAlign && align
            ? (beat: number) => {
                  const index = beat + alignOffset;
                  if (index < 1 || index > align.durations.length) return null;
                  const measure = model.measures.find((m) => m.atBeat === beat);
                  const head = measure?.rehearsalMark?.trim() || undefined;
                  // Only a real drag (past the drag threshold) swallows the click: any
                  // pointer jitter used to, so clicking a tab in Align didn't seek (Jo)
                  let moved = false;
                  let pressX: number | null = null;
                  const handlers = alignEdit.dragProps("move", index, head);
                  return {
                      props: {
                          ...handlers,
                          onPointerDown: (
                              event: React.PointerEvent<HTMLElement>,
                          ) => {
                              pressX = event.clientX;
                              moved = false;
                              handlers.onPointerDown(event);
                          },
                          onPointerMove: (
                              event: React.PointerEvent<HTMLElement>,
                          ) => {
                              if (
                                  pressX !== null &&
                                  Math.abs(event.clientX - pressX) >=
                                      ALIGN_DRAG_PX
                              )
                                  moved = true;
                              handlers.onPointerMove(event);
                          },
                          title: t("tempo.align.markHandle", {
                              label: head ?? "",
                              time: formatShowTime(axis.toUnit(beat), true),
                          }),
                      },
                      consumeClick: () => {
                          const was = moved;
                          moved = false;
                          return was;
                      },
                  };
              }
            : undefined;

    /** A clip in row `rowIndex`, in the tracks or, while it drops, in the drops' layer */
    const renderClip = (track: TimelineTrack, rowIndex: number) => (
        <TimelineTrackClip
            key={track.id}
            track={track}
            axis={axis}
            top={
                trackTop +
                rowIndex * rowPitch -
                (clipHitHeight - trackHeight) / 2
            }
            height={clipHitHeight}
            barHeight={expanded ? undefined : trackHeight}
            // A clip is its timeline: it shows selected when its range is
            // the selection, and clicking it selects that range (UI-12)
            selected={
                (sameRange(getTrackRange(track), selectionRange) &&
                    // UI-25: of the moves sharing a range, the selected one
                    (selection?.kind !== "range" ||
                        selection.timelineId === undefined ||
                        track.linkId === undefined ||
                        selection.timelineId === Number(track.linkId))) ||
                (selection?.kind === "range" &&
                    track.linkId !== undefined &&
                    selection.pairedTimelineId === Number(track.linkId))
            }
            onSelect={selectTrack}
            onRangeCommit={props.onTimelineRangeCommit}
            // Edges resize, and a page's move peels, on the counts axis only (resize-move)
            resize={showAlign ? undefined : props.clipResize}
            peel={showAlign ? undefined : props.clipPeel}
            downbeats={seekSnapBeats}
            snapPlayhead={playheadAt}
            beatCount={model.beatCount}
            snapBeats={snapBeats}
            micro={!expanded}
            moveCommands={moveCommands}
            renaming={renaming === String(track.id)}
            onRenameStart={startRename}
            onRenameEnd={endRename}
            dropFrom={clipDrops.has(track.id) ? dropFrom : undefined}
            onDropEnd={endDrop}
        />
    );

    return (
        <TimelineShell
            viewportRef={viewportRef}
            className={className}
            pinnedHeight={audioTop}
            overlay={
                !showAlign &&
                follow.offscreen && (
                    <TimelinePlayheadChip
                        side={follow.offscreen}
                        top={TIMELINE_PAGE_ROW_TOP + 4}
                        onClick={follow.revealPlayhead}
                    />
                )
            }
            transport={
                showTransport ? (
                    <TimelineTransport
                        model={model}
                        clock={props.transportClock}
                        accessories={props.transportAccessories}
                        secondary={props.transportSecondary}
                        leadingViewControls={props.transportLeadingViewControls}
                        viewControls={props.transportViewControls}
                        onSeek={props.onSeek}
                        onSelectionChange={onSelectionChange}
                        positionBeat={positionBeat}
                        isPlaying={props.isPlaying}
                        onPlayingChange={props.onPlayingChange}
                        playLoops={props.playLoops}
                        onPlayFromPlayhead={props.onPlayFromPlayhead}
                        onPlayOn={props.onPlayOn}
                        onNavigate={onNavigate}
                        onFit={
                            props.onPixelsPerBeatChange ? zoom.fit : undefined
                        }
                        fitted={zoom.fitted}
                        alignControl={
                            align
                                ? (wide) => (
                                      <>
                                          {punch && (
                                              <TimelinePunchTapControls
                                                  punch={punch}
                                              />
                                          )}
                                          <TimelineAlignToggle
                                              on={align.on}
                                              onToggle={toggleAlign}
                                              showLabel={wide}
                                          />
                                      </>
                                  )
                                : undefined
                        }
                        readoutNote={readoutTempo ?? undefined}
                    />
                ) : undefined
            }
        >
            <div
                className={clsx("relative", showAlign && "bg-accent/[0.04]")}
                data-align={showAlign || undefined}
                style={{ width: surfaceWidth, height: surfaceHeight }}
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
                        height: surfaceHeight,
                    }}
                >
                    {basic && (
                        <TimelineBasicBodies
                            top={TIMELINE_PAGE_ROW_BOTTOM}
                            height={timelineHeight - TIMELINE_PAGE_ROW_BOTTOM}
                            width={width}
                        />
                    )}
                    {/* The grid and page lines under the tracks, pinned to the viewport's top
                        so they always fill the visible pane (UI-19 sticky ruler) */}
                    <div
                        data-testid="timeline-pinned-grid"
                        aria-hidden="true"
                        className="pointer-events-none sticky top-0 z-0 h-0"
                    >
                        <TimelineGridCanvas
                            width={width}
                            height={pinnedHeight}
                            axis={axis}
                            viewportRef={viewportRef}
                            layerLeft={initialPageWidth}
                            measures={model.measures}
                            lineTop={TIMELINE_PAGE_ROW_BOTTOM}
                            // The beat ticks are in the header's own canvas; Basic's along the
                            // floor of the box bodies (UI-19), below the header
                            topTickY={timelineHeight - 7}
                            showBeatTicks={basic}
                            bottomTickY={null}
                        />
                        <TimelinePageLines
                            pages={model.pages}
                            axis={axis}
                            height={pinnedHeight}
                        />
                    </div>
                    {/* The tracks: the waveform and the clip rows, the only part that scrolls
                        vertically, under the pinned ruler */}
                    <div
                        data-testid="timeline-tracks"
                        className="absolute inset-x-0 top-0 z-[1]"
                        style={{ height: surfaceHeight }}
                    >
                        {/* The waveform first, so a clip's resize tag above the first row paints
                            over it */}
                        {showWaveform && (
                            <TimelineWaveformLane
                                canvas={(tone) =>
                                    showAlign && envelope ? (
                                        <TimelineEnvelopeCanvas
                                            envelope={envelope}
                                            pixelsPerSecond={pixelsPerSecond}
                                            width={width}
                                            height={waveformHeight}
                                            viewportRef={viewportRef}
                                            layerLeft={initialPageWidth}
                                            tone={tone}
                                        />
                                    ) : (
                                        <TimelineWaveformCanvas
                                            waveform={model.waveform}
                                            width={width}
                                            height={waveformHeight}
                                            pixelsPerBeat={pixelsPerBeat}
                                            viewportRef={viewportRef}
                                            layerLeft={initialPageWidth}
                                            waveformStyle={waveformStyle}
                                            tone={tone}
                                        />
                                    )
                                }
                                top={audioTop}
                                width={width}
                                height={waveformHeight}
                                axis={axis}
                                positionBeat={positionBeat}
                                livePositionBeat={
                                    props.isPlaying
                                        ? props.livePositionBeat
                                        : undefined
                                }
                                scrubLine={pointer.scrubLine}
                            >
                                {showAlign && (
                                    <TimelineCountLinesCanvas
                                        axis={axis}
                                        downbeats={downbeats}
                                        width={width}
                                        height={waveformHeight}
                                        viewportRef={viewportRef}
                                        layerLeft={initialPageWidth}
                                    />
                                )}
                            </TimelineWaveformLane>
                        )}
                        {showWaveform && expanded && props.waveformNotice && (
                            // Full width, so the notice can stick to the viewport's left edge
                            <div
                                className="pointer-events-none absolute left-0 z-10"
                                style={{
                                    top: audioTop + 2,
                                    width,
                                    height: waveformHeight - 4,
                                }}
                            >
                                <div
                                    className="sticky left-8 inline-flex h-full"
                                    // The notice's buttons are not a seek on the lane under them
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onDoubleClick={(e) => e.stopPropagation()}
                                    onContextMenu={(e) => e.stopPropagation()}
                                >
                                    {props.waveformNotice}
                                </div>
                            </div>
                        )}
                        {showWaveform && expanded && props.waveformAction && (
                            // Full width, so the action can stick to the viewport's right edge
                            <div
                                className="pointer-events-none absolute left-0 z-10 flex justify-end"
                                style={{
                                    top: audioTop + 4,
                                    width,
                                    height: Math.min(22, waveformHeight - 8),
                                }}
                            >
                                <div
                                    className="sticky right-8 inline-flex h-full"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onDoubleClick={(e) => e.stopPropagation()}
                                    onContextMenu={(e) => e.stopPropagation()}
                                >
                                    {props.waveformAction}
                                </div>
                            </div>
                        )}
                        {rows.flatMap((row, rowIndex) =>
                            row.flatMap((track) =>
                                clipDrops.has(track.id)
                                    ? []
                                    : [renderClip(track, rowIndex)],
                            ),
                        )}
                        {band?.render({
                            top: trackTop,
                            width,
                            pixelsPerBeat,
                            beatCount: model.beatCount,
                            snapBeats: seekSnapBeats,
                        })}
                    </div>
                    {/* The clips dropping out of a page box (`useClipDrops`), over the pinned
                        header so they are seen leaving it. They take no clicks while they drop */}
                    {clipDrops.size > 0 && (
                        <div
                            data-testid="timeline-clip-drops"
                            className="pointer-events-none absolute inset-x-0 top-0 z-[3]"
                            style={{ height: surfaceHeight }}
                        >
                            {rows.flatMap((row, rowIndex) =>
                                row.flatMap((track) =>
                                    clipDrops.has(track.id)
                                        ? [renderClip(track, rowIndex)]
                                        : [],
                                ),
                            )}
                        </div>
                    )}
                    {/* Pinned to the viewport's top, over the tracks: the ruler and the measure
                        row, which hide the tracks scrolled under them, and the layers that span
                        the pane (playhead, flags, the window and the loop) */}
                    <div
                        data-testid="timeline-pinned"
                        className="sticky top-0 z-[2] h-0"
                    >
                        <div
                            data-testid="timeline-pinned-header"
                            // Opaque, so the tracks scrolled under it don't show through: the card's
                            // fg-1 is a translucent tint over bg-1. Basic has no tracks, and its
                            // box bodies show through
                            className={clsx(
                                "absolute top-0 left-0",
                                !basic && "bg-bg-1 bg-fg-1",
                            )}
                            style={{ width, height: audioTop }}
                        >
                            <TimelineGridCanvas
                                width={width}
                                height={audioTop}
                                axis={axis}
                                viewportRef={viewportRef}
                                layerLeft={initialPageWidth}
                                measures={model.measures}
                                lineTop={TIMELINE_PAGE_ROW_BOTTOM}
                                topTickY={TIMELINE_PAGE_ROW_BOTTOM + 6}
                                // UI-12: one row of beat ticks, in the measure row; Basic's are
                                // in the grid under the header
                                showBeatTicks={!basic}
                                bottomTickY={null}
                            />
                            <TimelinePageLines
                                pages={model.pages}
                                axis={axis}
                                height={audioTop}
                            />
                        </div>
                        <TimelineRuler
                            pages={model.pages}
                            measures={model.measures}
                            beatCount={model.beatCount}
                            axis={axis}
                            selection={selection}
                            onSelectionChange={onSelectionChange}
                            onSeek={props.onSeek}
                            initialPageWidth={initialPageWidth}
                            showMeasures={expanded}
                            seekSnapBeats={seekSnapBeats}
                            scrubLine={pointer.scrubLine}
                            // UI-16's grips; in Align a flag drag retimes counts (E7), and with Tempo
                            // lab drill choices E10's grips take their place (one gesture each)
                            pageFlagMove={
                                props.isPlaying ||
                                showAlign ||
                                props.drillFlagMove
                                    ? undefined
                                    : props.pageFlagMove
                            }
                            height={pinnedHeight}
                            flagSnapPlayhead={playheadAt}
                            // Only a show without measures numbers the playhead page's counts
                            positionBeat={
                                expanded &&
                                !basic &&
                                model.measures.length === 0
                                    ? positionBeat
                                    : undefined
                            }
                            holdMarks={props.holdMarks}
                            keepChains={props.keepChains}
                            pageNote={pageNote}
                            labelsTop={showAlign}
                            onMeasureClick={
                                measureRow ? editing.editMark : undefined
                            }
                        />
                        {showAlign && (
                            <TimelineAlignTimeLine
                                extent={baseAxis.extent}
                                pixelsPerSecond={pixelsPerSecond}
                            />
                        )}
                        {!showAlign && (
                            <TimelinePastEndShade
                                pages={model.pages}
                                pixelsPerBeat={pixelsPerBeat}
                                width={width}
                            />
                        )}
                        <TimelineRehearsalMarkers
                            model={model}
                            axis={axis}
                            dragHandle={markHandle}
                            top={markTop}
                            compact={!expanded}
                            onSeek={props.onSeek}
                            editingMeasureId={
                                editing.editor && "measureId" in editing.editor
                                    ? editing.editor.measureId
                                    : null
                            }
                            onEdit={measureRow ? editing.editMark : undefined}
                            onMove={
                                showAlign ? undefined : measureRow?.onMoveMark
                            }
                            onRemove={
                                measureRow
                                    ? (measure) =>
                                          measureRow.onSetMark(measure.id, null)
                                    : undefined
                            }
                        />
                        {editing.editor && (
                            <TimelineMeasureRowEditor
                                key={editing.editorKey}
                                editor={editing.editor}
                                model={model}
                                axis={axis}
                                top={markTop}
                                onCommit={editing.commit}
                                onCancel={editing.cancel}
                                onPassKey={editing.passKey}
                                canMoveMark={editing.canMoveMark}
                            />
                        )}
                        {basic && !showAlign && props.expertMarks && (
                            <TimelineBasicExpertMarks
                                pages={model.pages}
                                marks={props.expertMarks}
                                pixelsPerBeat={pixelsPerBeat}
                            />
                        )}
                        {props.basicPoints && !showAlign && (
                            <TimelineBasicPoints
                                points={props.basicPoints}
                                // In the box bodies (Basic), else across the measure row
                                top={TIMELINE_PAGE_ROW_BOTTOM}
                                height={
                                    basic
                                        ? timelineHeight -
                                          TIMELINE_PAGE_ROW_BOTTOM
                                        : railHeight
                                }
                                pixelsPerBeat={pixelsPerBeat}
                                onSeek={props.onSeek}
                                onRemove={props.onRemoveBasicPoint}
                            />
                        )}
                        {props.isPlaying &&
                            !showAlign &&
                            props.returnBeat !== undefined &&
                            showsReturnMarker(
                                props.returnBeat,
                                model.pages,
                                model.beatCount,
                                basic,
                            ) && (
                                <TimelineReturnMarker
                                    beat={props.returnBeat}
                                    pixelsPerBeat={pixelsPerBeat}
                                    height={pinnedHeight}
                                />
                            )}
                        <TimelinePlayhead
                            model={model}
                            positionBeat={positionBeat}
                            livePositionBeat={
                                props.isPlaying
                                    ? props.livePositionBeat
                                    : undefined
                            }
                            axis={axis}
                            height={pinnedHeight}
                            beatCount={model.beatCount}
                            anchorRef={playheadRef}
                            onSeek={props.onSeek}
                            isPlaying={props.isPlaying}
                            scrubLine={pointer.scrubLine}
                            onAddPage={
                                props.isPlaying
                                    ? undefined
                                    : props.onAddPageFlag
                            }
                            onAddSubsetPage={props.onAddSubsetPage}
                            addPageNames={props.addPageNames}
                        />
                        {showAlign && align && (
                            <>
                                <TimelineAlignTicks
                                    axis={axis}
                                    offset={alignOffset}
                                    durations={
                                        shownDurations ?? align.durations
                                    }
                                    pages={alignPages}
                                    flagCounts={flagCounts}
                                    top={TIMELINE_PAGE_ROW_BOTTOM}
                                    height={railHeight}
                                    dragProps={alignEdit.dragProps}
                                />
                                <TimelineAlignFlags
                                    flags={flags}
                                    axis={axis}
                                    offset={alignOffset}
                                    synced={align.synced ?? NO_SYNCED}
                                    preview={preview}
                                    dragProps={alignEdit.dragProps}
                                    onSetSynced={align.onSetSynced}
                                    onFlagClick={punch?.retarget}
                                    audioOffsetSeconds={
                                        align.audioOffsetSeconds
                                    }
                                    typedEdges={align.tempoMap?.edges}
                                    formatTime={(seconds) =>
                                        formatShowTime(seconds, true)
                                    }
                                />
                                {punch &&
                                    punchPreview &&
                                    punchAxis &&
                                    !preview && (
                                        <TimelineAlignPreviewLayer
                                            preview={punchPreview}
                                            axis={punchAxis}
                                            offset={alignOffset}
                                            pixelsPerSecond={pixelsPerSecond}
                                            top={TIMELINE_PAGE_ROW_BOTTOM}
                                            height={Math.max(
                                                0,
                                                timelineHeight -
                                                    TIMELINE_PAGE_ROW_BOTTOM,
                                            )}
                                        />
                                    )}
                                {punch && (
                                    <TimelinePunchTapLayer
                                        punch={punch}
                                        axis={axis}
                                        previewAxis={punchAxis}
                                        offset={alignOffset}
                                        pixelsPerSecond={pixelsPerSecond}
                                        height={timelineHeight}
                                    />
                                )}
                                {preview && (
                                    <>
                                        <TimelineAlignPreviewLayer
                                            preview={preview}
                                            axis={axis}
                                            offset={alignOffset}
                                            pixelsPerSecond={pixelsPerSecond}
                                            top={TIMELINE_PAGE_ROW_BOTTOM}
                                            height={Math.max(
                                                0,
                                                timelineHeight -
                                                    TIMELINE_PAGE_ROW_BOTTOM,
                                            )}
                                        />
                                        {preview.confirming ? (
                                            <TimelineAlignConfirm
                                                preview={preview}
                                                onConfirm={alignEdit.confirm}
                                                onKeep={alignEdit.keepTyped}
                                                onCancel={alignEdit.cancel}
                                            />
                                        ) : (
                                            <TimelineAlignChip
                                                preview={preview}
                                            />
                                        )}
                                    </>
                                )}
                                {tempoPrompt && (
                                    <TimelineAlignTempoPrompt
                                        page={tempoPrompt.page}
                                        x={tempoPrompt.x}
                                        y={tempoPrompt.y}
                                        align={align}
                                        onClose={closeTempoPrompt}
                                    />
                                )}
                            </>
                        )}
                        {/* E10's grips move a flag to another count; in Align the same drag
                        retimes counts (E7), so only one of them is drawn: one gesture, one
                        meaning per view (12-ux.md 3) */}
                        {props.drillFlagMove &&
                            !showAlign &&
                            !props.isPlaying && (
                                <TimelinePageFlagHandles
                                    pages={model.pages}
                                    measures={model.measures}
                                    beatCount={model.beatCount}
                                    pixelsPerBeat={pixelsPerBeat}
                                    move={props.drillFlagMove}
                                />
                            )}
                        {props.countOverlay?.({
                            toX: (count) =>
                                axis.x(
                                    count - (props.beatOffset ?? alignOffset),
                                ),
                            top: TIMELINE_PAGE_ROW_BOTTOM,
                            height: Math.max(
                                0,
                                timelineHeight - TIMELINE_PAGE_ROW_BOTTOM,
                            ),
                        })}
                        {appendAtPlayhead && (
                            <TimelineAppendAtPlayhead
                                append={appendAtPlayhead}
                                positionBeat={positionBeat}
                                lastFlagBeat={lastFlagBeat}
                                axis={axis}
                                height={pinnedHeight}
                                windowShowsPage={
                                    !basic &&
                                    sameRange(selectionRange, {
                                        startBeatIndex: lastFlagBeat,
                                        endBeatIndex: positionBeat,
                                    })
                                }
                                scrubLine={pointer.scrubLine}
                            />
                        )}
                        <TimelineRangePreview
                            preview={pointer.rangePreview}
                            axis={axis}
                            height={pinnedHeight}
                        />
                        {/* The loop bar works in counts; the Align view draws seconds */}
                        {props.loop && !showAlign && (
                            <TimelineLoopBar
                                loop={props.loop}
                                beatCount={model.beatCount}
                                pixelsPerBeat={pixelsPerBeat}
                                snapBeats={snapBeats}
                                onChange={props.onLoopChange}
                            />
                        )}
                        {props.readOnly &&
                            props.startFlagBeat !== undefined && (
                                <TimelineStartFlagMark
                                    beat={props.startFlagBeat}
                                    pixelsPerBeat={pixelsPerBeat}
                                    height={pinnedHeight}
                                />
                            )}
                        {selectionRange && !basic && (
                            <TimelineSelectionRange
                                range={selectionRange}
                                startFlagBeatIndex={
                                    selection?.kind === "range"
                                        ? selection.startFlagBeatIndex
                                        : undefined
                                }
                                beatCount={model.beatCount}
                                axis={axis}
                                height={pinnedHeight}
                                snapBeats={snapBeats}
                                onCommit={commitSelection}
                                onLineDrag={props.onSeek}
                                onInteractionChange={selectionInteraction.set}
                                positionBeat={positionBeat}
                                scrubLine={pointer.scrubLine}
                            />
                        )}
                        {selectionRange && !basic && (
                            <TimelineSelectionActions
                                model={model}
                                range={selectionRange}
                                interaction={selectionInteraction}
                                axis={axis}
                                expanded={expanded}
                                snapBeats={snapBeats}
                                createTrackTarget={
                                    selection?.kind === "range" &&
                                    props.onCreateTrack != null
                                        ? selectedTarget
                                        : null
                                }
                                onCreateTrack={props.onCreateTrack}
                            />
                        )}
                    </div>
                </div>
                {rangeMenu.element}
            </div>
        </TimelineShell>
    );
});

export const ExpandedTimeline = memo(function ExpandedTimeline(
    props: TimelineCommonProps,
) {
    return <TimelineSurface {...props} density="expanded" />;
});

/** UI-19 Basic: one row of page boxes with the music inside them (research/basic-mode) */
export const BasicTimeline = memo(function BasicTimeline(
    props: TimelineCommonProps,
) {
    return <TimelineSurface {...props} density="basic" />;
});

export const CollapsedTimeline = memo(function CollapsedTimeline(
    props: TimelineCommonProps,
) {
    return <TimelineSurface {...props} density="collapsed" />;
});
