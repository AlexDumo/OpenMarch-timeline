import {
    memo,
    useEffect,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
} from "react";
import clsx from "clsx";
import { PushPinIcon } from "@phosphor-icons/react";
import { START_INK } from "./startFlagInk";
import { beatToX, TIMELINE_HEADROOM_HEIGHT } from "./TimelineGeometry";
import type { TimelinePlayRange as PlayRange } from "./TimelineViewModel";

/** Snaps a dragged end flag to the nearest snap beat within this many pixels */
const SNAP_PX = 8;
/** The end flag's pennant: a 12px triangle, its right side on the 2px stem */
const PENNANT = 12;
/**
 * On the playhead, the playhead's own 12px handle takes the middle (UI-21: it is drawn on top), so
 * only the pennant's left part, this wide, grabs the end flag
 */
const PENNANT_GRAB_ON_PLAYHEAD = 8;

/**
 * What Play plays (UI-22): a bar along the ruler's top edge from the start flag to the **end
 * flag**, in the start flag's color, solid while looping and faint while not. The end flag is a
 * pennant pointing back at the start flag, with its own stem once it isn't on the playhead. Drag
 * the pennant (or focus it and use the arrow keys) to place the end flag, snapping to page lines
 * and downbeats (Alt turns snapping off); that pins it, and its pin unpins it, as double-clicking
 * the pennant does. The start flag is dragged by its own line (`TimelineSelectionRange`).
 */
