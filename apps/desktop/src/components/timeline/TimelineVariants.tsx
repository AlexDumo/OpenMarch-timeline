import { TimelinePageFlagHandles } from "./TimelinePageFlagHandles";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type MouseEvent,
    type ReactNode,
} from "react";
import { PlusIcon } from "@phosphor-icons/react";
import clsx from "clsx";
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
    TimelineRuler,
    TimelineSelectionRange,
    type TimelineSelectionInteraction,
    TimelineShell,
    TimelineTrackClip,
    TimelineTransport,
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
    alignPages as toAlignPages,
    countTempo,
    evenOutPage,
    formatShowTime,
    formatTempo,
    viewTimes,
    type AlignPage,
} from "./timelineAlign";
import {
    alignT,
    TimelineAlignChip,
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
import type {
    TimelineCommonProps,
    TimelineNavigation,
    TimelinePageMarker,
    TimelineSelection,
} from "./TimelineViewModel";

type TimelineDensity = "expanded" | "collapsed";

/** Timeline's starting zoom, and the least a second Fit zooms in to when it can't go back */
const TIMELINE_DEFAULT_PX_PER_BEAT = 16;

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

/** No waveform past the end of the show */
const NO_PEAKS: readonly (readonly number[])[] = [];

/** About how wide **+ N counts** is, and the room kept for it after the last beat (E1) */
const APPEND_COUNTS_WIDTH = 84;
const APPEND_COUNTS_ROOM = APPEND_COUNTS_WIDTH + 16;
/** About how wide a pill in the top row is for `label` (10px text, icon and padding) */
const pillWidth = (label: string) =>
    Math.max(APPEND_COUNTS_WIDTH, Math.ceil(label.length * 5.6) + 24);

/** About how wide the note that the music runs on is, and the room kept for it (E1) */
const MUSIC_PAST_END_NOTE_WIDTH = 420;

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
    minScale = TIMELINE_MIN_PX_PER_BEAT,
    maxScale = TIMELINE_MAX_PX_PER_BEAT,
}: {
    viewportRef: React.RefObject<HTMLDivElement | null>;
    pixelsPerBeat: number;
    /** The beats Fit fits: the show's, and any music drawn past its end */
    beatCount: number;
    leadingInset: number;
    /** Pixels kept free after the last beat, for **+ N counts** */
    trailingInset?: number;
    playheadBeat: number;
    onPixelsPerBeatChange?: (pixelsPerBeat: number) => void;
    fitted?: boolean;
    onFittedChange?: (fitted: boolean) => void;
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
            change(bounded);
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
                    zoomTo(
                        latest.current.pixelsPerBeat * wheel.factor,
                        wheel.anchorPx,
                    );
                });
                return;
            }
            // A vertical scroll or swipe scrolls the timeline sideways; it has no rows to scroll
            if (
                Math.abs(event.deltaY) > Math.abs(event.deltaX) &&
                viewport.scrollWidth > viewport.clientWidth
            ) {
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
    }, [viewportRef, zoomTo]);

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

    const fit = useCallback(() => {
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
    }, [
        fitValue,
        isFitted,
        maxScale,
        onPixelsPerBeatChange,
        pixelsPerBeat,
        playheadBeat,
        viewportRef,
        zoomTo,
    ]);

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

    return { fit, fitted: isFitted };
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

/**
 * The waveform lane (UI-12): the waveform in the rest tone, with the played tone laid over it up
 * to the playhead. While playing the played part follows the live position every frame by
 * resizing its clip, so the canvases are never redrawn for it.
 */
function TimelineWaveformLane({
    canvas,
    top,
    width,
    height,
    axis,
    positionBeat,
    livePositionBeat,
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
    /** Drawn over the waveform, such as the Align view's count lines */
    children?: ReactNode;
}) {
    const playedRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const played = playedRef.current;
        if (!played) return;
        if (!livePositionBeat) {
            played.style.width = `${Math.max(0, axis.x(positionBeat))}px`;
            return;
        }
        let frame = 0;
        const update = () => {
            const beat = livePositionBeat() ?? positionBeat;
            played.style.width = `${Math.max(0, axis.x(beat))}px`;
            frame = requestAnimationFrame(update);
        };
        update();
        return () => cancelAnimationFrame(frame);
    }, [axis, livePositionBeat, positionBeat]);
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
}