export const TimelinePlayRange = memo(function TimelinePlayRange({
    range,
    beatCount,
    pixelsPerBeat,
    height,
    snapBeats = [],
    pinTop,
    pinSize,
    onEndChange,
    onUnpinEnd,
}: {
    /** In view beats */
    range: PlayRange;
    beatCount: number;
    pixelsPerBeat: number;
    /** The pinned overlay's height, which the end flag's stem spans */
    height: number;
    /** Page lines and downbeats the end flag snaps to */
    snapBeats?: readonly number[];
    /** Where the pin sits, as the start flag's does */
    pinTop: number;
    pinSize: number;
    /** The end flag dragged or stepped to a view beat; without it the flag is drawn only */
    onEndChange?: (beat: number) => void;
    onUnpinEnd?: () => void;
}) {
    const movable = !range.fixed && onEndChange !== undefined;
    // The end flag while it is dragged, drawn before it's committed
    const [preview, setPreview] = useState<number | null>(null);
    const drag = useRef<{ pointerId: number; surface: Element } | null>(null);
    useEffect(() => setPreview(null), [range.endBeatIndex]);
    const end = preview ?? range.endBeatIndex;
    const startX = Math.round(beatToX(range.startBeatIndex, pixelsPerBeat));
    const endX = Math.round(beatToX(end, pixelsPerBeat));
    const onPlayhead = range.endOnPlayhead && preview === null;

    const bounded = (beat: number) =>
        Math.min(beatCount, Math.max(beat, range.startBeatIndex + 1));
    const beatAt = (clientX: number, surface: Element, altKey: boolean) => {
        const raw =
            (clientX - surface.getBoundingClientRect().left) / pixelsPerBeat;
        if (!altKey) {
            let best: number | null = null;
            for (const beat of snapBeats)
                if (
                    Math.abs(beat - raw) * pixelsPerBeat <= SNAP_PX &&
                    (best === null ||
                        Math.abs(beat - raw) < Math.abs(best - raw))
                )
                    best = beat;
            if (best !== null) return bounded(best);
        }
        return bounded(Math.round(raw));
    };

    const handlers = movable
        ? {
              onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
                  if (event.button !== 0 || event.detail > 1) return;
                  event.stopPropagation();
                  const surface = event.currentTarget.closest(
                      "[data-testid=timeline-play-range]",
                  );
                  if (!surface) return;
                  drag.current = { pointerId: event.pointerId, surface };
                  event.currentTarget.setPointerCapture?.(event.pointerId);
              },
              onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
                  const current = drag.current;
                  if (!current || current.pointerId !== event.pointerId) return;
                  setPreview(
                      beatAt(event.clientX, current.surface, event.altKey),
                  );
              },
              onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
                  const current = drag.current;
                  if (!current || current.pointerId !== event.pointerId) return;
                  drag.current = null;
                  event.currentTarget.releasePointerCapture?.(event.pointerId);
                  const beat = beatAt(
                      event.clientX,
                      current.surface,
                      event.altKey,
                  );
                  // A press that didn't move leaves the end flag where it is
                  if (preview !== null && beat !== range.endBeatIndex)
                      onEndChange?.(beat);
                  else setPreview(null);
              },
              onLostPointerCapture: () => {
                  if (!drag.current) return;
                  drag.current = null;
                  setPreview(null);
              },
              onDoubleClick: (event: ReactMouseEvent) => {
                  event.stopPropagation();
                  if (range.endPinned) onUnpinEnd?.();
              },
              onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
                  const delta =
                      event.key === "ArrowLeft"
                          ? -1
                          : event.key === "ArrowRight"
                            ? 1
                            : 0;
                  if (delta === 0) return;
                  event.preventDefault();
                  // The arrow moves the end flag, not the selected marchers
                  event.stopPropagation();
                  onEndChange?.(bounded(range.endBeatIndex + delta));
              },
          }
        : {};
    const title = range.fixed
        ? "The isolated move's end: Play loops it"
        : range.endPinned
          ? "End flag: Play stops here, and Stop comes back here. Drag to move it; double-click to put it back on the playhead"
          : "End flag: Play stops here, and Stop comes back here. Drag it off the playhead to pin it";

    return (
        <div
            data-testid="timeline-play-range"
            className="pointer-events-none absolute inset-0"
        >
            {/* Square ends on the strip's top edge, as wide as the 2px lines at each end, so the
                bar, the flags' stems and the playhead's line meet flush (UI-20) */}
            <span
                data-testid="timeline-play-range-bar"
                data-looping={range.looping || undefined}
                aria-hidden="true"
                className={clsx(
                    "absolute top-0 z-40",
                    START_INK.bg,
                    range.looping ? "h-4" : "h-[2px] opacity-50",
                )}
                style={{
                    left: startX - 1,
                    width: Math.max(endX - startX, 2) + 2,
                }}
            />
            {!onPlayhead && (
                <span
                    data-testid="timeline-end-stem"
                    aria-hidden="true"
                    {...handlers}
                    onKeyDown={undefined}
                    className={clsx(
                        "absolute top-0 z-40 w-12 -translate-x-1/2 touch-none",
                        movable && "pointer-events-auto cursor-ew-resize",
                    )}
                    style={{ left: endX, height }}
                >
                    <span
                        className={clsx(
                            "pointer-events-none absolute top-0 left-1/2 w-[2px] -translate-x-1/2",
                            START_INK.bg,
                        )}
                        style={{ height }}
                    />
                </span>
            )}
            <svg
                width={PENNANT}
                height={PENNANT}
                viewBox="0 0 12 12"
                aria-hidden="true"
                className={clsx("absolute top-0 z-[59]", START_INK.text)}
                style={{ left: endX + 1 - PENNANT }}
            >
                {/* A filled right triangle on the strip's top edge, pointing back at the start
                    flag; its right side is the stem */}
                <path d="M12 0 L0 0 L12 12 Z" fill="currentColor" />
            </svg>
            <button
                type="button"
                data-testid="timeline-end-flag"
                data-timeline-interactive="true"
                aria-label={`End flag, beat ${range.endBeatIndex}`}
                title={title}
                disabled={!movable}
                {...handlers}
                className="focus-visible:ring-accent pointer-events-auto absolute top-0 z-[59] touch-none border-0 bg-transparent p-0 outline-hidden focus-visible:ring-2 enabled:cursor-ew-resize! disabled:pointer-events-none"
                style={{
                    left: endX + 1 - PENNANT - (onPlayhead ? 2 : 0),
                    width: onPlayhead ? PENNANT_GRAB_ON_PLAYHEAD : PENNANT + 1,
                    height: TIMELINE_HEADROOM_HEIGHT,
                }}
            />
            {range.endPinned && !range.fixed && (
                <button
                    type="button"
                    data-testid="timeline-end-pin"
                    data-timeline-interactive="true"
                    aria-label="End flag pinned. Click to unpin"
                    title="Pinned: the end flag stays here when the playhead moves. Click to unpin, so it follows the playhead again."
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={onUnpinEnd}
                    disabled={!onUnpinEnd}
                    className={clsx(
                        "bg-bg-1 rounded-4 pointer-events-auto absolute z-[45] flex items-center justify-center border p-0 shadow-sm enabled:cursor-pointer",
                        pinSize >= 18 ? "size-18" : "size-14",
                        START_INK.text,
                        START_INK.border,
                    )}
                    // Left of the stem, mirroring the start flag's pin
                    style={{ left: endX - 10 - pinSize, top: pinTop }}
                >
                    <PushPinIcon size={pinSize >= 18 ? 12 : 10} weight="fill" />
                </button>
            )}
        </div>
    );
});