/** The Align view's px/s on entering it, before any zoom (no playhead count to keep) */
const ALIGN_DEFAULT_PX_PER_SECOND = 32;
/** The Align surface stays under this many pixels, so its canvases fit at 2× density */
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
        align,
    } = props;
    const expanded = density === "expanded";
    const viewportRef = useRef<HTMLDivElement>(null);
    const playheadRef = useRef<HTMLButtonElement>(null);
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
        () => toAlignPages(model.pages, model.beatCount, alignOffset),
        [alignOffset, model.beatCount, model.pages],
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
    // E1: the music past the last count, drawn dimmed after it. The Align view draws the whole
    // recording in time already, so there it has none.
    const peaksPastEnd = showAlign
        ? NO_PEAKS
        : (model.waveform.peaksPastEnd ?? NO_PEAKS);
    const pastEndWidth = peaksPastEnd.length * pixelsPerBeat;
    // E1: room after the last beat for the music past it, **+ N counts** and the note
    const trailingWidth = Math.max(
        pastEndWidth,
        props.musicPastEnd ? MUSIC_PAST_END_NOTE_WIDTH : 0,
        props.appendCounts ? APPEND_COUNTS_ROOM : 0,
    );
    // Where the counts end: the surface's end on the normal timeline; in Align the recording may
    // run on past them
    const countsEndX = axis.x(model.beatCount);
    const surfaceWidth =
        Math.max(width, baseAxis.width, countsEndX + trailingWidth) +
        initialPageWidth;
    // UI-12: the ruler (28px) and the measure row; then the waveform, when audio is loaded, so it
    // stays put as clips come and go; then the clip rows, one always kept (with no chrome), so the
    // first off-page clip doesn't move the ruler right after the drag that made it
    const railHeight = expanded ? 20 : 17;
    const showWaveform = showAlign
        ? envelope !== null
        : model.waveform.peaksByBeat.some((peaks) => peaks.length > 0) ||
          peaksPastEnd.some((peaks) => peaks.length > 0);
    // The Align view's waveform is what's being edited, so it's taller (11-ui.md A)
    const waveformHeight = showAlign
        ? expanded
            ? 64
            : 24
        : expanded
          ? 32
          : 12;
    const audioTop = 28 + railHeight + 2;
    const trackTop = showWaveform ? audioTop + waveformHeight + 4 : audioTop;
    const rowPitch = expanded ? 22 : 12;
    const trackHeight = expanded ? 14 : 6;
    // Compact bars sit in a hit area as tall as their row, so rows never share a click
    const clipHitHeight = expanded ? trackHeight : rowPitch;
    const trackBandHeight = Math.max(rows.length, 1) * rowPitch;
    const timelineHeight = trackTop + trackBandHeight + (expanded ? 2 : 0);
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
        pixelsPerBeat: showAlign ? pixelsPerSecond : pixelsPerBeat,
        // The beats Fit fits, and any music drawn past the show's end (E1)
        beatCount: showAlign
            ? baseAxis.extent
            : model.beatCount + peaksPastEnd.length,
        leadingInset: initialPageWidth,
        // Fitted, the note and its Extend button stay in view (E1)
        trailingInset: props.musicPastEnd
            ? MUSIC_PAST_END_NOTE_WIDTH
            : props.appendCounts
              ? APPEND_COUNTS_ROOM
              : 0,
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

    // E1: the waveform past the end, as its own lane model so the canvas keeps its memo
    const pastEndWaveform = useMemo(
        () => ({ peaksByBeat: peaksPastEnd }),
        [peaksPastEnd],
    );
    // E1: **+ N counts** goes after the last page's flag; when **+** at the playhead would cover
    // it, it moves just past that one, so both stay clickable
    // Not in Align, where the ruler's flags retime counts: adding a page is a Normal-view edit
    const showAddPageFlag =
        props.onAddPageFlag != null && !props.isPlaying && !showAlign;
    const addPageFlagX = axis.x(positionBeat) + 8;
    const lastFlagBeat = Math.min(
        model.beatCount,
        model.pages.reduce(
            (end, page) => Math.max(end, page.endBeat ?? page.atBeat),
            0,
        ),
    );
    const appendCountsX = (() => {
        const atFlag = axis.x(lastFlagBeat) + 8;
        return showAddPageFlag &&
            addPageFlagX + 22 > atFlag &&
            addPageFlagX < atFlag + APPEND_COUNTS_WIDTH
            ? addPageFlagX + 22
            : atFlag;
    })();
    const showAppendCounts = props.appendCounts != null && !props.isPlaying;
    const appendWidth = props.appendCounts
        ? pillWidth(props.appendCounts.label)
        : APPEND_COUNTS_WIDTH;
    const toEndWidth = props.appendCounts?.toEnd
        ? pillWidth(props.appendCounts.toEnd.label)
        : 0;
    const appendTotalWidth = appendWidth + (toEndWidth ? toEndWidth + 6 : 0);
    // The note sits in the top row past the last count, over no page boxes and clear of the
    // music drawn below it, after **+ N counts** when that is at the end too
    const musicNoteLeft =
        initialPageWidth +
        (showAppendCounts && appendCountsX + appendTotalWidth > countsEndX
            ? appendCountsX + appendTotalWidth + 8
            : countsEndX + 8);
    // The owner seeks on a selection (UI-9: to a range's end, or home's beat 0)
    const onSelectionChange = (next: TimelineSelection) =>
        props.onSelectionChange?.(next);
    // UI-12: clicks and scrubs land on a nearby downbeat or page line
    const seekSnapBeats = useMemo(
        () =>
            [
                ...new Set([
                    ...snapBeats,
                    ...model.measures.map((measure) => measure.atBeat),
                ]),
            ].sort((a, b) => a - b),
        [model.measures, snapBeats],
    );
    const pointer = useTimelinePointer({
        seekSnapBeats,
        onSeek: props.onSeek,
        onRangeSelect: props.onSelectionChange
            ? (range) =>
                  onSelectionChange({ kind: "range", range, drawn: true })
            : undefined,
        axis,
        beatCount: model.beatCount,
        snapBeats,
    });
    // UI-13: the window's count shows while a handle is dragged, or when the window starts off a
    // page line; from a page line, it is the playhead's count, which the transport already shows
    const showWindowCount =
        displayedSelectionRange != null &&
        (selectionDragging ||
            !snapBeats.includes(displayedSelectionRange.startBeatIndex));
    const showCreateTrack =
        selection?.kind === "range" &&
        selectedTarget != null &&
        selectionRange != null &&
        props.onCreateTrack != null &&
        !selectionDragging;
    const transportProps = {
        ...props,
        onNavigate: transportNavigation(props),
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
        const bpm = formatTempo(align.durations, page.start, page.end);
        return [
            {
                id: "even-out",
                label: t("tempo.align.evenOut", { page: page.label }),
                onSelect: () =>
                    void align.onRetime({
                        durations: evenOutPage(align.durations, page),
                        originShift: 0,
                        synced: align.synced,
                    }),
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
    const markTop = expanded ? 30 : 29;
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
        if (atBeat === undefined && (y < 28 || y > 28 + rowHeight)) return null;
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
                      rowTop: 28,
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
        extraItems: align ? alignMenuItems : undefined,
        resolveRange: (event: MouseEvent<HTMLElement>) => {
            const target = menuTargetAt(event);
            // A drawn range under the pointer is the cut whatever else is there: ruler, measure
            // row, waveform or a clip
            const cut = drawnRangeAt(event);
            if (!target) return cut ? { range: cut, cut } : null;
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
                  return p ? formatTempo(shownDurations, p.start, p.end) : null;
              }
            : undefined;
    const readoutTempo =
        showAlign && alignDurations
            ? countTempo(
                  alignDurations,
                  Math.min(Math.floor(positionBeat), model.beatCount - 1) +
                      alignOffset,
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
                        secondary={props.transportSecondary}
                        viewControls={props.transportViewControls}
                        onSeek={props.onSeek}
                        onSelectionChange={
                            props.onSelectionChange
                                ? onSelectionChange
                                : undefined
                        }
                        positionBeat={positionBeat}
                        isPlaying={transportProps.isPlaying}
                        onPlayingChange={transportProps.onPlayingChange}
                        onStop={transportProps.onStop}
                        onNavigate={transportProps.onNavigate}
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
                        readoutNote={
                            readoutTempo !== null
                                ? `${readoutTempo} BPM`
                                : undefined
                        }
                    />
                ) : undefined
            }
        >
            <div
                className={clsx("relative", showAlign && "bg-accent/[0.04]")}
                data-align={showAlign || undefined}
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
                        axis={axis}
                        measures={model.measures}
                        lineTop={28}
                        topTickY={34}
                        // UI-12: one row of beat ticks, in the measure row
                        bottomTickY={null}
                    />
                    <TimelinePageLines
                        pages={model.pages}
                        axis={axis}
                        height={timelineHeight}
                    />
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
                        positionBeat={positionBeat}
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
                    {rows.flatMap((row, rowIndex) =>
                        row.map((track) => (
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
                        <TimelineWaveformLane
                            canvas={(tone) =>
                                showAlign && envelope ? (
                                    <TimelineEnvelopeCanvas
                                        envelope={envelope}
                                        pixelsPerSecond={pixelsPerSecond}
                                        width={width}
                                        height={waveformHeight}
                                        tone={tone}
                                    />
                                ) : (
                                    <TimelineWaveformCanvas
                                        waveform={model.waveform}
                                        width={width}
                                        height={waveformHeight}
                                        pixelsPerBeat={pixelsPerBeat}
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
                        >
                            {showAlign && (
                                <TimelineCountLinesCanvas
                                    axis={axis}
                                    downbeats={downbeats}
                                    width={width}
                                    height={waveformHeight}
                                />
                            )}
                        </TimelineWaveformLane>
                    )}
                    {showAlign && align && (
                        <>
                            <TimelineAlignTicks
                                axis={axis}
                                offset={alignOffset}
                                durations={shownDurations ?? align.durations}
                                pages={alignPages}
                                flagCounts={flagCounts}
                                top={28}
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
                                formatTime={(seconds) =>
                                    formatShowTime(seconds, true)
                                }
                            />
                            {punch && punchPreview && punchAxis && !preview && (
                                <TimelineAlignPreviewLayer
                                    preview={punchPreview}
                                    axis={punchAxis}
                                    offset={alignOffset}
                                    pixelsPerSecond={pixelsPerSecond}
                                    top={28}
                                    height={Math.max(0, timelineHeight - 28)}
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
                                        top={28}
                                        height={Math.max(
                                            0,
                                            timelineHeight - 28,
                                        )}
                                    />
                                    <TimelineAlignChip preview={preview} />
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
                    {props.pageFlagMove && !showAlign && (
                        <TimelinePageFlagHandles
                            pages={model.pages}
                            measures={model.measures}
                            beatCount={model.beatCount}
                            pixelsPerBeat={pixelsPerBeat}
                            move={props.pageFlagMove}
                        />
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
                    {props.countOverlay?.({
                        toX: (count) =>
                            axis.x(count - (props.beatOffset ?? alignOffset)),
                        top: 28,
                        height: Math.max(0, timelineHeight - 28),
                    })}
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
                        />
                    )}
                    <TimelinePlayhead
                        model={model}
                        positionBeat={positionBeat}
                        livePositionBeat={
                            props.isPlaying ? props.livePositionBeat : undefined
                        }
                        axis={axis}
                        height={timelineHeight}
                        beatCount={model.beatCount}
                        anchorRef={playheadRef}
                        onSeek={props.onSeek}
                        isPlaying={props.isPlaying}
                    />
                    {showAddPageFlag && (
                        <button
                            type="button"
                            data-testid="timeline-add-page-flag"
                            data-timeline-interactive="true"
                            aria-label="Add a page flag here"
                            title="Add a page flag here"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={props.onAddPageFlag}
                            className="bg-accent text-text-invert focus-visible:ring-accent pointer-events-auto absolute top-6 z-[60] flex size-16 items-center justify-center rounded-full outline-hidden focus-visible:ring-2"
                            style={{ left: addPageFlagX }}
                        >
                            <PlusIcon size={10} weight="bold" />
                        </button>
                    )}
                    {showAppendCounts && props.appendCounts && (
                        <button
                            type="button"
                            data-testid="timeline-append-counts"
                            data-timeline-interactive="true"
                            aria-label={props.appendCounts.title}
                            title={props.appendCounts.title}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={props.appendCounts.onAppend}
                            className="border-accent text-accent bg-bg-1 hover:bg-accent hover:text-text-invert focus-visible:ring-accent pointer-events-auto absolute top-6 z-[60] flex h-16 items-center gap-2 rounded-full border px-6 text-[10px] leading-none font-medium whitespace-nowrap outline-hidden focus-visible:ring-2"
                            style={{ left: appendCountsX }}
                        >
                            <PlusIcon size={9} weight="bold" />
                            {props.appendCounts.label}
                        </button>
                    )}
                    {showAppendCounts && props.appendCounts?.toEnd && (
                        <button
                            type="button"
                            data-testid="timeline-pages-to-end"
                            data-timeline-interactive="true"
                            aria-label={props.appendCounts.toEnd.title}
                            title={props.appendCounts.toEnd.title}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={props.appendCounts.toEnd.onAppend}
                            className="border-accent text-accent bg-bg-1 hover:bg-accent hover:text-text-invert focus-visible:ring-accent pointer-events-auto absolute top-6 z-[60] flex h-16 items-center gap-2 rounded-full border border-dashed px-6 text-[10px] leading-none font-medium whitespace-nowrap outline-hidden focus-visible:ring-2"
                            style={{ left: appendCountsX + appendWidth + 6 }}
                        >
                            {props.appendCounts.toEnd.label}
                        </button>
                    )}
                    {pointer.rangePreview && (
                        <div
                            data-testid="timeline-range-preview"
                            aria-hidden="true"
                            className="bg-accent/15 border-accent pointer-events-none absolute top-28 z-30 border-x"
                            style={{
                                left: axis.x(
                                    pointer.rangePreview.startBeatIndex,
                                ),
                                width: axis.span(
                                    pointer.rangePreview.startBeatIndex,
                                    pointer.rangePreview.endBeatIndex,
                                ),
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
                            pinTop={expanded ? 29 : 28}
                            pinSize={expanded ? 18 : 14}
                            beatCount={model.beatCount}
                            axis={axis}
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
                                    axis.x(
                                        countFollowsStart
                                            ? displayedSelectionRange.startBeatIndex
                                            : displayedSelectionRange.endBeatIndex,
                                    ) + (countRendersToLeft ? -6 : 6),
                                top: expanded ? 31 : 29,
                                alignItems: countRendersToLeft
                                    ? "flex-end"
                                    : "flex-start",
                                transform: countRendersToLeft
                                    ? "translateX(-100%)"
                                    : undefined,
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
                                    {getWindowCountLabel(
                                        model,
                                        displayedSelectionRange,
                                    )}
                                </span>
                            )}
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
                {showWaveform && peaksPastEnd.length > 0 && (
                    <div
                        data-testid="timeline-waveform-past-end"
                        aria-hidden="true"
                        className="rounded-4 pointer-events-none absolute overflow-hidden opacity-40"
                        style={{
                            left: initialPageWidth + width,
                            top: audioTop,
                            width: pastEndWidth,
                            height: waveformHeight,
                        }}
                    >
                        <TimelineWaveformCanvas
                            waveform={pastEndWaveform}
                            width={pastEndWidth}
                            height={waveformHeight}
                            pixelsPerBeat={pixelsPerBeat}
                            tone="rest"
                        />
                    </div>
                )}
                {props.musicPastEnd && !props.isPlaying && (
                    <div
                        data-testid="timeline-music-past-end"
                        className="border-stroke bg-bg-1 text-text rounded-6 absolute z-[55] flex h-22 items-center gap-8 border px-8 text-[11px] whitespace-nowrap shadow-sm"
                        style={{ left: musicNoteLeft, top: 3 }}
                    >
                        <span>{props.musicPastEnd.message}</span>
                        <button
                            type="button"
                            data-timeline-interactive="true"
                            onClick={props.musicPastEnd.onExtend}
                            className="text-accent focus-visible:ring-accent rounded-4 font-medium outline-hidden hover:underline focus-visible:ring-2"
                        >
                            {props.musicPastEnd.actionLabel}
                        </button>
                    </div>
                )}
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
